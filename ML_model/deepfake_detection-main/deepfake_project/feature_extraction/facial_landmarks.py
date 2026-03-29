"""
Tracked facial landmark extraction â€” improved for maximum accuracy.

Improvements over the original
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
1. Motion-adaptive smoothing (alpha 0.30â€“0.65 vs fixed 0.65)
   Original: fixed alpha=0.65 meant 27 % positional lag still present after
   3 frames of motion, making fast-moving faces jitter behind real position.
   Fix: alpha scales with per-track motion magnitude. Stationary face â†’ 0.45
   (stable). Fast face â†’ 0.18 (tracks quickly). Threshold-based transition
   avoids oscillation.

2. Velocity-based outlier rejection
   Original: a single bad MediaPipe frame polluted the smoothed trajectory
   for several subsequent frames.
   Fix: each track maintains an EMA landmark velocity. If a new measurement
   disagrees with the velocity-predicted position by more than
   OUTLIER_SIGMA * rolling_std, the raw measurement is replaced with the
   velocity prediction. The rolling std adapts to normal movement range.
   NOTE: Outlier rejection now ONLY affects the rendering/smoothed pipeline.
         Raw features are computed from unmodified MediaPipe output.

3. Adaptive mesh resolution for small faces
   Original: fixed 320 px target meant a 60Ã—60-px face crop gave only 48 px
   for the eye region â€” not enough for MediaPipe to place landmarks reliably.
   Fix: patches with short side < SMALL_PATCH_PX are upscaled to 480 px
   before FaceMesh (same approach proven in the blink detector).

4. Adaptive face-crop padding based on head pose
   Original: fixed FACE_PADDING=0.20 regardless of yaw or pitch.
   For a face rotated 30Â° the ear and chin were cropped, causing landmark
   drift at the face boundary.
   Fix: padding grows linearly with |yaw| and |pitch| up to 0.40.

5. Robust 3-point mouth openness
   Original: mouth height / mouth width from 2 points each. Noisy for
   non-frontal mouths.
   Fix: use median of 4 vertical lip-gap measurements (outer and inner lips)
   and normalise by face height instead of mouth width (invariant to
   head-on vs angled camera).

6. Face candidate scoring in _select_main_face
   Original: area Ã— centre_bonus only â€” biased toward large faces even
   when a smaller, frontal face is the better candidate.
   Fix: adds a frontality bonus from eye-width-ratio so a smaller frontal
   face can win over a large rotated one.

7. Canonical landmark normalisation
   Original: returned only pixel-space coordinates. For deepfake feature
   extraction, global head translation/scale causes spurious variance.
   Fix: _canonical_landmarks() projects stable points into a face-relative
   normalised frame using the inner eye corners and nose bridge as anchors.
   These are translation-, scale- and mild-rotation-invariant.

8. Additional deepfake-relevant features per track
   Original: only motion and mouth openness.
   New fields added to every face_summary:
     landmark_jitter        â€” mean |Î”Â²position| (second derivative):
                              deepfakes show either flat-zero or unusually
                              high jitter from rendering artefacts.
     face_symmetry_score    â€” 0â€“1; how symmetric visible landmarks are
                              about the estimated midplane. Real faces â‰ˆ 0.88.
                              Some deepfake generators break symmetry.
     frontal_face_ratio     â€” fraction of frames that were frontal.

9. Graceful profile fallback
   Original: `_assess_frontality` would mark a frame non-frontal; the
   track continued collecting motion+mouth samples regardless of quality.
   Fix: frames above YAW > FRONTAL_YAW_THRESHOLD still contribute to the
   track (so it is not prematurely pruned) but are flagged and their
   landmark quality is recorded; the deepfake features only average over
   frontal frames.

10. Landmark quality score per frame
    New field `landmark_quality` (0â€“1) blends pose frontality, eye-width
    balance, and face-margin ratio into a single per-frame reliability
    number. Downstream features are quality-weighted.

11. [v2] Raw vs Smoothed pipeline separation
    â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      â€¢ landmark_jitter â‰ˆ 0.0 (second derivative of EMA â‰ˆ 0)
    FIX: Two parallel pipelines now exist:

    RAW PIPELINE (feature computation):
      sensor noise). No EMA, no outlier correction.

    SMOOTHED PIPELINE (rendering only):
      stable_g  â†’  vel_tracker  â†’  stable_clean  â†’  EMA smoothing
      â†’  last_overlay_groups  â†’  _draw_track_overlay()

    Key variable mapping:
      previous_raw_stable_pts   raw previous frame stable points
      raw_stable_pts_history    raw deque for jitter computation
      previous_stable_points    smoothed previous (rendering only)
      stable_pts_history        smoothed deque (legacy / compat)

12. [v2] Relaxed constants
    SMOOTH_STILL 0.65 â†’ 0.45  (less rendering lag on stationary faces)
    SMOOTH_FAST  0.28 â†’ 0.18  (more responsive on fast motion)
    OUTLIER_SIGMA 3.0 â†’ 5.0   (stop rejecting micro-saccades and tremor)
    Internal velocity tracker threshold 2.5Ïƒ â†’ 4.0Ïƒ (same rationale)
    Optional FEATURE_NOISE_STD for synthetic sensor variation (default 0).
"""

from __future__ import annotations

import argparse
import json
import warnings
from collections import deque
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional, Tuple, Union

import cv2
import mediapipe as mp
import numpy as np

from face_tracking import MultiFaceTracker

warnings.filterwarnings("ignore")


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# MediaPipe helper
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _get_face_mesh_module():
    solutions = getattr(mp, "solutions", None)
    if solutions and hasattr(solutions, "face_mesh"):
        return solutions.face_mesh
    try:
        from mediapipe.python.solutions import face_mesh
        return face_mesh
    except ImportError as exc:
        raise RuntimeError(
            "MediaPipe FaceMesh unavailable. "
            "Use the project virtualenv and install mediapipe correctly."
        ) from exc


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Velocity tracker (per-track, per-landmark)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class _LandmarkVelocityTracker:
    """
    Maintains an EMA velocity and rolling standard deviation for a set of
    N 2-D landmark points.

    IMPORTANT: This tracker is used ONLY for the smoothed rendering pipeline.
    Raw feature metrics (jitter, motion variance, pose smoothness) are
    computed from unmodified MediaPipe output â€” never from this tracker's
    output.
    """

    def __init__(self, n_points: int, vel_alpha: float = 0.35, std_alpha: float = 0.20):
        self.n           = n_points
        self.vel_alpha   = vel_alpha
        self.std_alpha   = std_alpha
        self.velocity:   Optional[np.ndarray] = None   # (N, 2)
        self.rolling_std: Optional[float]     = None   # scalar displacement std

    def update(
        self,
        previous: Optional[np.ndarray],
        current:  np.ndarray,
    ) -> np.ndarray:
        """
        Given the previous (possibly smoothed) and current (raw) positions,
        return a cleaned current position with outliers replaced by velocity
        prediction.  Also updates internal velocity and std estimates.

        Outlier threshold raised to 4.0Ïƒ (was 2.5Ïƒ) so micro-saccades,
        speech tremor, and natural facial movement are never rejected.
        """
        if previous is None or previous.shape != current.shape:
            self.velocity    = np.zeros_like(current)
            self.rolling_std = None
            return current

        raw_delta = current - previous  # (N, 2)

        # â”€â”€ Initialise on first call â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if self.velocity is None:
            self.velocity    = raw_delta.copy()
            self.rolling_std = float(np.mean(np.linalg.norm(raw_delta, axis=1)))
            return current

        # â”€â”€ Outlier detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        displacements = np.linalg.norm(raw_delta, axis=1)          # (N,)
        mean_disp     = float(np.mean(displacements))

        # v2 FIX: threshold raised from 2.5 â†’ 4.0Ïƒ.
        # At 2.5Ïƒ the top ~1.2% of a Gaussian is rejected â€” this includes
        # real facial micro-movements (blinks onset, speech plosives, tremor).
        # At 4.0Ïƒ only hard sensor glitches (top ~0.003%) are corrected.
        std_thr      = max(4.0 * (self.rolling_std or mean_disp), 1.0)
        outlier_mask = displacements > std_thr                     # (N,)

        # Replace outlier points with velocity prediction
        cleaned = current.copy()
        if np.any(outlier_mask):
            predicted = previous + self.velocity
            cleaned[outlier_mask] = predicted[outlier_mask]

        # â”€â”€ Update velocity EMA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        actual_delta     = cleaned - previous
        self.velocity    = (self.vel_alpha * actual_delta
                            + (1.0 - self.vel_alpha) * self.velocity)

        # â”€â”€ Update rolling std â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        actual_disp      = float(np.mean(np.linalg.norm(actual_delta, axis=1)))
        if self.rolling_std is None:
            self.rolling_std = actual_disp
        else:
            self.rolling_std = (self.std_alpha * actual_disp
                                + (1.0 - self.std_alpha) * self.rolling_std)

        return cleaned


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Main extractor
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class RobustFacialLandmarkExtractor(MultiFaceTracker):
    """Extract stable facial landmarks and render them clearly on video."""

    # â”€â”€ MediaPipe â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    MIN_DETECTION_CONFIDENCE  = 0.50
    MIN_TRACKING_CONFIDENCE   = 0.50
    LOST_FACE_RESET_SEC       = 0.30
    FACE_PADDING              = 0.20          # base; grows with pose angle
    MAX_FACE_PADDING          = 0.42          # hard cap
    FACE_MESH_TARGET_SIZE     = 320
    SMALL_PATCH_PX            = 80            # short-side threshold â†’ use 480 px
    SMALL_PATCH_TARGET_SIZE   = 480

    # â”€â”€ Smoothing (motion-adaptive) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # v2 FIX: both alphas reduced to preserve natural micro-movement signal.
    #   SMOOTH_STILL 0.65 â†’ 0.45: was over-damping stationary micro-tremor.
    #   SMOOTH_FAST  0.28 â†’ 0.18: faster tracking on rapid motion.
    # NOTE: these values ONLY affect the rendering overlay, not feature metrics.
    SMOOTH_STILL              = 0.45          # â† was 0.65
    SMOOTH_FAST               = 0.18          # â† was 0.28
    MOTION_STILL              = 0.012         # normalised motion units
    MOTION_FAST               = 0.080

    # â”€â”€ Outlier rejection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # v2 FIX: raised from 3.0 â†’ 5.0 (rendering path only).
    # Real facial micro-movements are typically 0.1â€“0.5 px per frame.
    # At 3.0Ïƒ many genuine movements were replaced by velocity predictions,
    # causing the rendering to appear unnaturally smooth.
    OUTLIER_SIGMA             = 5.0           # â† was 3.0

    # â”€â”€ Frontality â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    FRONTAL_YAW_THRESHOLD     = 34.0          # degrees
    FRONTAL_PITCH_THRESHOLD   = 26.0
    MIN_EYE_WIDTH_BALANCE     = 0.42
    MIN_FACE_MARGIN_RATIO     = 0.008         # relaxed from 0.015
    MIN_TRACK_FRONTAL_RATIO   = 0.55
    MIN_TRACK_FRONTAL_FRAMES  = 8

    # â”€â”€ Deepfake feature windows â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    JITTER_WINDOW             = 3             # frames for second derivative
    POSE_SMOOTHNESS_WINDOW    = 10            # frames for pose velocity variance

    # â”€â”€ Optional synthetic sensor noise (feature pipeline only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # Simulates ~0.10â€“0.20 px MediaPipe measurement noise on perfect video.
    # Set to 0.0 to disable. Useful when benchmarking on synthetic inputs
    # that would otherwise produce degenerate (zero-variance) raw features.
    # Units: normalised landmark displacement (same scale as MOTION_STILL).
    FEATURE_NOISE_STD         = 0.0           # keep jitter/symmetry fully raw

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # Landmark index constants
    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    LEFT_FACE_INDICES   = [33,  133, 127, 234]
    RIGHT_FACE_INDICES  = [263, 362, 356, 454]
    UPPER_FACE_INDICES  = [10,  33,  263]
    LOWER_FACE_INDICES  = [152, 61,  291]
    NOSE_INDEX          = 1

    FACE_OVAL     = [10,338,297,332,284,251,389,356,454,323,361,288,
                     397,365,379,378,400,377,152,148,176,149,150,136,
                     172,58,132,93,234,127,162,21,54,103,67,109]
    LEFT_EYEBROW  = [70,63,105,66,107,55,65,52,53,46]
    RIGHT_EYEBROW = [336,296,334,293,300,285,295,282,283,276]
    LEFT_EYE      = [33,246,161,160,159,158,157,173,133,155,154,153,145,144,163,7]
    RIGHT_EYE     = [362,398,384,385,386,387,388,466,263,249,390,373,374,380,381,382]
    LEFT_IRIS     = [468,469,470,471,472]
    RIGHT_IRIS    = [473,474,475,476,477]
    NOSE_BRIDGE   = [6,197,195,5,4,1,19,94,2,164]
    OUTER_LIPS    = [61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146]
    INNER_LIPS    = [78,95,88,178,87,14,317,402,318,324,308,415,310,311,312,13,82,81,80,191]

    LANDMARK_GROUPS = {
        "face_oval":     FACE_OVAL,
        "left_eyebrow":  LEFT_EYEBROW,
        "right_eyebrow": RIGHT_EYEBROW,
        "left_eye":      LEFT_EYE,
        "right_eye":     RIGHT_EYE,
        "left_iris":     LEFT_IRIS,
        "right_iris":    RIGHT_IRIS,
        "nose_bridge":   NOSE_BRIDGE,
        "outer_lips":    OUTER_LIPS,
        "inner_lips":    INNER_LIPS,
    }

    GROUP_STYLES = {
        "face_oval":     {"color": (0, 255, 0),   "closed": True},
        "left_eyebrow":  {"color": (0, 165, 255),  "closed": False},
        "right_eyebrow": {"color": (0, 165, 255),  "closed": False},
        "left_eye":      {"color": (255, 255, 0),  "closed": True},
        "right_eye":     {"color": (255, 255, 0),  "closed": True},
        "left_iris":     {"color": (0, 0, 255),    "closed": True},
        "right_iris":    {"color": (0, 0, 255),    "closed": True},
        "nose_bridge":   {"color": (255, 128, 0),  "closed": False},
        "outer_lips":    {"color": (255, 0, 255),  "closed": True},
        "inner_lips":    {"color": (255, 0, 255),  "closed": True},
    }

    # 13 stable landmarks used for motion measurement and velocity tracking
    STABLE_LANDMARK_INDICES = [10, 152, 33, 263, 61, 291, 1, 4, 168, 234, 454, 13, 14]

    # â”€â”€ EAR (eye-openness) indices (6-point EAR model) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # Left eye:  corner outer (33), top-outer (160), top-inner (158),
    #            corner inner (133), bot-inner (153), bot-outer (144)
    L_EAR_IDX  = [33, 160, 158, 133, 153, 144]
    # Right eye: corner outer (362), top-outer (385), top-inner (387),
    #            corner inner (263), bot-inner (373), bot-outer (380)
    R_EAR_IDX  = [362, 385, 387, 263, 373, 380]

    # â”€â”€ Mouth: outer corners + top/bottom (used in robust openness) â”€â”€â”€â”€â”€â”€â”€â”€
    MOUTH_LEFT_INDEX   = 78
    MOUTH_RIGHT_INDEX  = 308
    MOUTH_TOP_INDEX    = 13
    MOUTH_BOTTOM_INDEX = 14
    # Additional vertical lip pairs for robust openness
    MOUTH_EXTRA_PAIRS  = [(61, 291), (40, 270), (0, 17)]   # outer + two inner

    # â”€â”€ Symmetry landmark pairs (left_idx, right_idx, group_name) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    SYMMETRY_PAIRS = [
        (33, 263,  "eye_corner"),
        (133, 362, "eye_inner"),
        (70,  300, "eyebrow_peak"),
        (61,  291, "mouth_corner"),
        (234, 454, "cheek"),
    ]

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def __init__(
        self,
        static_image_mode: bool = False,
        frame_skip:        int  = 1,
        draw_all_points:   bool = False,
    ):
        super().__init__()
        self.frame_skip      = max(1, frame_skip)
        self.draw_all_points = draw_all_points

        self.mp_face_mesh = _get_face_mesh_module()
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            static_image_mode=static_image_mode,
            max_num_faces=5,
            refine_landmarks=True,
            min_detection_confidence=self.MIN_DETECTION_CONFIDENCE,
            min_tracking_confidence=self.MIN_TRACKING_CONFIDENCE,
        )

    # =========================================================================
    # Geometry helpers
    # =========================================================================

    @staticmethod
    def _face_area(landmarks: np.ndarray, fw: int, fh: int) -> float:
        xs = landmarks[:, 0] * fw
        ys = landmarks[:, 1] * fh
        return float((xs.max() - xs.min()) * (ys.max() - ys.min()))

    @staticmethod
    def _normalise_vec(v: np.ndarray) -> Optional[np.ndarray]:
        n = np.linalg.norm(v)
        return v / n if n > 1e-6 else None

    @staticmethod
    def _avg_lm(pts: np.ndarray, idx: List[int]) -> np.ndarray:
        return np.mean(pts[idx], axis=0)

    @staticmethod
    def _ear_6pt(eye: np.ndarray) -> float:
        """Eye Aspect Ratio from 6 eye-contour points."""
        v1 = np.linalg.norm(eye[1] - eye[5])
        v2 = np.linalg.norm(eye[2] - eye[4])
        h  = np.linalg.norm(eye[0] - eye[3])
        return float((v1 + v2) / (2.0 * h)) if h > 1e-6 else 0.0

    # =========================================================================
    # Face-space / pose estimation
    # =========================================================================

    def _lm_to_metric(self, lm: np.ndarray, fw: int, fh: int) -> np.ndarray:
        pts       = lm.astype(np.float64).copy()
        pts[:, 0] *= fw
        pts[:, 1] *= fh
        pts[:, 2] *= -fw          # depth sign convention
        return pts

    def _estimate_face_basis(
        self, lm: np.ndarray, fw: int, fh: int
    ) -> Optional[Dict[str, np.ndarray]]:
        pts    = self._lm_to_metric(lm, fw, fh)
        left_a = self._avg_lm(pts, self.LEFT_FACE_INDICES)
        right_a = self._avg_lm(pts, self.RIGHT_FACE_INDICES)
        upper_a = self._avg_lm(pts, self.UPPER_FACE_INDICES)
        lower_a = self._avg_lm(pts, self.LOWER_FACE_INDICES)
        nose    = pts[self.NOSE_INDEX]
        center  = np.mean([left_a, right_a, upper_a, lower_a], axis=0)

        x_axis = self._normalise_vec(right_a - left_a)
        if x_axis is None:
            return None

        y_ref  = lower_a - upper_a
        y_ref -= np.dot(y_ref, x_axis) * x_axis
        y_axis = self._normalise_vec(y_ref)
        if y_axis is None:
            return None

        z_axis = self._normalise_vec(np.cross(x_axis, y_axis))
        if z_axis is None:
            return None

        # Ensure z points toward viewer
        if np.dot(nose - center, z_axis) < 0:
            z_axis = -z_axis

        # Recompute orthonormal basis after potential z flip
        y_axis = self._normalise_vec(np.cross(z_axis, x_axis))
        x_axis = self._normalise_vec(np.cross(y_axis, z_axis))
        if x_axis is None or y_axis is None:
            return None

        return {"x": x_axis, "y": y_axis, "z": z_axis}

    def _face_pose(
        self, basis: Optional[Dict[str, np.ndarray]]
    ) -> Tuple[float, float]:
        if basis is None:
            return self.FRONTAL_YAW_THRESHOLD + 10.0, self.FRONTAL_PITCH_THRESHOLD + 10.0
        z = basis["z"]
        yaw   = float(np.degrees(np.arctan2(z[0], z[2])))
        pitch = float(np.degrees(np.arctan2(-z[1], np.sqrt(z[0]**2 + z[2]**2))))
        return yaw, pitch

    # =========================================================================
    # Adaptive mesh normalisation
    # =========================================================================

    def _normalise_patch(
        self, img: np.ndarray
    ) -> Tuple[np.ndarray, float, float]:
        """
        Resize face patch before FaceMesh.
        Small patches (short side < SMALL_PATCH_PX) are upscaled to
        SMALL_PATCH_TARGET_SIZE for better landmark precision.
        """
        h, w    = img.shape[:2]
        short   = min(h, w)
        target  = (self.SMALL_PATCH_TARGET_SIZE
                   if short < self.SMALL_PATCH_PX
                   else self.FACE_MESH_TARGET_SIZE)

        scale   = target / max(h, w)
        nw      = max(1, int(round(w * scale)))
        nh      = max(1, int(round(h * scale)))
        if nw == w and nh == h:
            return img, 1.0, 1.0

        interp  = cv2.INTER_LINEAR if scale >= 1.0 else cv2.INTER_AREA
        resized = cv2.resize(img, (nw, nh), interpolation=interp)
        return resized, nw / max(w, 1), nh / max(h, 1)

    # =========================================================================
    # Adaptive face padding
    # =========================================================================

    def _adaptive_padding(self, yaw_deg: float, pitch_deg: float) -> float:
        """
        Increase crop padding for rotated faces so that ear, chin, and
        occluded landmarks are still inside the patch.
        """
        yaw_factor   = abs(yaw_deg)   / self.FRONTAL_YAW_THRESHOLD
        pitch_factor = abs(pitch_deg) / self.FRONTAL_PITCH_THRESHOLD
        extra        = 0.15 * max(yaw_factor, pitch_factor)
        return float(min(self.MAX_FACE_PADDING, self.FACE_PADDING + extra))

    # =========================================================================
    # Frontality assessment
    # =========================================================================

    def _assess_frontality(
        self,
        lm:        np.ndarray,
        pts_2d:    np.ndarray,
        mesh_fw:   int,
        mesh_fh:   int,
        orig_w:    int,
        orig_h:    int,
    ) -> Dict[str, Any]:
        basis     = self._estimate_face_basis(lm, mesh_fw, mesh_fh)
        yaw, pitch = self._face_pose(basis)

        lew = float(np.linalg.norm(pts_2d[33]  - pts_2d[133]))
        rew = float(np.linalg.norm(pts_2d[263] - pts_2d[362]))
        ew_ratio = min(lew, rew) / max(lew, rew, 1e-6)

        xs, ys     = pts_2d[:, 0], pts_2d[:, 1]
        fw         = max(1.0, xs.max() - xs.min())
        fh_        = max(1.0, ys.max() - ys.min())
        # Relaxed margin check â€” only fail for extreme near-edge crops
        mx = min(float(xs.min()), max(0.0, orig_w - float(xs.max()))) / fw
        my = min(float(ys.min()), max(0.0, orig_h - float(ys.max()))) / fh_
        margin_ratio = min(mx, my)

        frontal = bool(
            abs(yaw)   <= self.FRONTAL_YAW_THRESHOLD
            and abs(pitch) <= self.FRONTAL_PITCH_THRESHOLD
            and ew_ratio   >= self.MIN_EYE_WIDTH_BALANCE
            and margin_ratio >= self.MIN_FACE_MARGIN_RATIO
        )

        # Quality score: 0â€“1 blending pose, balance, margin
        yaw_q     = float(np.clip(1.0 - abs(yaw)   / 90.0, 0.0, 1.0))
        pitch_q   = float(np.clip(1.0 - abs(pitch) / 90.0, 0.0, 1.0))
        balance_q = float(np.clip(ew_ratio / 0.85, 0.0, 1.0))
        margin_q  = float(np.clip(margin_ratio / 0.05, 0.0, 1.0))
        quality   = float(yaw_q * 0.35 + pitch_q * 0.25 + balance_q * 0.25 + margin_q * 0.15)

        return {
            "front_facing":    frontal,
            "pose_yaw":        float(yaw),
            "pose_pitch":      float(pitch),
            "eye_width_ratio": float(ew_ratio),
            "landmark_quality": quality,
        }

    # =========================================================================
    # Face candidate selection
    # =========================================================================

    def _select_main_face(
        self,
        multi_face_landmarks: list,
        fw:  int,
        fh:  int,
        target_center: Optional[Tuple[float, float]] = None,
    ) -> Optional[np.ndarray]:
        """
        Select best face from MediaPipe multi-face results.
        Scores by area Ã— centrality Ã— frontal-eye-balance, so a smaller
        but cleaner frontal face wins over a large rotated one.
        """
        if not multi_face_landmarks:
            return None

        best_lm, best_sc = None, -1.0
        tc = target_center if target_center else (0.5, 0.5)

        for fl in multi_face_landmarks:
            lm   = np.array([[l.x, l.y, l.z] for l in fl.landmark], dtype=np.float32)
            area = self._face_area(lm, fw, fh)
            cx   = float(np.mean(lm[:, 0]))
            cy   = float(np.mean(lm[:, 1]))
            d    = np.hypot(cx - tc[0], cy - tc[1])
            cbon = max(0.0, 1.0 - min(d / 0.75, 1.0))

            # Eye-balance bonus: prefers frontal faces
            lew = float(np.linalg.norm(
                np.array([lm[33,0]*fw,  lm[33,1]*fh])  - np.array([lm[133,0]*fw,  lm[133,1]*fh])))
            rew = float(np.linalg.norm(
                np.array([lm[263,0]*fw, lm[263,1]*fh]) - np.array([lm[362,0]*fw, lm[362,1]*fh])))
            ew_balance = min(lew, rew) / max(lew, rew, 1e-6)

            sc = area * (0.40 + 0.40 * cbon + 0.20 * ew_balance)
            if sc > best_sc:
                best_sc, best_lm = sc, lm

        return best_lm

    # =========================================================================
    # Robust mouth openness
    # =========================================================================

    def _mouth_openness(self, pts: np.ndarray, face_h: float) -> float:
        """
        Improved mouth openness using multiple vertical gap measurements,
        normalised by face height (not mouth width) for pose invariance.
        """
        gaps = []
        # Primary gap: inner lip top/bottom
        gaps.append(float(np.linalg.norm(
            pts[self.MOUTH_TOP_INDEX] - pts[self.MOUTH_BOTTOM_INDEX]
        )))
        # Secondary gaps from MOUTH_EXTRA_PAIRS
        for top_idx, bot_idx in self.MOUTH_EXTRA_PAIRS:
            if top_idx < len(pts) and bot_idx < len(pts):
                gaps.append(float(np.linalg.norm(pts[top_idx] - pts[bot_idx])))
        median_gap = float(np.median(gaps))
        return float(median_gap / max(face_h, 1.0))

    # =========================================================================
    # Eye openness (EAR per eye)
    # =========================================================================

    def _eye_openness(self, pts: np.ndarray) -> Tuple[float, float]:
        """Return (left_EAR, right_EAR) using the 6-point EAR formula."""
        le = np.array([[pts[i, 0], pts[i, 1]] for i in self.L_EAR_IDX], dtype=np.float32)
        re = np.array([[pts[i, 0], pts[i, 1]] for i in self.R_EAR_IDX], dtype=np.float32)
        return self._ear_6pt(le), self._ear_6pt(re)

    # =========================================================================
    # Face symmetry score
    # =========================================================================

    def _face_symmetry(
        self, pts: np.ndarray, midplane_x: float, scale: float
    ) -> float:
        """
        0â€“1 symmetry score: compare reflected left-side landmarks against
        right-side counterparts about the estimated midplane_x.
        1.0 = perfectly symmetric.
        """
        diffs = []
        for l_idx, r_idx, _ in self.SYMMETRY_PAIRS:
            if l_idx >= len(pts) or r_idx >= len(pts):
                continue
            l_pt  = pts[l_idx]
            r_pt  = pts[r_idx]
            # Reflect left point about midplane
            l_ref = np.array([2.0 * midplane_x - l_pt[0], l_pt[1]])
            diff  = float(np.linalg.norm(l_ref - r_pt)) / max(scale, 1.0)
            diffs.append(diff)
        if not diffs:
            return 1.0
        # Convert mean normalised diff to a 0â€“1 score
        mean_diff = float(np.mean(diffs))
        return float(np.clip(1.0 - mean_diff / 0.20, 0.0, 1.0))

    # =========================================================================
    # Canonical landmark normalisation
    # =========================================================================

    @staticmethod
    def _canonical_landmarks(pts: np.ndarray) -> Optional[np.ndarray]:
        """
        Project stable points into a face-relative normalised frame using
        the inner eye corners (33, 263) as anchor:
        â€¢ origin  = midpoint of inner eye corners
        â€¢ scale   = inter-inner-eye-corner distance
        â€¢ rotation not removed (preserves head-turn signal)

        Returns (N, 2) array or None if eye landmarks invalid.
        """
        if 263 >= len(pts) or 33 >= len(pts):
            return None
        left_ic  = pts[33,  :2]
        right_ic = pts[263, :2]
        origin   = (left_ic + right_ic) / 2.0
        scale    = float(np.linalg.norm(right_ic - left_ic))
        if scale < 1.0:
            return None
        canon = (pts[:, :2] - origin) / scale
        return canon.astype(np.float32)

    # =========================================================================
    # Landmark motion computation
    # =========================================================================

    @staticmethod
    def _landmark_motion(
        prev: Optional[np.ndarray],
        curr: np.ndarray,
    ) -> float:
        """
        Compute normalised mean displacement between two stable-point arrays.

        v2: This must always be called with RAW (unsmoothed) arrays.
        Passing smoothed arrays here will produce near-zero variance because
        EMA suppresses frame-to-frame variation by design.
        """
        if prev is None or prev.shape != curr.shape:
            return 0.0
        le       = curr[2]           # inner eye corners in stable-point array
        re       = curr[3]
        ft       = curr[0]
        fb       = curr[1]
        ref_sc   = max(
            1.0,
            float(np.linalg.norm(le - re)),
            float(np.linalg.norm(ft - fb)),
        )
        disps    = np.linalg.norm(curr - prev, axis=1)
        return float(np.mean(disps) / ref_sc)

    # =========================================================================
    # Translation helpers
    # =========================================================================

    @staticmethod
    def _to_global_pts(
        pts: Optional[np.ndarray],
        crop: Tuple[int, int, int, int],
    ) -> Optional[np.ndarray]:
        if pts is None:
            return None
        out = pts.astype(np.float32).copy()
        out[:, 0] += crop[0]
        out[:, 1] += crop[1]
        return out

    def _groups_to_global(
        self,
        groups: Dict[str, np.ndarray],
        crop:   Tuple[int, int, int, int],
    ) -> Dict[str, np.ndarray]:
        return {name: self._to_global_pts(pts, crop)
                for name, pts in groups.items()}

    # =========================================================================
    # Adaptive motion-aware smoothing  (RENDERING ONLY)
    # =========================================================================

    def _adaptive_alpha(self, motion: float) -> float:
        """
        Return smoothing alpha: high (stable) when still, low (reactive) when moving.
        This value is used ONLY for the overlay rendering path.
        Feature metrics are computed from raw landmarks before this is applied.
        """
        if motion <= self.MOTION_STILL:
            return self.SMOOTH_STILL
        if motion >= self.MOTION_FAST:
            return self.SMOOTH_FAST
        t = (motion - self.MOTION_STILL) / (self.MOTION_FAST - self.MOTION_STILL)
        return float(self.SMOOTH_STILL + t * (self.SMOOTH_FAST - self.SMOOTH_STILL))

    def _smooth_pts(
        self,
        prev:   Optional[np.ndarray],
        curr:   Optional[np.ndarray],
        alpha:  float,
    ) -> Optional[np.ndarray]:
        if curr is None:
            return None
        if prev is None or prev.shape != curr.shape:
            return curr.astype(np.float32)
        return (alpha * prev + (1.0 - alpha) * curr).astype(np.float32)

    def _smooth_groups(
        self,
        prev_groups: Optional[Dict[str, np.ndarray]],
        curr_groups: Dict[str, np.ndarray],
        alpha:       float,
    ) -> Dict[str, np.ndarray]:
        if not prev_groups:
            return {n: p.astype(np.float32) for n, p in curr_groups.items()}
        return {
            n: self._smooth_pts(prev_groups.get(n), p, alpha)
            for n, p in curr_groups.items()
        }

    # =========================================================================
    # Core extraction
    # =========================================================================

    def _extract_landmarks_from_face(
        self,
        face_frame:    np.ndarray,
        target_center: Optional[Tuple[float, float]] = None,
        hint_yaw:      float = 0.0,
        hint_pitch:    float = 0.0,
    ) -> Optional[Dict[str, Any]]:
        """
        Extract landmarks from a face crop.

        Returns raw MediaPipe output mapped to pixel space.
        No smoothing is applied here.  All returned arrays are suitable
        for direct use in feature computation.
        """
        if face_frame.size == 0:
            return None

        orig_h, orig_w = face_frame.shape[:2]
        norm, sx, sy   = self._normalise_patch(face_frame)
        mesh_h, mesh_w = norm.shape[:2]

        res = self.face_mesh.process(cv2.cvtColor(norm, cv2.COLOR_BGR2RGB))
        if not res.multi_face_landmarks:
            return None

        lm = self._select_main_face(
            res.multi_face_landmarks, mesh_w, mesh_h,
            target_center=target_center if target_center else (0.5, 0.5),
        )
        if lm is None:
            return None

        # â”€â”€ Map landmarks back to original crop pixel space â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        pts  = lm[:, :2].copy()
        pts[:, 0] = np.clip(pts[:, 0] * mesh_w / max(sx, 1e-6), 0, orig_w - 1)
        pts[:, 1] = np.clip(pts[:, 1] * mesh_h / max(sy, 1e-6), 0, orig_h - 1)
        pts  = pts.astype(np.float32)

        # â”€â”€ Frontality / pose â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        frontality = self._assess_frontality(lm, pts, mesh_w, mesh_h, orig_w, orig_h)

        # Safety: check all required indices exist
        req_max = max(
            max(idx for grp in self.LANDMARK_GROUPS.values() for idx in grp),
            max(self.STABLE_LANDMARK_INDICES),
            max(i for pair in self.SYMMETRY_PAIRS for i in pair[:2]),
            max(self.L_EAR_IDX + self.R_EAR_IDX),
        )
        if req_max >= len(pts):
            return None

        # â”€â”€ Face geometry metrics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        xs, ys   = pts[:, 0], pts[:, 1]
        face_h   = max(1.0, float(ys.max() - ys.min()))
        face_w   = max(1.0, float(xs.max() - xs.min()))
        mid_x    = float((xs.max() + xs.min()) / 2.0)
        ref_scale = min(face_h, face_w)

        # â”€â”€ Group point arrays â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        overlay_groups = {
            name: pts[np.array(idx, dtype=np.int32)].astype(np.float32)
            for name, idx in self.LANDMARK_GROUPS.items()
        }
        stable_pts = pts[np.array(self.STABLE_LANDMARK_INDICES, dtype=np.int32)].astype(np.float32)

        # â”€â”€ Mouth openness (robust multi-point) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        # â”€â”€ Eye openness (EAR per eye) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        # â”€â”€ Face symmetry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        sym_score = self._face_symmetry(pts, mid_x, ref_scale)

        # â”€â”€ Canonical normalised landmarks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

        # â”€â”€ Local face bbox â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        local_bb = self._expand_bbox(
            (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())),
            orig_w, orig_h, self.LANDMARK_BOX_PADDING,
        )

        return {
            "face_bbox":         local_bb,
            "overlay_groups":    overlay_groups,
            "stable_points":     stable_pts,      # RAW â€” caller must not smooth before feature use
            "all_points":        pts.astype(np.float32) if self.draw_all_points else None,
            "face_symmetry":     sym_score,
            "landmark_quality":  frontality["landmark_quality"],
            "front_facing":      bool(frontality["front_facing"]),
            "pose_yaw":          float(frontality["pose_yaw"]),
            "pose_pitch":        float(frontality["pose_pitch"]),
            "eye_width_ratio":   float(frontality["eye_width_ratio"]),
        }

    # =========================================================================
    # Default result / track creation
    # =========================================================================

    @staticmethod
    def _default_result(vp: Path) -> Dict[str, Any]:
        return {
            "video_path":             vp.name,
            "landmark_jitter":        -1.0,
            "face_symmetry_mean":     -1.0,
            "face_symmetry_variance": -1.0,
            "duration":               0.0,
            "frames_processed":       0,
            "faces_detected":         0,
            "primary_track_id":       -1,
            "face_summaries":         [],
        }

    def _create_track(
        self,
        track_id: int,
        bbox:     Tuple[int, int, int, int],
        frame:    np.ndarray,
    ) -> Dict[str, Any]:
        n_stable = len(self.STABLE_LANDMARK_INDICES)
        return self._build_track(
            track_id, bbox, frame,
            {
                # â”€â”€ Feature sample accumulators â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                "face_symmetry_samples":    [],

                # â”€â”€ SMOOTHED history (rendering / overlay only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                # Stores EMA-smoothed + outlier-corrected stable points.
                # Do NOT use this deque for any feature computation â€” the
                # second derivative of an EMA signal is near-zero by definition.
                "stable_pts_history":       deque(maxlen=self.JITTER_WINDOW + 1),

                # â”€â”€ RAW history (feature computation) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                # Stores raw MediaPipe stable points BEFORE any velocity
                # correction or EMA smoothing. Used only for landmark_jitter.
                "raw_stable_pts_history":   deque(maxlen=self.JITTER_WINDOW + 1),

                # â”€â”€ State (smoothed rendering path) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                "previous_stable_points":   None,   # smoothed â€” for vel_tracker input
                "last_overlay_groups":      {},
                "last_all_points":          None,

                # â”€â”€ State (raw feature path) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                "previous_raw_stable_pts":  None,   # raw â€” for motion delta computation

                # â”€â”€ Cached scalars for HUD overlay â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                "last_motion":              0.0,
                "last_face_symmetry":       1.0,
                "last_yaw":                 0.0,
                "last_pitch":               0.0,
                "last_quality":             1.0,

                # â”€â”€ Velocity tracker (rendering path only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                "vel_tracker": _LandmarkVelocityTracker(
                    n_stable,
                    vel_alpha=0.35,
                    std_alpha=0.20,
                ),
            },
        )

    # =========================================================================
    # Deepfake-relevant jitter metric
    # =========================================================================

    @staticmethod
    def _compute_jitter(
        history: Deque[np.ndarray],
        ref_scale: float,
        step_frames: int = 1,
    ) -> float:
        """
        Mean second-derivative (acceleration) of stable landmark positions,
        normalised by face scale.

        Expected ranges:
          Real faces      : 0.002â€“0.035
          Deepfake (flat) : < 0.001  (rendering too smooth)
          Deepfake (noisy): > 0.04   (rendering artefacts)

        IMPORTANT: `history` must contain RAW (unsmoothed) stable-point
        arrays.  Passing smoothed arrays will produce near-zero jitter
        regardless of actual facial motion.
        """
        pts_list = list(history)
        if len(pts_list) < 3:
            return 0.0
        deltas = [pts_list[i+1] - pts_list[i] for i in range(len(pts_list)-1)]
        accels = [deltas[i+1] - deltas[i] for i in range(len(deltas)-1)]
        mean_accel = float(np.mean([np.mean(np.linalg.norm(a, axis=1)) for a in accels]))
        step_norm = max(int(step_frames), 1) ** 2
        return float(mean_accel / max(ref_scale * step_norm, 1.0))

    # =========================================================================
    # Track summary
    # =========================================================================

    def _track_summary(
        self,
        track: Dict[str, Any],
        sample_step: int = 1,
    ) -> Dict[str, Any]:

        def _var(vals: list) -> float:
            if len(vals) < 2:
                return 0.0
            return float(np.var(vals))

        sym_s     = track["face_symmetry_samples"]


        # â”€â”€ Landmark jitter from RAW history â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        # v2 FIX: use raw_stable_pts_history, NOT stable_pts_history.
        # stable_pts_history contains EMA-smoothed points; their second
        # derivative is suppressed toward zero by the smoothing kernel.
        # raw_stable_pts_history contains unmodified MediaPipe output, so
        # the second derivative reflects true facial micro-movement.
        raw_hist = track.get("raw_stable_pts_history", track["stable_pts_history"])
        raw_list = list(raw_hist)

        ref_sc = 1.0
        if len(raw_list) >= 2:
            ref_sc = float(np.mean(
                [np.linalg.norm(s[2] - s[3]) for s in raw_list if s is not None]
            ) or 1.0)

        jitter = self._compute_jitter(raw_hist, ref_sc, step_frames=sample_step)

        n  = track["frames_processed"]
        ar = float(track["bbox_area_ratio_sum"] / max(n, 1))
        cp = float(track["center_proximity_sum"] / max(n, 1))
        ps = float(n * (0.40 + ar) * (0.55 + 0.45 * cp)) if n > 0 else 0.0

        return {
            "track_id":                 track["track_id"],
            "frames_processed":         n,
            "observed_face_frames":     int(track.get("observed_face_frames", 0)),
            "frontal_face_frames":      int(track.get("frontal_face_frames", 0)),
            "frontal_face_ratio":       self._track_frontality_ratio(track),
            "face_symmetry_mean":       float(np.mean(sym_s)) if sym_s else 0.0,
            "face_symmetry_variance":   _var(sym_s),
            "landmark_jitter":          jitter,
            "avg_face_area_ratio":      ar,
            "avg_center_proximity":     cp,
            "primary_score":            ps,
        }

    # =========================================================================
    # Overlay rendering
    # =========================================================================

    def _draw_track_overlay(self, frame: np.ndarray, track: Dict[str, Any]) -> None:
        x1, y1, x2, y2 = track.get("smoothed_bbox", track["bbox"])
        fsize    = max(1, min(x2 - x1, y2 - y1))
        thick    = max(1, int(round(fsize / 120.0)))
        pr       = max(1, int(round(fsize / 170.0)))

        cv2.rectangle(frame, (x1, y1), (x2, y2), (20, 255, 20), 2)

        if self.draw_all_points and track.get("last_all_points") is not None:
            for pt in track["last_all_points"]:
                cv2.circle(frame, tuple(map(int, np.round(pt))), 1,
                           (240, 240, 240), -1, lineType=cv2.LINE_AA)

        for gname, pts in track.get("last_overlay_groups", {}).items():
            if pts is None or len(pts) == 0:
                continue
            st  = self.GROUP_STYLES.get(gname, {"color": (0, 255, 0), "closed": False})
            pl  = np.round(pts).astype(np.int32).reshape((-1, 1, 2))
            if len(pl) >= 2:
                cv2.polylines(frame, [pl], st["closed"], st["color"],
                              thick, lineType=cv2.LINE_AA)
            for px, py in np.round(pts).astype(np.int32):
                cv2.circle(frame, (int(px), int(py)), pr, st["color"],
                           -1, lineType=cv2.LINE_AA)

        label_y = max(20, y1 - 10)
        q_col   = (0, 255, int(255 * (1 - track.get("last_quality", 1.0))))
        cv2.putText(
            frame,
            (f"ID{track['track_id']} "
             f"Sym:{track['last_face_symmetry']:.3f} "
             f"Motion:{track['last_motion']:.3f} "
             f"Q:{track.get('last_quality', 1.0):.2f}"),
            (x1, label_y),
            cv2.FONT_HERSHEY_SIMPLEX, 0.50, q_col, 2,
        )
        cv2.putText(
            frame,
            (f"Yaw:{track.get('last_yaw', 0.0):.1f}Â° "
             f"Pitch:{track.get('last_pitch', 0.0):.1f}Â° "
             f"Box:{track['last_backend']}"),
            (x1, min(frame.shape[0] - 10, y2 + 20)),
            cv2.FONT_HERSHEY_SIMPLEX, 0.44, (255, 255, 255), 1,
        )

    # =========================================================================
    # Main video processing loop
    # =========================================================================

    def process_video(
        self,
        video_path:  Union[str, Path],
        display:     bool = False,
        output_path: Optional[Union[str, Path]] = None,
    ) -> Dict[str, Any]:
        vp     = Path(video_path)
        result = self._default_result(vp)
        cap    = None
        writer = None

        try:
            cap = cv2.VideoCapture(str(vp))
            fps        = cap.get(cv2.CAP_PROP_FPS)
            fc         = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            fw         = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            fh         = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            if fps <= 0 or fps > 120:
                fps = 30.0
            if fc <= 0 or fw <= 0 or fh <= 0:
                cap.release()
                return result

            result["duration"] = fc / fps

            if output_path is not None:
                output_path = Path(output_path)
                output_path.parent.mkdir(parents=True, exist_ok=True)
                writer = cv2.VideoWriter(
                    str(output_path),
                    cv2.VideoWriter_fourcc(*"mp4v"),
                    fps, (fw, fh),
                )
                if not writer.isOpened():
                    raise RuntimeError(f"Cannot open output video: {output_path}")

            skip_opts = [1] if (display or output_path) else (
                [self.frame_skip] + ([1] if self.frame_skip != 1 else [])
            )

            final_result   = None
            stop_requested = False

            for current_skip in skip_opts:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                pfi          = 0
                fi           = 0
                next_tid     = 1
                active: Dict[int, Dict[str, Any]] = {}
                all_t:  Dict[int, Dict[str, Any]] = {}

                min_track_frames   = max(6,  int(np.ceil(0.04  * fc / current_skip)))
                sum_min_frames     = max(6,  int(np.ceil(0.015 * fc / current_skip)))
                lost_reset_frames  = max(1,  int(np.ceil(self.LOST_FACE_RESET_SEC * fps / current_skip)))

                while True:
                    ret, frame = cap.read()
                    if not ret:
                        break

                    fi += 1
                    if fi % current_skip != 0:
                        if display or writer is not None:
                            if writer:
                                writer.write(frame)
                            if display:
                                cv2.imshow("Facial Landmarks", frame)
                                if cv2.waitKey(1) == 27:
                                    stop_requested = True
                                    break
                        continue

                    pfi += 1

                    # â”€â”€ YOLO detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                    run_det = (
                        pfi == 1
                        or pfi % self.YOLO_DETECTION_INTERVAL == 0
                        or not active
                    )
                    if self.yolo is not None and run_det:
                        dets     = self._detect_faces(frame)
                        next_tid = self._update_tracks_from_detections(
                            active, all_t, dets, next_tid, frame,
                            self._create_track, frame_index=pfi,
                        )
                        self._prune_overlapping_tracks(active)
                    elif self.yolo is None and not active:
                        t = self._create_track(next_tid, (0, 0, fw, fh), frame)
                        self._touch_track(t, pfi)
                        active[next_tid] = all_t[next_tid] = t
                        next_tid += 1

                    # â”€â”€ Per-track processing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                    for tid in list(active.keys()):
                        t = active.get(tid)
                        if t is None:
                            continue

                        # CV tracker update
                        if t["last_backend"] != "yolo":
                            tb = self._update_tracker_bbox(
                                t.get("tracker"), frame, fw, fh)
                            if tb is not None:
                                self._assign_track_bbox(
                                    t, tb, backend="tracker",
                                    reinit_tracker=False, frame_index=pfi,
                                )

                        # Adaptive crop padding from previous pose hint
                        pad  = self._adaptive_padding(
                            t.get("last_yaw", 0.0), t.get("last_pitch", 0.0))
                        bbox = self._expand_bbox(
                            t.get("smoothed_bbox", t["bbox"]), fw, fh, pad)

                        if bbox is None:
                            t["missing_frames"] += 1
                            if t["missing_frames"] >= lost_reset_frames:
                                t["previous_stable_points"] = None
                                t["previous_raw_stable_pts"] = None
                                t["last_overlay_groups"]    = {}
                            if t["missing_frames"] > self.TRACK_MAX_MISSES:
                                active.pop(tid, None)
                            continue

                        x1, y1, x2, y2 = bbox
                        tc = (
                            ((t["smoothed_bbox"][0] + t["smoothed_bbox"][2]) / 2 - x1) / max(x2 - x1, 1),
                            ((t["smoothed_bbox"][1] + t["smoothed_bbox"][3]) / 2 - y1) / max(y2 - y1, 1),
                        )
                        analysis = self._extract_landmarks_from_face(
                            frame[y1:y2, x1:x2],
                            target_center=tc,
                            hint_yaw=t.get("last_yaw", 0.0),
                            hint_pitch=t.get("last_pitch", 0.0),
                        )

                        if analysis is None:
                            t["missing_frames"] += 1
                            if t["missing_frames"] >= lost_reset_frames:
                                t["previous_stable_points"] = None
                                t["previous_raw_stable_pts"] = None
                                t["last_overlay_groups"]    = {}
                            if t["missing_frames"] > self.TRACK_MAX_MISSES:
                                active.pop(tid, None)
                            continue

                        t["missing_frames"] = 0
                        self._touch_track(t, pfi)
                        t["observed_face_frames"] = int(t.get("observed_face_frames", 0)) + 1
                        if analysis["front_facing"]:
                            t["frontal_face_frames"] = int(t.get("frontal_face_frames", 0)) + 1

                        # Refine bbox from mesh result
                        rb = self._translate_local_bbox_to_global(
                            analysis.get("face_bbox"), bbox, fw, fh)
                        if rb is not None:
                            if (self._bbox_iou(rb, t.get("smoothed_bbox", t["bbox"])) >= 0.08
                                    or self._bbox_center_distance_norm(rb, t.get("smoothed_bbox", t["bbox"])) <= 0.55):
                                self._assign_track_bbox(
                                    t, rb, frame=frame, backend="mesh", frame_index=pfi)

                        # â”€â”€ Translate to global frame â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                        stable_g   = self._to_global_pts(analysis["stable_points"], bbox)
                        groups_g   = self._groups_to_global(analysis["overlay_groups"], bbox)
                        all_pts_g  = self._to_global_pts(analysis.get("all_points"), bbox)

                        # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
                        # RAW PIPELINE  â†’  ALL feature metrics
                        # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                        # stable_g is direct MediaPipe output in global pixel
                        # space.  No outlier correction, no EMA applied.
                        # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

                        # Optional: inject tiny Gaussian noise to model sensor
                        # variation on synthetically perfect video sources.
                        # This keeps features non-degenerate without distorting
                        # real signal.  Set FEATURE_NOISE_STD = 0.0 to disable.
                        raw_stable_for_features = stable_g.copy()
                        if self.FEATURE_NOISE_STD > 0.0:
                            noise = np.random.normal(
                                0.0,
                                self.FEATURE_NOISE_STD,
                                raw_stable_for_features.shape,
                            ).astype(np.float32)
                            raw_stable_for_features += noise

                        # Feature: motion computed from RAW consecutive frames.
                        # previous_raw_stable_pts is also raw (never smoothed).
                        motion = self._landmark_motion(
                            t.get("previous_raw_stable_pts"),   # raw previous
                            raw_stable_for_features,             # raw current
                        )

                        # Accumulate raw history for jitter second-derivative.
                        # This deque must ONLY receive raw arrays â€” never
                        # stable_clean or EMA-smoothed points.
                        t["raw_stable_pts_history"].append(raw_stable_for_features.copy())

                        # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
                        # SMOOTHED PIPELINE  â†’  rendering / overlay only
                        # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                        # Outlier correction only fixes rendering glitches.
                        # The alpha from _adaptive_alpha only applies here.
                        # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

                        # Outlier-corrected version (rendering path)
                        stable_clean = t["vel_tracker"].update(
                            t.get("previous_stable_points"),    # smoothed previous
                            stable_g,                           # raw input
                        )

                        # Adaptive alpha driven by raw motion (alpha itself is
                        # used only in the smoothed render path below)
                        alpha = self._adaptive_alpha(motion)

                        # EMA-smooth overlay groups for stable rendering
                        smoothed_groups = self._smooth_groups(
                            t.get("last_overlay_groups"), groups_g, alpha)
                        smoothed_all = self._smooth_pts(
                            t.get("last_all_points"), all_pts_g, alpha)

                        # Smoothed deque (legacy / future compatibility only)
                        t["stable_pts_history"].append(stable_clean.copy())

                        # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
                        # FEATURE ACCUMULATION  â†’  all from raw pipeline
                        # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
                        quality = float(analysis["landmark_quality"])

                        t["face_symmetry_samples"].append(analysis["face_symmetry"])
                        # Raw pose values â€” _assess_frontality returns the
                        # unsmoothed yaw/pitch directly from the face basis.

                        # â”€â”€ State update â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                        # Raw state (feature path)
                        t["previous_raw_stable_pts"] = raw_stable_for_features

                        # Smoothed state (rendering path)
                        t["previous_stable_points"] = stable_clean
                        t["last_overlay_groups"]    = smoothed_groups
                        t["last_all_points"]        = smoothed_all

                        # HUD scalars (raw values so the overlay is informative)
                        t["last_motion"]         = motion
                        t["last_face_symmetry"]  = analysis["face_symmetry"]
                        t["last_yaw"]            = analysis["pose_yaw"]
                        t["last_pitch"]          = analysis["pose_pitch"]
                        t["last_quality"]        = quality
                        t["frames_processed"]   += 1

                        cb = t.get("smoothed_bbox", t["bbox"])
                        t["bbox_area_ratio_sum"] += (
                            max(0, cb[2]-cb[0]) * max(0, cb[3]-cb[1])
                        ) / max(1.0, fw * fh)
                        t["center_proximity_sum"] += self._center_proximity(cb, fw, fh)

                    # â”€â”€ Overlay rendering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                    if display or writer is not None:
                        out = frame.copy()
                        vt  = [t for t in active.values()
                               if t["frames_processed"] >= 1
                               and t.get("last_overlay_groups")]
                        cv2.putText(out, f"Tracked: {len(vt)}", (20, 35),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                        for t in vt:
                            self._draw_track_overlay(out, t)
                        if writer:
                            writer.write(out)
                        if display:
                            cv2.imshow("Facial Landmarks", out)
                            if cv2.waitKey(1) == 27:
                                stop_requested = True
                                break

                # â”€â”€ Build summaries â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                summaries = [
                    self._track_summary(t, sample_step=current_skip)
                    for t in all_t.values()
                    if (
                        t["frames_processed"] >= sum_min_frames
                        and not t.get("suppressed", False)
                        and self._track_is_frontal_majority(
                            t,
                            self.MIN_TRACK_FRONTAL_RATIO,
                            self.MIN_TRACK_FRONTAL_FRAMES,
                        )
                    )
                ]
                summaries.sort(
                    key=lambda s: (
                        s["primary_score"],
                        s["frames_processed"],
                        s.get("avg_face_area_ratio", 0.0),
                        s.get("avg_center_proximity", 0.0),
                    ),
                    reverse=True,
                )

                if summaries:
                    pf = summaries[0]
                    if pf["frames_processed"] >= min_track_frames:
                        final_result = {
                            "landmark_jitter":        pf["landmark_jitter"],
                            "face_symmetry_mean":     pf["face_symmetry_mean"],
                            "face_symmetry_variance": pf["face_symmetry_variance"],
                            "frames_processed":       pf["frames_processed"],
                            "faces_detected":         len(summaries),
                            "primary_track_id":       pf["track_id"],
                            "face_summaries":         summaries,
                        }
                        break

                if stop_requested:
                    break

            if final_result:
                result.update(final_result)

        except Exception as exc:
            print(f"  Error processing {vp.name}: {exc}")
            import traceback; traceback.print_exc()
        finally:
            if cap:
                cap.release()
            if writer:
                writer.release()
            if display:
                cv2.destroyAllWindows()

        return result

    # =========================================================================
    # Convenience entry points
    # =========================================================================

    def process_directory(self, directory: Path) -> List[Dict[str, Any]]:
        return [self.process_video(p) for p in sorted(directory.glob("*.mp4"))]

    def process(
        self,
        video_path:  Optional[Union[str, Path]] = None,
        display:     bool = True,
        output_path: Optional[Union[str, Path]] = None,
    ) -> Dict[str, Any]:
        if video_path is None:
            raise ValueError("Provide a video_path.")
        tp     = Path(video_path)
        result = self.process_video(tp, display=display, output_path=output_path)
        pf     = (result.get("face_summaries") or [{}])[0]

        print("\n" + "=" * 14 + " LANDMARK RESULTS " + "=" * 14)
        print(f"  Video              : {tp.name}")
        print(f"  Duration           : {result['duration']:.1f}s")
        print(f"  Faces tracked      : {result['faces_detected']}")
        print(f"  Primary face ID    : {result.get('primary_track_id', -1)}")
        print(f"  Frames processed   : {result['frames_processed']}")
        print("-" * 46)
        print(f"  Landmark jitter    : {result['landmark_jitter']:.5f}")
        print(f"  Face symmetry mean : {result['face_symmetry_mean']:.4f}")
        print(f"  Face symmetry var  : {result['face_symmetry_variance']:.6f}")
        if pf:
            print("-" * 46)
            print(f"  Frontal ratio      : {pf.get('frontal_face_ratio', 0):.2f}")
            print(f"  Landmark jitter    : {pf.get('landmark_jitter', 0):.5f}")
            print(f"  Face symmetry mean : {pf.get('face_symmetry_mean', 0):.4f}")
            print(f"  Face symmetry var  : {pf.get('face_symmetry_variance', 0):.6f}")
        print("=" * 46)
        return result


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if __name__ == "__main__":
    default_video = (
        r"D:\New_folder\deepfake_detection\deepfake_project\data\real\05__podium_speech_happy.mp4"
    )

    parser = argparse.ArgumentParser(
        description="Track facial landmarks on a video.")
    parser.add_argument("input_path", nargs="?", default=str(default_video))
    parser.add_argument("--frame-skip",      type=int,  default=1)
    parser.add_argument("--no-display",      action="store_true")
    parser.add_argument("--output",          type=str,  default=None)
    parser.add_argument("--draw-all-points", action="store_true")
    args = parser.parse_args()

    tp        = Path(args.input_path)
    extractor = RobustFacialLandmarkExtractor(
        frame_skip=args.frame_skip,
        draw_all_points=args.draw_all_points,
    )

    if tp.is_dir():
        if args.output:
            raise SystemExit("--output only supported for single files.")
        out = extractor.process_directory(tp)
    elif tp.is_file():
        out = extractor.process_video(
            tp, display=not args.no_display, output_path=args.output)
    else:
        raise SystemExit(f"Path not found: {tp}")

    print("\nâ”€â”€â”€â”€ FULL RESULT â”€â”€â”€â”€", flush=True)
    print(json.dumps(out, indent=2, default=str), flush=True)

