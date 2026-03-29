"""
Robust Blink Detector — optimised for deepfake detection.

Fixes over previous versions
─────────────────────────────
Bug 1 – Same face counted multiple times (high motion):
    • Hungarian-algorithm track assignment: one detection → one track, no splits.
    • Track-merge pass: any two tracks with IoU > 0.55 are collapsed into one.

Bug 2 – Multi-person counting wrong:
    • Every face gets its own independent track with its own blink state machine,
      baseline, and EAR history.
    • Primary face (dataset output) selected by area × centrality, not arrival order.

Bug 3 – Overcounting when face is partially/intermittently visible:
    • visibility_score gate: blink candidate only accepted when score >= 0.38.
    • Motion spike during a candidate or confirmed blink → blink is cancelled.
    • Baseline only updated from high-quality, frontal frames.

Bug 4 – Overcounting on face rotation / profile view:
    • Yaw estimated from eye-width asymmetry + nose-tip deviation.
    • Blink counting fully suppressed when |yaw| > 35°.
    • Mild rotation (22–35°) raises the required EAR drop proportionally.

Bug 5 – Small eyes not counted:
    • _thresholds() is now fully adaptive: close/open ratios scale with baseline
      magnitude so that a person whose open EAR is 0.17 gets the same relative
      sensitivity as one whose open EAR is 0.32.
    • min_drop is replaced by _adaptive_min_drop(): absolute floor falls to
      baseline × 8 % (≈ 0.013 for baseline 0.16) instead of a hard 0.016.
    • EAR smoothing is reduced to 2 frames for small-eye tracks so that the
      brief valley of a blink is not washed out.
    • The trigger EAR uses min(smoothed, raw) — whichever is lower — so
      single-frame dips are caught.
    • ew_ratio profile gate is relaxed from 0.55 → 0.42 for small-eye persons
      so natural small-eye width asymmetry doesn't force profile-mode suppression.
    • Face patches < 100 px on the short side are up-scaled to 480 px (vs 320)
      before FaceMesh, giving landmarks ~2× more pixel resolution.
    • Visibility gate is relaxed to 0.28 for confirmed small-eye tracks.

Deepfake features (field deepfake_features in every track summary)
────────────────────────────────────────────────────────────────────
interval_cv         std/mean of gaps    natural: 0.30–0.80
longest_gap_sec     longest blink-free stretch
"""

from __future__ import annotations

from collections import deque
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
import warnings

import cv2
import mediapipe as mp
import numpy as np

warnings.filterwarnings("ignore")

# ── Optional heavy dependencies ───────────────────────────────────────────────
try:
    import torch as _torch
    _TORCH_OK = True
except ImportError:
    _torch = None
    _TORCH_OK = False

try:
    from ultralytics import YOLO as _YOLO_CLS
    _YOLO_OK = True
except ImportError:
    _YOLO_CLS = None
    _YOLO_OK = False

try:
    from scipy.signal import find_peaks, savgol_filter
    from scipy.optimize import linear_sum_assignment
    _SCIPY_OK = True
except ImportError:
    _SCIPY_OK = False

# ─────────────────────────────────────────────────────────────────────────────
# Module-level helpers
# ─────────────────────────────────────────────────────────────────────────────

def _face_mesh_module():
    sol = getattr(mp, "solutions", None)
    if sol and hasattr(sol, "face_mesh"):
        return sol.face_mesh
    try:
        from mediapipe.python.solutions import face_mesh
        return face_mesh
    except ImportError as exc:
        raise RuntimeError("MediaPipe FaceMesh unavailable.") from exc


def _rolling_percentile(arr: np.ndarray, win: int, pct: float) -> np.ndarray:
    half = win // 2
    out  = np.empty_like(arr)
    n    = len(arr)
    for i in range(n):
        lo, hi = max(0, i - half), min(n, i + half + 1)
        out[i] = np.percentile(arr[lo:hi], pct)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Offline blink detection from stored EAR series
# ─────────────────────────────────────────────────────────────────────────────

def offline_blink_detection(
    ear_series:       List[Tuple[int, float, float]],
    fps:              float,
    frame_skip:       int,
    min_blink_sec:    float = 0.05,
    max_blink_sec:    float = 0.65,
    cooldown_sec:     float = 0.06,
    baseline_pct:     float = 70.0,
    baseline_win_sec: float = 3.0,
    min_drop_abs:     float = 0.014,
    min_drop_rel:     float = 0.08,
) -> Dict[str, Any]:
    """Valley-based blink detection on the full stored EAR signal."""
    empty: Dict[str, Any] = {
        "blink_count": 0, "timestamps": [],
        "durations_sec": [], "intervals_sec": [],
    }
    if len(ear_series) < 6:
        return empty

    frames = np.array([e[0] for e in ear_series], dtype=float)
    times  = np.array([e[1] for e in ear_series], dtype=float)
    ears   = np.array([e[2] for e in ear_series], dtype=float)

    sps = max(1.0, fps / frame_skip)

    # Smooth the EAR signal
    if _SCIPY_OK and len(ears) >= 7:
        wl = min(len(ears) if len(ears) % 2 else len(ears) - 1, 7)
        smooth = savgol_filter(ears, window_length=wl, polyorder=2)
    else:
        k = max(1, int(round(sps * 0.07)))
        smooth = np.convolve(ears, np.ones(k) / k, mode="same")
    smooth = np.clip(smooth, 0.0, 1.0)

    # Rolling baseline
    bwin = max(10, int(round(baseline_win_sec * sps)))
    if _SCIPY_OK:
        baseline = _rolling_percentile(smooth, bwin, baseline_pct)
    else:
        baseline = np.full_like(smooth, np.percentile(smooth, baseline_pct))
    baseline = np.clip(baseline, 0.10, 1.0)

    drop = baseline - smooth

    # Find valleys
    min_s   = max(1, int(round(min_blink_sec * sps)))
    max_s   = max(min_s + 1, int(round(max_blink_sec * sps)))
    cool_s  = max(1, int(round(cooldown_sec * sps)))
    prom    = max(min_drop_abs, float(np.mean(baseline)) * min_drop_rel)

    if _SCIPY_OK:
        peaks, props = find_peaks(drop, prominence=prom,
                                  width=(min_s, max_s), distance=cool_s)
        widths = props.get("widths", np.full(len(peaks), min_s, dtype=float))
    else:
        peaks  = _simple_valley(drop, prom, min_s, max_s, cool_s)
        widths = np.full(len(peaks), float(min_s))

    valid, durs = [], []
    for idx, p in enumerate(peaks):
        lb   = float(baseline[p])
        le   = float(smooth[p])
        dabs = lb - le
        drel = dabs / max(lb, 1e-6)
        if dabs >= min_drop_abs and drel >= 0.06:
            valid.append(int(p))
            durs.append(float(widths[idx] / sps))

    timestamps = [(int(frames[p]), float(times[p])) for p in valid]
    intervals  = [timestamps[i][1] - timestamps[i-1][1] for i in range(1, len(timestamps))]
    return {"blink_count": len(valid), "timestamps": timestamps,
            "durations_sec": durs, "intervals_sec": intervals}


def _simple_valley(drop, prom, min_w, max_w, min_d):
    n, peaks, i = len(drop), [], 0
    while i < n:
        if drop[i] >= prom:
            s = i
            while i < n and drop[i] >= prom:
                i += 1
            w = i - s
            if min_w <= w <= max_w:
                pk = s + int(np.argmax(drop[s:i]))
                if not peaks or pk - peaks[-1] >= min_d:
                    peaks.append(pk)
        else:
            i += 1
    return np.array(peaks, dtype=int)


def reconcile_counts(rt: int, pp_result: Dict) -> Tuple[int, str]:
    pp = pp_result["blink_count"]
    if rt == 0 and pp == 0:
        return 0, "agree"
    rel = abs(rt - pp) / max(rt, pp, 1)
    if rel <= 0.25:
        return pp, "agree"
    if pp > rt:
        return pp, "pp_higher"
    return int(round((rt + pp) / 2)), "rt_higher"


# ─────────────────────────────────────────────────────────────────────────────
# Deepfake feature computation
# ─────────────────────────────────────────────────────────────────────────────

def compute_deepfake_features(
    duration_sec:  float,
    timestamps:    List[Tuple[int, float]],
) -> Dict[str, Any]:
    """Compute blink statistics relevant for deepfake detection."""
    times      = [t for _, t in timestamps]
    intervals  = [times[i] - times[i-1] for i in range(1, len(times))]

    if len(intervals) >= 2:
        ia      = np.array(intervals)
        iv_cv   = float(ia.std() / max(ia.mean(), 1e-6))
    elif len(intervals) == 1:
        iv_cv = 0.0
    else:
        iv_cv = 0.0

    # Longest gap without a blink
    gaps = []
    if times:
        gaps.append(times[0])
        for i in range(1, len(times)):
            gaps.append(times[i] - times[i-1])
        gaps.append(duration_sec - times[-1])
    longest_gap = float(max(gaps)) if gaps else duration_sec

    return {
        "interval_cv":        round(iv_cv,       3),
        "longest_gap_sec":    round(longest_gap, 2),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Main detector class
# ─────────────────────────────────────────────────────────────────────────────

class BlinkDetector:
    """
    Robust blink detector with YOLO face tracking + MediaPipe FaceMesh EAR.
    Designed for high-accuracy blink counting in deepfake detection pipelines.
    """

    # ── MediaPipe landmark indices ────────────────────────────────────────────
    L_EYE  = [33,  160, 158, 133, 153, 144]
    R_EYE  = [362, 385, 387, 263, 373, 380]
    MESH_SZ = 320

    MIN_DET_CONF   = 0.40
    MIN_TRACK_CONF = 0.50

    # ── Blink timing ──────────────────────────────────────────────────────────
    MIN_BLINK_SEC  = 0.05
    MAX_BLINK_SEC  = 0.65
    COOLDOWN_SEC   = 0.06
    LOST_RESET_SEC = 0.25

    # ── EAR / baseline ────────────────────────────────────────────────────────
    EAR_SMOOTH_WIN = 3
    BASELINE_WIN   = 90
    BASELINE_PCT   = 72.0
    MIN_BL_SAMP    = 14
    MIN_DROP_SINGLE = 0.016    # single-face mode (less noise)
    MIN_DROP_MULTI  = 0.040    # multi-face mode (stricter — more clutter)
    REOPEN_RATIO   = 0.42

    # ── Yaw / visibility gating ───────────────────────────────────────────────
    YAW_GATE_DEG    = 35.0     # hard gate — suppress blinks above this
    YAW_SOFT_DEG    = 22.0     # soft gate — raise threshold linearly up to hard gate
    VISIBILITY_GATE = 0.38     # minimum visibility score to accept any blink
    MIN_EW_RATIO    = 0.55     # below this → profile

    # ── Motion gating ─────────────────────────────────────────────────────────
    MAX_BLINK_MOTION  = 0.28
    MOTION_DROP_BONUS = 0.018

    # ── YOLO / tracking ───────────────────────────────────────────────────────
    YOLO_CONF        = 0.30
    FACE_PAD         = 0.22
    CLOSE_FACE_R     = 0.045
    CLOSE_FACE_GAIN  = 1.20
    PROFILE_PAD_BON  = 0.08
    BBOX_ALPHA       = 0.88
    YOLO_INTERVAL    = 3
    SF_YOLO_INTERVAL = 2
    TRACK_IOU_MIN    = 0.15
    TRACK_MERGE_IOU  = 0.55
    TRACK_MAX_MISS   = 14

    # ── Multi-face probing ────────────────────────────────────────────────────
    PROBE_FRAMES   = 24
    MULTI_CONFIRM  = 3
    SEC_AREA_R     = 0.38

    # ── Warmup ───────────────────────────────────────────────────────────────
    FRONTAL_WARMUP = 3
    PROFILE_WARMUP = 5

    # ── Small-eye adaptations ────────────────────────────────────────────────
    # A "small eye" is detected when the stabilised open-eye baseline EAR is
    # below this value.  East-Asian eyes, hooded lids, and partially-lit faces
    # commonly fall here (typical range 0.14–0.22 vs 0.25–0.38 for larger eyes).
    SMALL_EYE_BASELINE      = 0.22   # below this → small-eye mode
    SMALL_EYE_MESH_SZ       = 480    # up-sample small patches before FaceMesh
    SMALL_EYE_PATCH_THRESH  = 100    # px on shortest side triggers up-sampling
    SMALL_EYE_SMOOTH_WIN    = 2      # fewer frames to preserve sharp EAR dip
    SMALL_EYE_CLOSE_RATIO   = 0.91   # close_thr = baseline × this (vs 0.86 normal)
    SMALL_EYE_OPEN_RATIO    = 0.96   # open_thr  = baseline × this (vs 0.93 normal)
    SMALL_EYE_DROP_REL      = 0.08   # min drop = max(abs_floor, baseline × this)
    SMALL_EYE_DROP_ABS      = 0.010  # absolute floor for min drop in small-eye mode
    SMALL_EYE_MIN_EW_RATIO  = 0.42   # relaxed profile gate (vs 0.55)
    SMALL_EYE_VIS_GATE      = 0.28   # relaxed visibility gate (vs 0.38)
    SMALL_EYE_CONFIRM_SAMP  = 20     # baseline samples needed before locking small-eye mode

    # ─────────────────────────────────────────────────────────────────────────

    def __init__(
        self,
        video_path:    Optional[Union[str, Path]] = None,
        frame_skip:    int  = 1,
        tracking_mode: str  = "auto",
        static_image:  bool = False,
    ):
        self.video_path    = Path(video_path) if video_path else None
        self.frame_skip    = max(1, frame_skip)
        self.tracking_mode = tracking_mode.lower().strip()
        if self.tracking_mode not in {"auto", "single", "multi"}:
            raise ValueError("tracking_mode must be 'auto', 'single', or 'multi'.")

        self.device = "cuda" if _TORCH_OK and _torch.cuda.is_available() else "cpu"

        fm = _face_mesh_module()
        self._fm = fm.FaceMesh(
            static_image_mode=static_image,
            max_num_faces=6,
            refine_landmarks=True,
            min_detection_confidence=self.MIN_DET_CONF,
            min_tracking_confidence=self.MIN_TRACK_CONF,
        )

        self._yolo = None
        if _YOLO_OK:
            mp_path = Path(__file__).with_name("yolov8n-face-lindevs.pt")
            if mp_path.exists():
                self._yolo = _YOLO_CLS(str(mp_path))
                try:
                    self._yolo.to(self.device)
                except Exception:
                    pass

    # =========================================================================
    # EAR / MediaPipe helpers
    # =========================================================================

    @staticmethod
    def _ear(eye: np.ndarray) -> float:
        v1 = np.linalg.norm(eye[1] - eye[5])
        v2 = np.linalg.norm(eye[2] - eye[4])
        h  = np.linalg.norm(eye[0] - eye[3])
        return float((v1 + v2) / (2.0 * h)) if h > 1e-6 else 0.0

    @staticmethod
    def _estimate_yaw(lm: np.ndarray, fw: int, fh: int) -> float:
        """
        Estimate absolute yaw angle (degrees) from FaceMesh landmarks.
        Uses eye-width asymmetry + nose-tip deviation from eye midline.
        Returns 0 when frontal, ~90 when fully side-on.
        """
        le_idx = [33, 133, 160, 158, 144, 153]
        re_idx = [362, 263, 385, 387, 373, 380]
        le_c   = lm[le_idx, :2].mean(0)
        re_c   = lm[re_idx, :2].mean(0)
        span   = abs(re_c[0] - le_c[0])
        if span < 1e-4:
            return 90.0

        lw = float(np.linalg.norm(lm[33, :2]  - lm[133, :2]))
        rw = float(np.linalg.norm(lm[362, :2] - lm[263, :2]))
        ratio      = min(lw, rw) / max(lw, rw, 1e-6)
        yaw_ratio  = float(np.degrees(np.arccos(np.clip(ratio, 0.0, 1.0))))

        nose   = float(lm[1, 0])
        mid_x  = (le_c[0] + re_c[0]) / 2.0
        dev    = abs(nose - mid_x) / span
        yaw_nose = float(np.degrees(np.arctan2(dev, 0.5)))

        return float(np.clip((yaw_ratio + yaw_nose) / 2.0, 0.0, 90.0))

    def _normalise(self, img: np.ndarray, target_sz: Optional[int] = None) -> Tuple[np.ndarray, float, float]:
        h, w  = img.shape[:2]
        tsz   = target_sz if target_sz is not None else self.MESH_SZ
        s     = tsz / max(h, w)
        nw    = max(1, int(round(w * s)))
        nh    = max(1, int(round(h * s)))
        if nw == w and nh == h:
            return img, 1.0, 1.0
        interp = cv2.INTER_LINEAR if s >= 1.0 else cv2.INTER_AREA
        return cv2.resize(img, (nw, nh), interpolation=interp), nw / max(w, 1), nh / max(h, 1)

    def _extract_ears(
        self,
        patch:         np.ndarray,
        target_center: Optional[Tuple[float, float]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Run FaceMesh on a face patch; return EAR data + quality metrics.

        Small-eye improvement: patches whose short side is below
        SMALL_EYE_PATCH_THRESH pixels are up-sampled to SMALL_EYE_MESH_SZ
        before landmark fitting, giving MediaPipe ~2× more resolution on the
        eye region.
        """
        if patch.size == 0:
            return None
        oh, ow = patch.shape[:2]

        # Choose mesh resolution — larger for tiny patches
        tsz = (self.SMALL_EYE_MESH_SZ
               if min(oh, ow) < self.SMALL_EYE_PATCH_THRESH
               else self.MESH_SZ)

        norm, sx, sy = self._normalise(patch, target_sz=tsz)
        fh, fw = norm.shape[:2]

        res = self._fm.process(cv2.cvtColor(norm, cv2.COLOR_BGR2RGB))
        if not res.multi_face_landmarks:
            return None

        tc = target_center if target_center else (0.5, 0.5)
        best_lm, best_sc = None, -1.0
        for fl in res.multi_face_landmarks:
            lm = np.array([[l.x, l.y, l.z] for l in fl.landmark], dtype=np.float32)
            xs, ys = lm[:, 0] * fw, lm[:, 1] * fh
            area   = float((xs.max() - xs.min()) * (ys.max() - ys.min()))
            cx, cy = float(xs.mean() / fw), float(ys.mean() / fh)
            d      = np.hypot(cx - tc[0], cy - tc[1])
            sc     = area * (0.40 + 0.60 * max(0.0, 1.0 - d / 0.75))
            if sc > best_sc:
                best_sc, best_lm = sc, lm
        lm = best_lm

        le_pts = np.array([[lm[i, 0]*fw, lm[i, 1]*fh] for i in self.L_EYE], dtype=np.float32)
        re_pts = np.array([[lm[i, 0]*fw, lm[i, 1]*fh] for i in self.R_EYE], dtype=np.float32)
        lear, rear = self._ear(le_pts), self._ear(re_pts)
        if lear <= 0.0 or rear <= 0.0:
            return None

        lew = float(np.linalg.norm(le_pts[0] - le_pts[3]))
        rew = float(np.linalg.norm(re_pts[0] - re_pts[3]))
        if lew <= 1e-6 or rew <= 1e-6:
            return None

        # eye_px_width: average eye width in the *original* patch pixels
        # (used downstream to flag small-eye persons)
        eye_px_width = ((lew / max(sx, 1e-6)) + (rew / max(sx, 1e-6))) / 2.0

        ew_ratio   = min(lew, rew) / max(lew, rew)
        balance    = min(lear, rear) / max(lear, rear, 1e-6)
        yaw_deg    = self._estimate_yaw(lm, fw, fh)

        # Relaxed profile gate for small eyes (small ew_ratio can be natural asymmetry)
        mean_ear_now = 0.5 * (lear + rear)
        likely_small = mean_ear_now < self.SMALL_EYE_BASELINE
        ew_profile_gate = self.SMALL_EYE_MIN_EW_RATIO if likely_small else self.MIN_EW_RATIO
        is_profile = (yaw_deg >= self.YAW_GATE_DEG or ew_ratio < ew_profile_gate)

        asym_w   = float(np.clip((0.90 - balance) / 0.30, 0.0, 1.0))
        mean_e   = 0.5 * (lear + rear)
        low_e    = 0.80 * min(lear, rear) + 0.20 * max(lear, rear)
        combined = (lear if lew >= rew else rear) if is_profile \
                   else ((1.0 - asym_w) * mean_e + asym_w * low_e)

        lmx, lmy = lm[:, 0] * fw, lm[:, 1] * fh
        local_bb = self._expand_bbox(
            (int(lmx.min()), int(lmy.min()), int(lmx.max()), int(lmy.max())),
            fw, fh, 0.10
        )
        if local_bb:
            local_bb = (
                int(round(local_bb[0] / max(sx, 1e-6))),
                int(round(local_bb[1] / max(sy, 1e-6))),
                int(round(local_bb[2] / max(sx, 1e-6))),
                int(round(local_bb[3] / max(sy, 1e-6))),
            )
            local_bb = self._clip_bbox(local_bb, ow, oh)

        return {
            "ear":          combined,
            "left_ear":     lear,
            "right_ear":    rear,
            "balance":      balance,
            "ew_ratio":     ew_ratio,
            "yaw_deg":      yaw_deg,
            "is_profile":   is_profile,
            "face_bbox":    local_bb,
            "eye_px_width": eye_px_width,   # new — for small-eye detection
        }

    # =========================================================================
    # BBox helpers
    # =========================================================================

    @staticmethod
    def _expand_bbox(bbox, fw, fh, pad):
        x1, y1, x2, y2 = bbox
        bw, bh = x2 - x1, y2 - y1
        if bw <= 0 or bh <= 0:
            return None
        px, py = int(bw * pad), int(bh * pad)
        x1, y1 = max(0, x1 - px), max(0, y1 - py)
        x2, y2 = min(fw, x2 + px), min(fh, y2 + py)
        return (x1, y1, x2, y2) if x2 > x1 and y2 > y1 else None

    @staticmethod
    def _clip_bbox(bbox, fw, fh):
        x1, y1, x2, y2 = bbox
        x1 = max(0, min(fw - 1, int(round(x1))))
        y1 = max(0, min(fh - 1, int(round(y1))))
        x2 = max(0, min(fw,     int(round(x2))))
        y2 = max(0, min(fh,     int(round(y2))))
        return (x1, y1, x2, y2) if x2 > x1 and y2 > y1 else None

    def _smooth_box(self, prev, new):
        if prev is None:
            return new
        a = self.BBOX_ALPHA
        return tuple(int(round(a * p + (1 - a) * n)) for p, n in zip(prev, new))

    @staticmethod
    def _iou(a, b):
        ax1, ay1, ax2, ay2 = a
        bx1, by1, bx2, by2 = b
        ix = max(0, min(ax2, bx2) - max(ax1, bx1))
        iy = max(0, min(ay2, by2) - max(ay1, by1))
        inter = ix * iy
        if inter == 0:
            return 0.0
        ua = max(0, ax2-ax1) * max(0, ay2-ay1)
        ub = max(0, bx2-bx1) * max(0, by2-by1)
        return float(inter / max(ua + ub - inter, 1))

    @staticmethod
    def _center_dist(a, b):
        ax1, ay1, ax2, ay2 = a
        bx1, by1, bx2, by2 = b
        d = np.hypot((ax1+ax2)/2 - (bx1+bx2)/2, (ay1+ay2)/2 - (by1+by2)/2)
        s = max(1.0, (ax2-ax1+bx2-bx1)/2, (ay2-ay1+by2-by1)/2)
        return float(d / s)

    @staticmethod
    def _area(bb):
        return float(max(0, bb[2]-bb[0]) * max(0, bb[3]-bb[1]))

    @staticmethod
    def _center_prox(bb, fw, fh):
        x1, y1, x2, y2 = bb
        d = np.hypot((x1+x2)/2 - fw/2, (y1+y2)/2 - fh/2)
        return float(max(0.0, 1.0 - d / max(1.0, np.hypot(fw/2, fh/2))))

    def _face_pad(self, bb, fw, fh, is_profile: bool = False) -> float:
        r = self._area(bb) / max(1.0, fw * fh)
        p = self.FACE_PAD
        if r > self.CLOSE_FACE_R:
            p += min(0.16, (r - self.CLOSE_FACE_R) * self.CLOSE_FACE_GAIN)
        if is_profile:
            p += self.PROFILE_PAD_BON
        return float(min(0.50, p))

    def _local_to_global(self, local_bb, crop_bb, fw, fh):
        if local_bb is None:
            return None
        cx1, cy1 = crop_bb[0], crop_bb[1]
        return self._clip_bbox(
            (cx1+local_bb[0], cy1+local_bb[1], cx1+local_bb[2], cy1+local_bb[3]),
            fw, fh
        )

    # =========================================================================
    # YOLO detection
    # =========================================================================

    def _detect(self, frame: np.ndarray) -> List[Dict]:
        if self._yolo is None:
            return []
        try:
            r = self._yolo(frame, conf=self.YOLO_CONF, verbose=False)
        except Exception:
            return []
        if not r or r[0].boxes is None or len(r[0].boxes) == 0:
            return []
        boxes = r[0].boxes.xyxy.cpu().numpy()
        confs = r[0].boxes.conf.cpu().numpy()
        out   = []
        for box, c in zip(boxes, confs):
            bb = tuple(map(int, box[:4]))
            if bb[2] > bb[0] and bb[3] > bb[1]:
                out.append({"bbox": bb, "conf": float(c)})
        out.sort(key=lambda d: self._area(d["bbox"]) * d["conf"], reverse=True)
        return out

    # =========================================================================
    # OpenCV tracker
    # =========================================================================

    @staticmethod
    def _make_cv_tracker():
        for name in ["TrackerKCF_create", "TrackerCSRT_create"]:
            f = getattr(cv2, name, None)
            if f:
                return f()
            leg = getattr(cv2, "legacy", None)
            if leg:
                f = getattr(leg, name, None)
                if f:
                    return f()
        return None

    def _init_tracker(self, frame, bbox):
        t = self._make_cv_tracker()
        if t is None:
            return None
        x1, y1, x2, y2 = bbox
        try:
            t.init(frame, (int(x1), int(y1), int(x2-x1), int(y2-y1)))
            return t
        except Exception:
            return None

    def _update_tracker(self, tracker, frame, fw, fh):
        if tracker is None:
            return None
        try:
            ok, tb = tracker.update(frame)
        except Exception:
            return None
        if not ok:
            return None
        x, y, w, h = tb
        return self._clip_bbox(
            (int(round(x)), int(round(y)), int(round(x+w)), int(round(y+h))), fw, fh
        )

    # =========================================================================
    # Track management
    # =========================================================================

    @staticmethod
    def _new_blink_state() -> Dict:
        return {
            "active":        False,
            "cand_frames":   0,
            "closed_frames": 0,
            "min_ear":       1.0,
            "peak_drop":     0.0,
            "entry_ear":     0.0,
            "rapid":         False,
        }

    def _new_track(self, tid: int, bbox, frame: np.ndarray) -> Dict:
        return {
            "id":           tid,
            "bbox":         bbox,
            "smooth_bbox":  bbox,
            "tracker":      self._init_tracker(frame, bbox),
            "blink_state":  self._new_blink_state(),
            "cooldown":     0,
            "missing":      0,
            "n_frames":     0,
            "blink_count":  0,
            "suppressed":   False,
            "ear_values":   [],
            "ear_series":   [],
            "smooth_win":   deque(maxlen=self.EAR_SMOOTH_WIN),
            "baseline_win": deque(maxlen=self.BASELINE_WIN),
            "last_ear":     0.0,
            "last_raw_ear": 0.0,
            "last_motion":  0.0,
            "last_yaw":     0.0,
            "last_balance": 1.0,
            "last_ew":      1.0,
            "last_vis":     1.0,
            "last_status":  "Init",
            "last_backend": "yolo",
            "is_profile":   False,
            "mode_frames":  0,
            "area_sum":     0.0,
            "prox_sum":     0.0,
            # ── Small-eye state ───────────────────────────────────────────
            # is_small_eye is locked True once the baseline stabilises below
            # SMALL_EYE_BASELINE.  It is never reset to False because a person's
            # anatomy does not change within a video.
            "is_small_eye":      False,
            "small_eye_locked":  False,   # becomes True after SMALL_EYE_CONFIRM_SAMP
        }

    def _set_bbox(self, track, new_bb, frame=None, backend=None, reinit=True):
        prev   = track.get("smooth_bbox")
        motion = self._center_dist(prev, new_bb) if prev else 0.0
        track["bbox"]        = new_bb
        track["smooth_bbox"] = self._smooth_box(prev, new_bb)
        track["last_motion"] = motion
        if frame is not None and reinit:
            track["tracker"] = self._init_tracker(frame, new_bb)
        if backend:
            track["last_backend"] = backend

    def _select_primary(self, dets, fw, fh, previous_bbox=None):
        best, best_s = None, -1.0
        fa = max(1.0, fw * fh)
        for d in dets:
            bb = d["bbox"]
            ar = self._area(bb) / fa
            cb = self._center_prox(bb, fw, fh)
            tb = 1.0
            if previous_bbox is not None:
                iou = self._iou(bb, previous_bbox)
                cm  = max(0.0, 1.0 - min(self._center_dist(bb, previous_bbox), 1.0))
                tb  = 0.45 + 0.55 * max(iou, cm)
            s = d["conf"] * (0.35 + 0.65 * cb) * (0.25 + ar) * tb
            if s > best_s:
                best_s, best = s, d
        return best

    def _has_multi(self, dets, fw, fh):
        if len(dets) < 2:
            return False
        pa = self._area(dets[0]["bbox"])
        return pa > 0 and any(self._area(d["bbox"]) >= pa * self.SEC_AREA_R for d in dets[1:])

    def _match_tracks(
        self, active: Dict[int, Dict], dets: List[Dict]
    ) -> Tuple[Dict[int, int], List[int]]:
        """
        Hungarian-algorithm detection→track assignment.
        Guarantees: one detection → at most one track (bug fix 1).
        """
        tids = list(active.keys())
        if not tids or not dets:
            return {}, list(range(len(dets)))

        n_d, n_t = len(dets), len(tids)
        cost = np.full((n_d, n_t), 1e6, dtype=float)
        for di, d in enumerate(dets):
            for ti, tid in enumerate(tids):
                tb  = active[tid].get("smooth_bbox", active[tid]["bbox"])
                iou = self._iou(d["bbox"], tb)
                cd  = self._center_dist(d["bbox"], tb)
                if iou >= self.TRACK_IOU_MIN or cd <= 0.50:
                    cost[di, ti] = 1.0 - iou + 0.25 * cd

        if _SCIPY_OK:
            d_idx, t_idx = linear_sum_assignment(cost)
        else:
            flat   = sorted(range(n_d * n_t), key=lambda x: cost[x//n_t, x%n_t])
            used_d: set = set()
            used_t: set = set()
            d_idx_l, t_idx_l = [], []
            for k in flat:
                di, ti = k // n_t, k % n_t
                if di not in used_d and ti not in used_t and cost[di, ti] < 1e5:
                    d_idx_l.append(di); t_idx_l.append(ti)
                    used_d.add(di); used_t.add(ti)
            d_idx = np.array(d_idx_l, dtype=int)
            t_idx = np.array(t_idx_l, dtype=int)

        matches: Dict[int, int] = {}
        for di, ti in zip(d_idx, t_idx):
            if cost[int(di), int(ti)] < 1e5:
                matches[int(di)] = tids[int(ti)]

        unmatched = [di for di in range(n_d) if di not in matches]
        return matches, unmatched

    def _update_tracks(self, active, all_tracks, dets, nxt, frame):
        matches, unmatched = self._match_tracks(active, dets)
        for t in active.values():
            t["last_backend"] = "track"
        for di, tid in matches.items():
            self._set_bbox(active[tid], dets[di]["bbox"], frame=frame, backend="yolo")
            active[tid]["missing"] = 0
        for di in unmatched:
            t = self._new_track(nxt, dets[di]["bbox"], frame)
            active[nxt] = all_tracks[nxt] = t
            nxt += 1
        return nxt

    def _merge_overlapping(self, active: Dict[int, Dict]) -> None:
        """
        Collapse any two tracks that largely overlap into one.
        Preserves the higher blink count to avoid data loss (bug fix 1).
        """
        tids = list(active.keys())
        drop: set = set()
        for i, ta in enumerate(tids):
            if ta in drop or ta not in active:
                continue
            ba = active[ta].get("smooth_bbox", active[ta]["bbox"])
            for tb_id in tids[i + 1:]:
                if tb_id in drop or tb_id not in active:
                    continue
                bb = active[tb_id].get("smooth_bbox", active[tb_id]["bbox"])
                if self._iou(ba, bb) < self.TRACK_MERGE_IOU:
                    continue
                ka = (active[ta]["n_frames"],    active[ta]["blink_count"],    -ta)
                kb = (active[tb_id]["n_frames"], active[tb_id]["blink_count"], -tb_id)
                keep, lose = (ta, tb_id) if ka >= kb else (tb_id, ta)
                active[keep]["blink_count"] = max(
                    active[keep]["blink_count"], active[lose]["blink_count"]
                )
                active[lose]["suppressed"] = True
                drop.add(lose)
        for tid in drop:
            active.pop(tid, None)

    def _probe_mode(self, cap, skip: int) -> str:
        if self.tracking_mode != "auto":
            return self.tracking_mode
        if self._yolo is None:
            return "single"
        orig = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        fw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        fh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        sampled = multi_cnt = fi = 0
        while sampled < self.PROBE_FRAMES:
            ok, frame = cap.read()
            if not ok:
                break
            fi += 1
            if fi % skip != 0:
                continue
            if self._has_multi(self._detect(frame), fw, fh):
                multi_cnt += 1
            sampled += 1
        cap.set(cv2.CAP_PROP_POS_FRAMES, orig)
        return "multi" if multi_cnt >= self.MULTI_CONFIRM else "single"

    # =========================================================================
    # Blink state machine
    # =========================================================================

    @staticmethod
    def _thresholds(baseline: float, is_small_eye: bool = False) -> Tuple[float, float]:
        """
        Adaptive EAR thresholds relative to the individual's open-eye baseline.

        Normal eyes  (baseline ≥ 0.22): close = 86 %, open = 93 % of baseline.
        Small eyes   (baseline <  0.22): close = 91 %, open = 96 % of baseline.

        Using a higher ratio for small eyes means the close_threshold sits
        closer to the baseline — essential because a full blink on a 0.17
        baseline produces an EAR drop of only ~0.04, not the ~0.07 a normal
        eye produces.
        """
        if is_small_eye:
            close_r, open_r = 0.91, 0.96
            abs_floor       = 0.08
        else:
            close_r, open_r = 0.86, 0.93
            abs_floor       = 0.11

        close = max(abs_floor, min(baseline * close_r, baseline - 0.012))
        open_ = max(close + 0.010, min(baseline * open_r, baseline - 0.006))
        return float(close), float(open_)

    def _adaptive_min_drop(self, baseline: float, is_small_eye: bool = False) -> float:
        """
        Return the minimum EAR drop required to register a blink candidate.

        For small eyes the absolute floor is lower and the relative floor
        (percentage of baseline) is the binding constraint.
        """
        if is_small_eye:
            return float(max(self.SMALL_EYE_DROP_ABS,
                             baseline * self.SMALL_EYE_DROP_REL))
        return float(max(self.MIN_DROP_SINGLE, baseline * 0.06))

    @staticmethod
    def _visibility(yaw_deg: float, ew_ratio: float, balance: float,
                    motion: float, is_small_eye: bool = False) -> float:
        """
        0–1 reliability score for the current EAR measurement.

        Small-eye persons naturally show lower eye-balance and ew_ratio values,
        so the balance and ratio components are scored against relaxed targets.
        """
        y = float(np.clip(1.0 - yaw_deg / 90.0, 0.0, 1.0))
        # Relax balance target for small eyes (natural asymmetry is larger)
        bal_target = 0.65 if is_small_eye else 0.80
        b = float(np.clip(balance  / bal_target, 0.0, 1.0))
        # Relax ew_ratio target for small eyes
        ew_target  = 0.70 if is_small_eye else 0.90
        r = float(np.clip(ew_ratio / ew_target,  0.0, 1.0))
        m = float(np.clip(1.0 - motion / 0.50,   0.0, 1.0))
        return float(y * 0.40 + b * 0.25 + r * 0.20 + m * 0.15)

    def _update_blink(
        self,
        track:     Dict,
        analysis:  Dict,
        fps:       float,
        skip:      int,
        mcf:       int,
        mxcf:      int,
        cdf:       int,
        min_drop:  float,   # base floor — overridden adaptively below
        frame_idx: int   = 0,
        time_sec:  float = 0.0,
    ) -> None:
        ear        = analysis["ear"]
        lear       = analysis["left_ear"]
        rear_      = analysis["right_ear"]
        balance    = analysis["balance"]
        ew_ratio   = analysis["ew_ratio"]
        yaw_deg    = analysis["yaw_deg"]
        is_profile = analysis["is_profile"]
        motion     = track["last_motion"]

        # ── Detect / confirm small-eye mode ───────────────────────────────────
        # We look at the current EAR sample.  Once we have enough baseline
        # samples we lock the flag — it never flips back to False.
        is_small_eye: bool = track["is_small_eye"]
        if not track["small_eye_locked"]:
            # Use the per-frame raw combined EAR as an early signal
            if ear < self.SMALL_EYE_BASELINE:
                track["is_small_eye"] = True
                is_small_eye = True
            # Lock once the baseline window is large enough and agrees
            if len(track["baseline_win"]) >= self.SMALL_EYE_CONFIRM_SAMP:
                stable_bl = float(np.percentile(
                    list(track["baseline_win"]), self.BASELINE_PCT))
                track["is_small_eye"]     = stable_bl < self.SMALL_EYE_BASELINE
                track["small_eye_locked"] = True
                is_small_eye = track["is_small_eye"]

        # ── Smoothing window: smaller for small eyes to preserve EAR dips ────
        desired_win = (self.SMALL_EYE_SMOOTH_WIN if is_small_eye
                       else self.EAR_SMOOTH_WIN)
        if track["smooth_win"].maxlen != desired_win:
            track["smooth_win"] = deque(list(track["smooth_win"])[-desired_win:],
                                        maxlen=desired_win)

        # ── Store sample ──────────────────────────────────────────────────────
        track["smooth_win"].append(ear)
        smoothed = float(np.mean(track["smooth_win"]))

        # For small eyes use the lower of smoothed vs raw to catch sharp dips
        trigger_ear = min(smoothed, ear) if is_small_eye else smoothed

        track["n_frames"]    += 1
        track["ear_values"].append(smoothed)
        track["ear_series"].append((frame_idx, time_sec, smoothed))
        track["last_ear"]     = smoothed
        track["last_raw_ear"] = ear
        track["last_yaw"]     = yaw_deg
        track["last_balance"] = balance
        track["last_ew"]      = ew_ratio

        # ── Mode change resets state ──────────────────────────────────────────
        if is_profile != track.get("is_profile", False):
            track["is_profile"]  = is_profile
            track["mode_frames"] = 0
            track["blink_state"] = self._new_blink_state()
            track["smooth_win"].clear()
            track["baseline_win"].clear()
            track["smooth_win"].append(ear)
            track["cooldown"] = max(track["cooldown"], 2)

        track["mode_frames"] += 1
        if track["cooldown"] > 0:
            track["cooldown"] -= 1

        # ── Visibility score ──────────────────────────────────────────────────
        vis = self._visibility(yaw_deg, ew_ratio, balance, motion,
                                is_small_eye=is_small_eye)
        track["last_vis"] = vis

        # ── Warm-up ───────────────────────────────────────────────────────────
        # Small eyes need a longer warm-up to collect enough baseline samples.
        base_warmup = self.PROFILE_WARMUP if is_profile else self.FRONTAL_WARMUP
        warmup = (base_warmup + 3) if is_small_eye else base_warmup
        if track["mode_frames"] <= warmup:
            if vis >= (0.40 if is_small_eye else 0.50):
                track["baseline_win"].append(max(smoothed, ear))
            track["last_status"] = "Warmup-SE" if is_small_eye else "Warmup"
            return

        # ── Baseline ─────────────────────────────────────────────────────────
        if len(track["baseline_win"]) >= self.MIN_BL_SAMP:
            bl = float(np.percentile(list(track["baseline_win"]), self.BASELINE_PCT))
        else:
            bl = float(max(smoothed, ear,
                           np.percentile(list(track["smooth_win"]), 75)))

        close_thr, open_thr = self._thresholds(bl, is_small_eye=is_small_eye)
        drop       = bl - trigger_ear        # uses min(smoothed, raw) for small eyes
        raw_drop   = bl - ear
        reopen_thr = close_thr + self.REOPEN_RATIO * (open_thr - close_thr)

        # Update baseline only from clear open-eye, high-quality frames
        vis_bl_gate = 0.40 if is_small_eye else 0.55
        if smoothed >= open_thr and vis >= vis_bl_gate:
            track["baseline_win"].append(smoothed)
            bl = float(np.percentile(list(track["baseline_win"]), self.BASELINE_PCT))
            close_thr, open_thr = self._thresholds(bl, is_small_eye=is_small_eye)
            drop       = bl - trigger_ear
            raw_drop   = bl - ear
            reopen_thr = close_thr + self.REOPEN_RATIO * (open_thr - close_thr)

        # ── Effective thresholds with yaw, motion & small-eye adjustments ─────
        yaw_pen = 0.0
        if self.YAW_SOFT_DEG < yaw_deg < self.YAW_GATE_DEG:
            yaw_pen = ((yaw_deg - self.YAW_SOFT_DEG)
                       / (self.YAW_GATE_DEG - self.YAW_SOFT_DEG)) * 0.025
        mot_pen  = max(0.0, motion - 0.08) * self.MOTION_DROP_BONUS

        # Adaptive min drop — key fix for small eyes
        eff_drop  = self._adaptive_min_drop(bl, is_small_eye) + yaw_pen + mot_pen
        eff_close = max(0.07 if is_small_eye else 0.10,
                        close_thr - 0.3 * mot_pen)

        # ── Hard gates ────────────────────────────────────────────────────────
        if yaw_deg >= self.YAW_GATE_DEG:
            track["blink_state"] = self._new_blink_state()
            track["last_status"] = "Rotated"
            return

        vis_gate = self.SMALL_EYE_VIS_GATE if is_small_eye else self.VISIBILITY_GATE
        if vis < vis_gate:
            track["blink_state"] = self._new_blink_state()
            track["last_status"] = "Low-vis"
            return

        # ── State machine ─────────────────────────────────────────────────────
        bs       = track["blink_state"]
        is_open  = smoothed >= open_thr or ear >= open_thr
        is_close = (
            track["cooldown"] == 0
            and drop    >= eff_drop
            and trigger_ear <= eff_close
        )

        if not bs["active"]:
            if is_close:
                if bs["cand_frames"] == 0:
                    bs["min_ear"]   = trigger_ear
                    bs["peak_drop"] = drop
                    bs["entry_ear"] = track.get("last_raw_ear", ear)
                else:
                    bs["min_ear"]   = min(bs["min_ear"], trigger_ear)
                    bs["peak_drop"] = max(bs["peak_drop"], drop)
                bs["cand_frames"] += 1

                # Motion spike invalidates candidate
                if motion > self.MAX_BLINK_MOTION:
                    track["blink_state"] = self._new_blink_state()
                    track["last_status"] = "MotionDrop"
                    return

                if bs["cand_frames"] >= mcf:
                    bs["active"]        = True
                    bs["closed_frames"] = bs["cand_frames"]

            elif bs["cand_frames"] > 0:
                # Single-frame rapid blink check
                # For small eyes the edge delta is proportionally smaller
                edge_delta   = 0.012 if is_small_eye else 0.018
                reopen_delta = 0.008 if is_small_eye else 0.012
                rapid_ok = (
                    bs["cand_frames"] == 1
                    and raw_drop >= (eff_drop + (0.006 if is_small_eye else 0.010))
                    and ear       <= (eff_close - (0.002 if is_small_eye else 0.004))
                    and bs["entry_ear"] >= open_thr
                    and (bs["entry_ear"] - bs["min_ear"]) >= edge_delta
                    and (max(ear, smoothed) - bs["min_ear"]) >= reopen_delta
                    and motion < self.MAX_BLINK_MOTION
                )
                if is_open and rapid_ok:
                    dur = bs["cand_frames"] * skip / fps
                    if (skip / fps) <= dur <= self.MAX_BLINK_SEC:
                        track["blink_count"] += 1
                track["blink_state"] = self._new_blink_state()
                track["cooldown"]    = cdf

        else:
            bs["closed_frames"] += 1
            bs["min_ear"]        = min(bs["min_ear"], trigger_ear)
            bs["peak_drop"]      = max(bs["peak_drop"], drop)

            # Motion spike during confirmed blink → cancel
            if motion > self.MAX_BLINK_MOTION * 1.4:
                track["blink_state"] = self._new_blink_state()
                track["cooldown"]    = cdf
                track["last_status"] = "MotionCancel"
                return

            if bs["closed_frames"] > mxcf:
                track["blink_state"] = self._new_blink_state()
                track["cooldown"]    = cdf
            elif smoothed >= reopen_thr:
                dur     = bs["closed_frames"] * skip / fps
                min_dur = self.MIN_BLINK_SEC
                if (min_dur <= dur <= self.MAX_BLINK_SEC
                        and bs["peak_drop"] >= eff_drop):
                    track["blink_count"] += 1
                track["blink_state"] = self._new_blink_state()
                track["cooldown"]    = cdf

        # ── Status label ─────────────────────────────────────────────────────
        bs = track["blink_state"]
        se_tag = "(SE)" if is_small_eye else ""
        if bs["active"]:
            track["last_status"] = f"Closed{se_tag}"
        elif bs["cand_frames"] > 0:
            track["last_status"] = f"Closing{se_tag}"
        else:
            track["last_status"] = f"Open{se_tag}"

    # =========================================================================
    # Track summary
    # =========================================================================

    def _summarise(self, track: Dict, duration: float, fps: float, skip: int) -> Dict[str, Any]:
        rt = track["blink_count"]

        # Use adaptive min_drop for the offline pass too
        bl_est = (float(np.percentile(list(track["baseline_win"]), self.BASELINE_PCT))
                  if len(track["baseline_win"]) >= self.MIN_BL_SAMP
                  else (float(np.mean(track["ear_values"])) if track["ear_values"] else 0.25))
        is_se  = track.get("is_small_eye", False)
        adap_drop = self._adaptive_min_drop(bl_est, is_small_eye=is_se)

        pp = offline_blink_detection(
            track["ear_series"], fps=fps, frame_skip=skip,
            min_blink_sec=self.MIN_BLINK_SEC, max_blink_sec=self.MAX_BLINK_SEC,
            cooldown_sec=self.COOLDOWN_SEC,   min_drop_abs=adap_drop,
        )
        final, method = reconcile_counts(rt, pp)
        rate = (final / max(duration, 1.0)) * 60.0

        df = compute_deepfake_features(
            duration_sec  = duration,
            timestamps    = pp["timestamps"],
        )
        n = track["n_frames"]
        return {
            "track_id":            track["id"],
            "total_blinks":        final,
            "blink_count_rt":      rt,
            "blink_count_pp":      pp["blink_count"],
            "count_method":        method,
            "blink_rate":          round(rate, 2),
            "avg_ear":             round(float(np.mean(track["ear_values"])), 4) if track["ear_values"] else 0.0,
            "ear_variance":        round(float(np.var(track["ear_values"])), 6) if track["ear_values"] else 0.0,
            "frames_processed":    n,
            "is_small_eye":        is_se,
            "baseline_ear":        round(bl_est, 4),
            "blink_intervals_sec": pp["intervals_sec"],
            "blink_durations_sec": pp["durations_sec"],
            "deepfake_features":   df,
            "avg_area_ratio":      round(track["area_sum"] / max(n, 1), 4),
            "avg_center_prox":     round(track["prox_sum"] / max(n, 1), 4),
            "primary_score":       float(n
                                         * (0.40 + track["area_sum"] / max(n, 1))
                                         * (0.55 + 0.45 * track["prox_sum"] / max(n, 1))),
        }

    # =========================================================================
    # Overlay renderer
    # =========================================================================

    def _render(self, frame: np.ndarray, tracks: List[Dict], fh: int) -> None:
        cv2.putText(frame, f"Faces: {len(tracks)}", (20, 35),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
        for t in tracks:
            x1, y1, x2, y2 = t.get("smooth_bbox", t["bbox"])
            col = (0, 200, 0) if t["last_status"] == "Open" else (0, 80, 255)
            cv2.rectangle(frame, (x1, y1), (x2, y2), col, 2)
            cv2.putText(frame,
                        f"ID{t['id']} B:{t['blink_count']} {t['last_status']}"
                        f"  Yaw:{t['last_yaw']:.0f}  Vis:{t['last_vis']:.2f}",
                        (x1, max(18, y1-10)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.48, (255, 255, 0), 2)
            cv2.putText(frame,
                        f"EAR:{t['last_ear']:.3f}  Bal:{t['last_balance']:.2f}"
                        f"  W:{t['last_ew']:.2f}  Mot:{t['last_motion']:.2f}",
                        (x1, min(fh-4, y2+18)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 220, 255), 1)

    # =========================================================================
    # Single-face processing pass
    # =========================================================================

    def _single_pass(
        self, cap, fps: float, fc: int, fw: int, fh: int,
        dur: float, skip: int, display: bool
    ) -> Optional[Dict[str, Any]]:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        mcf  = max(1, int(np.ceil(self.MIN_BLINK_SEC  * fps / skip)))
        mxcf = max(mcf + 1, int(np.ceil(self.MAX_BLINK_SEC * fps / skip)))
        cdf  = max(1, int(np.ceil(self.COOLDOWN_SEC   * fps / skip)))
        lfrf = max(1, int(np.ceil(self.LOST_RESET_SEC * fps / skip)))
        mtf  = max(12, int(np.ceil(0.06 * fc / skip)))

        track: Optional[Dict] = None
        pfi = fi = 0

        while True:
            ok, frame = cap.read()
            if not ok:
                break
            fi  += 1
            if fi % skip != 0:
                continue
            pfi += 1
            t_sec = fi / fps

            # CV tracker
            if track is not None:
                tb = self._update_tracker(track.get("tracker"), frame, fw, fh)
                if tb:
                    self._set_bbox(track, tb, backend="tracker", reinit=False)

            cur_bb = track.get("smooth_bbox", track["bbox"]) if track else None

            # YOLO detection
            do_det = (
                self._yolo is not None
                and (pfi == 1
                     or pfi % self.SF_YOLO_INTERVAL == 0
                     or track is None
                     or track["missing"] >= 2)
            )
            if do_det:
                dets = self._detect(frame)
                pd   = self._select_primary(dets, fw, fh, previous_bbox=cur_bb)
                if pd:
                    if track is None:
                        track = self._new_track(1, pd["bbox"], frame)
                    else:
                        self._set_bbox(track, pd["bbox"], frame=frame, backend="yolo")
                    track["missing"] = 0
                    cur_bb = track.get("smooth_bbox", track["bbox"])

            # EAR extraction — cropped patch first
            analysis = None
            if track and cur_bb:
                is_p = track.get("is_profile", False)
                crop = self._expand_bbox(cur_bb, fw, fh, self._face_pad(cur_bb, fw, fh, is_p))
                if crop:
                    x1, y1, x2, y2 = crop
                    analysis = self._extract_ears(frame[y1:y2, x1:x2])
                    if analysis:
                        rb = self._local_to_global(analysis.get("face_bbox"), crop, fw, fh)
                        if rb:
                            self._set_bbox(track, rb, frame=frame, backend="mesh-crop")
                            cur_bb = track.get("smooth_bbox", track["bbox"])

            # Fallback: full-frame FaceMesh
            if analysis is None:
                tc = None
                if cur_bb:
                    tc = ((cur_bb[0]+cur_bb[2])/2/max(fw,1),
                          (cur_bb[1]+cur_bb[3])/2/max(fh,1))
                analysis = self._extract_ears(frame, target_center=tc)
                if analysis and analysis.get("face_bbox"):
                    rb = self._clip_bbox(analysis["face_bbox"], fw, fh)
                    if rb:
                        if track is None:
                            track = self._new_track(1, rb, frame)
                        else:
                            self._set_bbox(track, rb, frame=frame, backend="mesh-full")
                        track["missing"] = 0
                        cur_bb = track.get("smooth_bbox", track["bbox"])

            if analysis is None or track is None:
                if track:
                    track["missing"] += 1
                    track["tracker"]  = None
                    if track["missing"] >= lfrf:
                        track["blink_state"] = self._new_blink_state()
                        track["last_status"] = "Lost"
                if display:
                    self._render(frame, [track] if track else [], fh)
                    cv2.imshow("Blink Detection", frame)
                    if cv2.waitKey(1) == 27:
                        break
                continue

            track["missing"] = 0
            cb = track.get("smooth_bbox", track["bbox"])
            track["area_sum"] += self._area(cb) / max(1.0, fw * fh)
            track["prox_sum"] += self._center_prox(cb, fw, fh)

            self._update_blink(
                track, analysis, fps, skip, mcf, mxcf, cdf,
                min_drop=self.MIN_DROP_SINGLE,
                frame_idx=fi, time_sec=t_sec,
            )

            if display:
                self._render(frame, [track], fh)
                cv2.imshow("Blink Detection", frame)
                if cv2.waitKey(1) == 27:
                    break

        if track is None or track["n_frames"] < mtf:
            return None
        s = self._summarise(track, dur, fps, skip)
        return {**s, "faces_detected": 1, "primary_track_id": s["track_id"],
                "face_summaries": [s]}

    # =========================================================================
    # Multi-face processing pass
    # =========================================================================

    def _multi_pass(
        self, cap, fps: float, fc: int, fw: int, fh: int,
        dur: float, skip: int, display: bool
    ) -> Optional[Dict[str, Any]]:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        mcf  = max(1, int(np.ceil(self.MIN_BLINK_SEC  * fps / skip)))
        mxcf = max(mcf + 1, int(np.ceil(self.MAX_BLINK_SEC * fps / skip)))
        cdf  = max(1, int(np.ceil(self.COOLDOWN_SEC   * fps / skip)))
        lfrf = max(1, int(np.ceil(self.LOST_RESET_SEC * fps / skip)))
        mtf  = max(8,  int(np.ceil(0.05  * fc / skip)))
        smtf = max(8,  int(np.ceil(0.015 * fc / skip)))

        active: Dict[int, Dict]    = {}
        all_tracks: Dict[int, Dict] = {}
        nxt = 1
        pfi = fi = 0

        while True:
            ok, frame = cap.read()
            if not ok:
                break
            fi  += 1
            if fi % skip != 0:
                continue
            pfi += 1
            t_sec = fi / fps

            do_det = (
                self._yolo is not None
                and (pfi == 1 or pfi % self.YOLO_INTERVAL == 0 or not active)
            )
            if do_det:
                dets = self._detect(frame)
                nxt  = self._update_tracks(active, all_tracks, dets, nxt, frame)
                self._merge_overlapping(active)

            for tid in list(active.keys()):
                t = active.get(tid)
                if t is None:
                    continue

                if t["last_backend"] != "yolo":
                    tb = self._update_tracker(t.get("tracker"), frame, fw, fh)
                    if tb:
                        self._set_bbox(t, tb, backend="tracker", reinit=False)

                sb   = t.get("smooth_bbox", t["bbox"])
                crop = self._expand_bbox(sb, fw, fh,
                                         self._face_pad(sb, fw, fh, t.get("is_profile", False)))
                if crop is None:
                    t["missing"] += 1
                    if t["missing"] > self.TRACK_MAX_MISS:
                        active.pop(tid, None)
                    continue

                x1, y1, x2, y2 = crop
                analysis = self._extract_ears(frame[y1:y2, x1:x2])
                if analysis is None:
                    t["missing"] += 1
                    if t["missing"] >= lfrf:
                        t["blink_state"] = self._new_blink_state()
                    if t["missing"] > self.TRACK_MAX_MISS:
                        active.pop(tid, None)
                    continue

                t["missing"] = 0
                rb = self._local_to_global(analysis.get("face_bbox"), crop, fw, fh)
                if rb and (self._iou(rb, sb) >= 0.08 or self._center_dist(rb, sb) <= 0.55):
                    self._set_bbox(t, rb, frame=frame)

                cb = t.get("smooth_bbox", t["bbox"])
                t["area_sum"] += self._area(cb) / max(1.0, fw * fh)
                t["prox_sum"] += self._center_prox(cb, fw, fh)

                self._update_blink(
                    t, analysis, fps, skip, mcf, mxcf, cdf,
                    min_drop=self.MIN_DROP_MULTI,
                    frame_idx=fi, time_sec=t_sec,
                )

            if display:
                vt = [t for t in active.values() if t["n_frames"] >= 2]
                self._render(frame, vt, fh)
                cv2.imshow("Blink Detection", frame)
                if cv2.waitKey(1) == 27:
                    break

        summaries = [
            self._summarise(t, dur, fps, skip)
            for t in all_tracks.values()
            if t["n_frames"] >= smtf and not t.get("suppressed", False)
        ]
        summaries.sort(
            key=lambda s: (s["primary_score"], s["frames_processed"],
                           s["avg_area_ratio"], s["avg_center_prox"]),
            reverse=True,
        )
        if not summaries:
            return None
        pf = summaries[0]
        if pf["frames_processed"] < mtf:
            return None
        return {**pf, "faces_detected": len(summaries),
                "primary_track_id": pf["track_id"], "face_summaries": summaries}

    # =========================================================================
    # Public API
    # =========================================================================

    @staticmethod
    def _default_result(vp: Path) -> Dict[str, Any]:
        return {
            "video_path":          vp.name,
            "total_blinks":        -1,
            "blink_rate":          -1.0,
            "blink_count_rt":      -1,
            "blink_count_pp":      -1,
            "count_method":        "none",
            "avg_ear":             -1.0,
            "ear_variance":        -1.0,
            "frames_processed":    0,
            "faces_detected":      0,
            "duration":            0.0,
            "primary_track_id":    -1,
            "blink_intervals_sec": [],
            "blink_durations_sec": [],
            "deepfake_features":   {},
            "face_summaries":      [],
        }

    def process_video(
        self,
        video_path: Union[str, Path],
        display:    bool = False,
    ) -> Dict[str, Any]:
        """
        Process a video file and return a comprehensive blink analysis dict.

        Key output fields
        ──────────────────
        total_blinks        best estimate (two-pass reconciled)
        blink_count_rt      real-time state-machine count (diagnostic)
        blink_count_pp      offline valley-detection count (diagnostic)
        blink_durations_sec per-blink duration list
        blink_intervals_sec inter-blink interval list
        deepfake_features   dict with interval_cv and longest_gap_sec
        face_summaries      per-track breakdown (multi-person videos)
        """
        vp     = Path(video_path)
        result = self._default_result(vp)
        cap    = None
        try:
            cap = cv2.VideoCapture(str(vp))
            fps = cap.get(cv2.CAP_PROP_FPS)
            fc  = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            fw  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            fh  = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            if fps <= 0 or fps > 120:
                fps = 30.0
            if fc <= 0 or fw <= 0 or fh <= 0:
                return result

            result["duration"] = fc / fps
            skip_opts = [self.frame_skip] + ([1] if self.frame_skip != 1 else [])
            final     = None

            for skip in skip_opts:
                mode = self._probe_mode(cap, skip)
                if mode == "single":
                    final = self._single_pass(cap, fps, fc, fw, fh,
                                              result["duration"], skip, display)
                else:
                    final = self._multi_pass(cap, fps, fc, fw, fh,
                                             result["duration"], skip, display)
                if final is not None:
                    break

            if final:
                result.update(final)

        except Exception as exc:
            print(f"  Error processing {vp.name}: {exc}")
            import traceback; traceback.print_exc()
        finally:
            if cap:
                cap.release()
            if display:
                cv2.destroyAllWindows()

        return result

    def process(
        self,
        video_path: Optional[Union[str, Path]] = None,
        display:    bool = True,
    ) -> Dict[str, Any]:
        """Interactive entry-point with a printed summary."""
        target = Path(video_path) if video_path else self.video_path
        if target is None:
            raise ValueError("Provide a video_path.")

        r  = self.process_video(target, display=display)
        df = r.get("deepfake_features", {})

        print("\n" + "═" * 56)
        print(f"  VIDEO    : {target.name}")
        print(f"  Duration : {r['duration']:.1f}s  |  Frames proc: {r['frames_processed']}")
        print(f"  Faces    : {r.get('faces_detected',0)}  Primary ID: {r.get('primary_track_id',-1)}")
        print("─" * 56)
        print(f"  BLINKS   : {r['total_blinks']:>5}  "
              f"[RT={r['blink_count_rt']}  PP={r['blink_count_pp']}  {r['count_method']}]")
        print(f"  Rate     : {r['blink_rate']:.2f} / min")
        print(f"  Avg EAR  : {r['avg_ear']:.4f}   EAR var: {r['ear_variance']:.6f}")
        # Show small-eye info from primary face
        pf = (r.get("face_summaries") or [{}])[0]
        se_tag = "  [small-eye mode]" if pf.get("is_small_eye") else ""
        print(f"  Baseline : {pf.get('baseline_ear', 0.0):.4f}{se_tag}")
        if df:
            print("-" * 56)
            print("  Deepfake Analysis")
            print(f"  Interval CV       : {df.get('interval_cv', 0):.3f}")
            print(f"  Longest gap       : {df.get('longest_gap_sec', 0):.1f}s")

        ivs = r.get("blink_intervals_sec", [])
        if ivs:
            a = np.array(ivs)
            print(f"  Intervals: mean={a.mean():.2f}s  "
                  f"min={a.min():.2f}s  max={a.max():.2f}s  cv={a.std()/max(a.mean(),1e-6):.2f}")

        fs = r.get("face_summaries", [])
        if len(fs) > 1:
            print("─" * 56)
            print("  Per-face breakdown:")
            for s in fs:
                print(f"    Face {s['track_id']}: blinks={s['total_blinks']} "
                      f"[RT={s['blink_count_rt']} PP={s['blink_count_pp']}]  "
                      f"rate={s['blink_rate']:.2f}/min  frames={s['frames_processed']}")
        print("═" * 56)
        return r


# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    VIDEO = Path(
        r"D:\New_folder\deepfake_detection\deepfake_project\data\real\01__outside_talking_pan_laughing.mp4"
    )
    detector = BlinkDetector(VIDEO, frame_skip=1, tracking_mode="auto")
    detector.process(display=True)

