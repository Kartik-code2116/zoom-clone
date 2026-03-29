"""
Shared tracked-face utilities for multi-person video analysis.

The tracker combines periodic YOLO face detection with lightweight OpenCV
single-object trackers between detections. Each feature extractor keeps its own
per-track analysis state on top of these common helpers.
"""

from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np

try:
    import torch
except ImportError:
    torch = None

try:
    from ultralytics import YOLO
except ImportError:
    YOLO = None


class MultiFaceTracker:
    """YOLO-backed face detection and short-term identity tracking."""

    YOLO_CONFIDENCE = 0.30
    FACE_PADDING = 0.22
    YOLO_DETECTION_INTERVAL = 3
    TRACK_IOU_THRESHOLD = 0.18
    TRACK_CENTER_DISTANCE_THRESHOLD = 0.75
    TRACK_SIZE_RATIO_THRESHOLD = 0.42
    TRACK_REASSOCIATE_MAX_GAP = 18
    TRACK_REASSOCIATE_MIN_SCORE = 0.45
    DUPLICATE_IOU_THRESHOLD = 0.45
    DUPLICATE_CENTER_THRESHOLD = 0.22
    DUPLICATE_SIZE_RATIO_THRESHOLD = 0.58
    TRACK_MAX_MISSES = 12
    LANDMARK_BOX_PADDING = 0.10
    BBOX_SMOOTHING_ALPHA = 0.90

    def __init__(self, model_filename: str = "yolov8n-face-lindevs.pt"):
        self.device = "cuda" if torch is not None and torch.cuda.is_available() else "cpu"
        self.yolo = None

        model_path = Path(__file__).with_name(model_filename)
        if YOLO is not None and model_path.exists():
            self.yolo = YOLO(str(model_path))
            try:
                self.yolo.to(self.device)
            except Exception:
                pass

    @staticmethod
    def _expand_bbox(
        bbox: Tuple[int, int, int, int],
        frame_w: int,
        frame_h: int,
        padding_ratio: float
    ) -> Optional[Tuple[int, int, int, int]]:
        x1, y1, x2, y2 = bbox
        box_w = x2 - x1
        box_h = y2 - y1

        if box_w <= 0 or box_h <= 0:
            return None

        pad_x = int(box_w * padding_ratio)
        pad_y = int(box_h * padding_ratio)

        x1 = max(0, x1 - pad_x)
        y1 = max(0, y1 - pad_y)
        x2 = min(frame_w, x2 + pad_x)
        y2 = min(frame_h, y2 + pad_y)

        if x2 <= x1 or y2 <= y1:
            return None

        return x1, y1, x2, y2

    @staticmethod
    def _clip_bbox(
        bbox: Tuple[int, int, int, int],
        frame_w: int,
        frame_h: int
    ) -> Optional[Tuple[int, int, int, int]]:
        x1, y1, x2, y2 = bbox
        x1 = max(0, min(frame_w - 1, int(round(x1))))
        y1 = max(0, min(frame_h - 1, int(round(y1))))
        x2 = max(0, min(frame_w, int(round(x2))))
        y2 = max(0, min(frame_h, int(round(y2))))

        if x2 <= x1 or y2 <= y1:
            return None

        return x1, y1, x2, y2

    def _smooth_bbox(
        self,
        previous_bbox: Optional[Tuple[int, int, int, int]],
        new_bbox: Tuple[int, int, int, int]
    ) -> Tuple[int, int, int, int]:
        if previous_bbox is None:
            return new_bbox

        alpha = self.BBOX_SMOOTHING_ALPHA
        smoothed = []
        for previous_value, new_value in zip(previous_bbox, new_bbox):
            value = alpha * previous_value + (1.0 - alpha) * new_value
            smoothed.append(int(round(value)))
        return tuple(smoothed)

    @staticmethod
    def _create_cv_tracker():
        tracker_factories = [
            getattr(cv2, "TrackerKCF_create", None),
            getattr(cv2, "TrackerCSRT_create", None)
        ]

        legacy = getattr(cv2, "legacy", None)
        if legacy is not None:
            tracker_factories.extend([
                getattr(legacy, "TrackerKCF_create", None),
                getattr(legacy, "TrackerCSRT_create", None)
            ])

        for factory in tracker_factories:
            if factory is not None:
                return factory()

        return None

    def _init_tracker(
        self,
        frame: np.ndarray,
        bbox: Tuple[int, int, int, int]
    ):
        tracker = self._create_cv_tracker()
        if tracker is None:
            return None

        x1, y1, x2, y2 = bbox
        init_box = (int(x1), int(y1), int(x2 - x1), int(y2 - y1))

        try:
            tracker.init(frame, init_box)
            return tracker
        except Exception:
            return None

    def _update_tracker_bbox(
        self,
        tracker,
        frame: np.ndarray,
        frame_w: int,
        frame_h: int
    ) -> Optional[Tuple[int, int, int, int]]:
        if tracker is None:
            return None

        try:
            success, tracked = tracker.update(frame)
        except Exception:
            return None

        if not success:
            return None

        x, y, w, h = tracked
        bbox = (
            int(round(x)),
            int(round(y)),
            int(round(x + w)),
            int(round(y + h))
        )
        return self._clip_bbox(bbox, frame_w, frame_h)

    @staticmethod
    def _bbox_iou(
        bbox_a: Tuple[int, int, int, int],
        bbox_b: Tuple[int, int, int, int]
    ) -> float:
        ax1, ay1, ax2, ay2 = bbox_a
        bx1, by1, bx2, by2 = bbox_b

        ix1 = max(ax1, bx1)
        iy1 = max(ay1, by1)
        ix2 = min(ax2, bx2)
        iy2 = min(ay2, by2)

        inter_w = max(0, ix2 - ix1)
        inter_h = max(0, iy2 - iy1)
        intersection = inter_w * inter_h
        if intersection == 0:
            return 0.0

        area_a = max(0, ax2 - ax1) * max(0, ay2 - ay1)
        area_b = max(0, bx2 - bx1) * max(0, by2 - by1)
        union = area_a + area_b - intersection

        if union <= 0:
            return 0.0

        return float(intersection / union)

    @staticmethod
    def _bbox_area(bbox: Tuple[int, int, int, int]) -> float:
        return float(max(0, bbox[2] - bbox[0]) * max(0, bbox[3] - bbox[1]))

    def _bbox_size_ratio(
        self,
        bbox_a: Tuple[int, int, int, int],
        bbox_b: Tuple[int, int, int, int]
    ) -> float:
        area_a = self._bbox_area(bbox_a)
        area_b = self._bbox_area(bbox_b)
        if area_a <= 1e-6 or area_b <= 1e-6:
            return 0.0
        return float(min(area_a, area_b) / max(area_a, area_b))

    @staticmethod
    def _bbox_center_distance_norm(
        bbox_a: Tuple[int, int, int, int],
        bbox_b: Tuple[int, int, int, int]
    ) -> float:
        ax1, ay1, ax2, ay2 = bbox_a
        bx1, by1, bx2, by2 = bbox_b

        center_ax = (ax1 + ax2) / 2.0
        center_ay = (ay1 + ay2) / 2.0
        center_bx = (bx1 + bx2) / 2.0
        center_by = (by1 + by2) / 2.0

        distance = np.hypot(center_ax - center_bx, center_ay - center_by)
        scale = max(
            1.0,
            (ax2 - ax1 + bx2 - bx1) / 2.0,
            (ay2 - ay1 + by2 - by1) / 2.0
        )
        return float(distance / scale)

    @staticmethod
    def _center_proximity(
        bbox: Tuple[int, int, int, int],
        frame_w: int,
        frame_h: int
    ) -> float:
        x1, y1, x2, y2 = bbox
        center_x = (x1 + x2) / 2.0
        center_y = (y1 + y2) / 2.0
        frame_center_x = frame_w / 2.0
        frame_center_y = frame_h / 2.0
        distance = np.hypot(center_x - frame_center_x, center_y - frame_center_y)
        max_distance = max(1.0, np.hypot(frame_center_x, frame_center_y))
        return float(max(0.0, 1.0 - (distance / max_distance)))

    def _touch_track(self, track: Dict[str, Any], frame_index: Optional[int] = None) -> None:
        if frame_index is None:
            return
        if track.get("first_seen_frame", -1) < 0:
            track["first_seen_frame"] = frame_index
        track["last_seen_frame"] = frame_index

    def _assign_track_bbox(
        self,
        track: Dict[str, Any],
        new_bbox: Tuple[int, int, int, int],
        frame: Optional[np.ndarray] = None,
        backend: Optional[str] = None,
        reinit_tracker: bool = True,
        frame_index: Optional[int] = None
    ) -> None:
        previous_bbox = track.get("smoothed_bbox")
        motion = (
            self._bbox_center_distance_norm(previous_bbox, new_bbox)
            if previous_bbox is not None else 0.0
        )
        track["bbox"] = new_bbox
        track["smoothed_bbox"] = self._smooth_bbox(previous_bbox, new_bbox)
        track["last_motion"] = float(motion)

        if frame is not None and reinit_tracker:
            track["tracker"] = self._init_tracker(frame, new_bbox)
        if backend is not None:
            track["last_backend"] = backend
        self._touch_track(track, frame_index)

    def _compute_track_match_score(
        self,
        track: Dict[str, Any],
        detection_bbox: Tuple[int, int, int, int]
    ) -> Optional[float]:
        track_bbox = track.get("smoothed_bbox", track["bbox"])
        iou = self._bbox_iou(detection_bbox, track_bbox)
        center_distance = self._bbox_center_distance_norm(detection_bbox, track_bbox)
        size_ratio = self._bbox_size_ratio(detection_bbox, track_bbox)
        track_motion = float(track.get("last_motion", 0.0))
        stability = float(np.clip(track.get("match_count", 0) / 10.0, 0.0, 1.0))
        dynamic_center_threshold = min(
            0.95,
            self.TRACK_CENTER_DISTANCE_THRESHOLD + (0.18 * min(track_motion, 1.0)) - (0.08 * stability)
        )

        if size_ratio < self.TRACK_SIZE_RATIO_THRESHOLD and iou < 0.20:
            return None
        if iou < max(0.08, 0.5 * self.TRACK_IOU_THRESHOLD) and center_distance > dynamic_center_threshold:
            return None

        center_match = max(0.0, 1.0 - min(center_distance / max(dynamic_center_threshold, 1e-6), 1.0))
        return float((1.35 * iou) + (0.85 * center_match) + (0.30 * size_ratio) + (0.12 * stability))

    def _find_reusable_track_id(
        self,
        active_tracks: Dict[int, Dict[str, Any]],
        all_tracks: Dict[int, Dict[str, Any]],
        detection_bbox: Tuple[int, int, int, int],
        frame_index: Optional[int]
    ) -> Optional[int]:
        if frame_index is None:
            return None

        best_track_id = None
        best_score = self.TRACK_REASSOCIATE_MIN_SCORE

        for track_id, track in all_tracks.items():
            if track_id in active_tracks or track.get("suppressed", False):
                continue

            last_seen_frame = int(track.get("last_seen_frame", -1))
            if last_seen_frame < 0:
                continue

            gap = frame_index - last_seen_frame
            if gap <= 0 or gap > self.TRACK_REASSOCIATE_MAX_GAP:
                continue

            match_score = self._compute_track_match_score(track, detection_bbox)
            if match_score is None:
                continue

            recency_bonus = max(0.0, 1.0 - (gap / max(1, self.TRACK_REASSOCIATE_MAX_GAP)))
            score = match_score + (0.22 * recency_bonus)
            if score > best_score:
                best_score = score
                best_track_id = track_id

        return best_track_id

    def _detect_faces(self, frame: np.ndarray) -> List[Dict[str, Any]]:
        if self.yolo is None:
            return []

        try:
            results = self.yolo(frame, conf=self.YOLO_CONFIDENCE, verbose=False)
        except Exception:
            return []

        if not results or results[0].boxes is None or len(results[0].boxes) == 0:
            return []

        boxes = results[0].boxes.xyxy.cpu().numpy()
        confidences = results[0].boxes.conf.cpu().numpy()

        detections = []
        for box, confidence in zip(boxes, confidences):
            bbox = tuple(map(int, box[:4]))
            if bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
                continue

            x1, y1, x2, y2 = bbox
            area = max(0, x2 - x1) * max(0, y2 - y1)
            detections.append({
                "bbox": bbox,
                "confidence": float(confidence),
                "score": area * float(confidence)
            })

        detections.sort(key=lambda item: item["score"], reverse=True)
        return detections

    def _build_track(
        self,
        track_id: int,
        bbox: Tuple[int, int, int, int],
        frame: np.ndarray,
        extra_state: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        track = {
            "track_id": track_id,
            "bbox": bbox,
            "smoothed_bbox": bbox,
            "tracker": self._init_tracker(frame, bbox),
            "missing_frames": 0,
            "frames_processed": 0,
            "suppressed": False,
            "last_backend": "yolo",
            "last_motion": 0.0,
            "match_count": 0,
            "first_seen_frame": -1,
            "last_seen_frame": -1,
            "observed_face_frames": 0,
            "frontal_face_frames": 0,
            "usable_face_frames": 0,
            "bbox_area_ratio_sum": 0.0,
            "center_proximity_sum": 0.0,
        }
        if extra_state:
            track.update(extra_state)
        return track

    @staticmethod
    def _track_frontality_ratio(track: Dict[str, Any]) -> float:
        observed_frames = int(track.get("observed_face_frames", 0))
        if observed_frames <= 0:
            return 0.0
        return float(track.get("frontal_face_frames", 0) / observed_frames)

    def _track_is_frontal_majority(
        self,
        track: Dict[str, Any],
        min_ratio: float,
        min_frontal_frames: int
    ) -> bool:
        return bool(
            int(track.get("frontal_face_frames", 0)) >= min_frontal_frames
            and self._track_frontality_ratio(track) >= min_ratio
        )

    def _match_detections_to_tracks(
        self,
        active_tracks: Dict[int, Dict[str, Any]],
        detections: List[Dict[str, Any]]
    ) -> Tuple[Dict[int, int], List[int]]:
        track_ids = list(active_tracks.keys())
        if not track_ids or not detections:
            return {}, list(range(len(detections)))

        candidates: List[Tuple[float, int, int]] = []
        for detection_idx, detection in enumerate(detections):
            for track_id in track_ids:
                score = self._compute_track_match_score(active_tracks[track_id], detection["bbox"])
                if score is not None:
                    candidates.append((score, detection_idx, track_id))

        candidates.sort(reverse=True, key=lambda item: item[0])

        matches: Dict[int, int] = {}
        used_detections = set()
        used_tracks = set()

        for _, detection_idx, track_id in candidates:
            if detection_idx in used_detections or track_id in used_tracks:
                continue
            matches[detection_idx] = track_id
            used_detections.add(detection_idx)
            used_tracks.add(track_id)

        unmatched_detection_indices = [
            detection_idx for detection_idx in range(len(detections))
            if detection_idx not in used_detections
        ]
        return matches, unmatched_detection_indices

    def _update_tracks_from_detections(
        self,
        active_tracks: Dict[int, Dict[str, Any]],
        all_tracks: Dict[int, Dict[str, Any]],
        detections: List[Dict[str, Any]],
        next_track_id: int,
        frame: np.ndarray,
        track_factory: Callable[[int, Tuple[int, int, int, int], np.ndarray], Dict[str, Any]],
        frame_index: Optional[int] = None
    ) -> int:
        matches, unmatched_detection_indices = self._match_detections_to_tracks(active_tracks, detections)

        for track in active_tracks.values():
            track["last_backend"] = "track"

        for detection_idx, track_id in matches.items():
            detection_bbox = detections[detection_idx]["bbox"]
            self._assign_track_bbox(
                active_tracks[track_id],
                detection_bbox,
                frame=frame,
                backend="yolo",
                frame_index=frame_index,
            )
            active_tracks[track_id]["missing_frames"] = 0
            active_tracks[track_id]["match_count"] = int(active_tracks[track_id].get("match_count", 0)) + 1

        for detection_idx in unmatched_detection_indices:
            detection_bbox = detections[detection_idx]["bbox"]
            reusable_track_id = self._find_reusable_track_id(
                active_tracks,
                all_tracks,
                detection_bbox,
                frame_index,
            )
            if reusable_track_id is not None:
                track = all_tracks[reusable_track_id]
                track["suppressed"] = False
                active_tracks[reusable_track_id] = track
                self._assign_track_bbox(
                    track,
                    detection_bbox,
                    frame=frame,
                    backend="yolo",
                    frame_index=frame_index,
                )
                track["missing_frames"] = 0
                track["match_count"] = int(track.get("match_count", 0)) + 1
                continue

            track = track_factory(next_track_id, detection_bbox, frame)
            self._touch_track(track, frame_index)
            track["match_count"] = 1
            active_tracks[next_track_id] = track
            all_tracks[next_track_id] = track
            next_track_id += 1

        return next_track_id

    def _prune_overlapping_tracks(self, active_tracks: Dict[int, Dict[str, Any]]) -> None:
        track_ids = list(active_tracks.keys())
        to_remove = set()

        for index, track_id_a in enumerate(track_ids):
            if track_id_a in to_remove or track_id_a not in active_tracks:
                continue

            bbox_a = active_tracks[track_id_a].get("smoothed_bbox", active_tracks[track_id_a]["bbox"])

            for track_id_b in track_ids[index + 1:]:
                if track_id_b in to_remove or track_id_b not in active_tracks:
                    continue

                bbox_b = active_tracks[track_id_b].get("smoothed_bbox", active_tracks[track_id_b]["bbox"])
                overlap = self._bbox_iou(bbox_a, bbox_b)
                center_distance = self._bbox_center_distance_norm(bbox_a, bbox_b)
                size_ratio = self._bbox_size_ratio(bbox_a, bbox_b)

                if (
                    overlap < self.DUPLICATE_IOU_THRESHOLD
                    and not (
                        center_distance <= self.DUPLICATE_CENTER_THRESHOLD
                        and size_ratio >= self.DUPLICATE_SIZE_RATIO_THRESHOLD
                    )
                ):
                    continue

                track_a = active_tracks[track_id_a]
                track_b = active_tracks[track_id_b]

                score_a = (
                    track_a.get("frames_processed", 0),
                    track_a.get("match_count", 0),
                    track_a.get("bbox_area_ratio_sum", 0.0),
                    -track_a.get("missing_frames", 0),
                    -track_a.get("track_id", 0)
                )
                score_b = (
                    track_b.get("frames_processed", 0),
                    track_b.get("match_count", 0),
                    track_b.get("bbox_area_ratio_sum", 0.0),
                    -track_b.get("missing_frames", 0),
                    -track_b.get("track_id", 0)
                )

                if score_a >= score_b:
                    to_remove.add(track_id_b)
                else:
                    to_remove.add(track_id_a)
                    break

        for track_id in to_remove:
            if track_id in active_tracks:
                active_tracks[track_id]["suppressed"] = True
            active_tracks.pop(track_id, None)

    def _translate_local_bbox_to_global(
        self,
        local_bbox: Optional[Tuple[int, int, int, int]],
        crop_bbox: Tuple[int, int, int, int],
        frame_w: int,
        frame_h: int
    ) -> Optional[Tuple[int, int, int, int]]:
        if local_bbox is None:
            return None

        crop_x1, crop_y1, _, _ = crop_bbox
        local_x1, local_y1, local_x2, local_y2 = local_bbox
        global_bbox = (
            crop_x1 + local_x1,
            crop_y1 + local_y1,
            crop_x1 + local_x2,
            crop_y1 + local_y2
        )
        return self._clip_bbox(global_bbox, frame_w, frame_h)
