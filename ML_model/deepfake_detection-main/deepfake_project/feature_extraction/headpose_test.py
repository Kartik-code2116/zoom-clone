"""
Tracked head pose estimation for deepfake feature extraction.
"""

import argparse
import json
import warnings
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import cv2
import mediapipe as mp
import numpy as np

from face_tracking import MultiFaceTracker

warnings.filterwarnings("ignore")


def _get_face_mesh_module():
    solutions = getattr(mp, "solutions", None)
    if solutions is not None and hasattr(solutions, "face_mesh"):
        return solutions.face_mesh

    try:
        from mediapipe.python.solutions import face_mesh
        return face_mesh
    except ImportError as exc:
        raise RuntimeError(
            "MediaPipe FaceMesh is unavailable in this Python environment. "
            "Use the project virtualenv and ensure `mediapipe` is installed correctly."
        ) from exc


class RobustHeadPoseEstimator(MultiFaceTracker):
    LEFT_FACE_INDICES = [33, 133, 127, 234]
    RIGHT_FACE_INDICES = [263, 362, 356, 454]
    UPPER_FACE_INDICES = [10, 33, 263]
    LOWER_FACE_INDICES = [152, 61, 291]
    NOSE_INDEX = 1

    PNP_INDICES = [1, 152, 33, 263, 61, 291]
    PNP_MODEL_POINTS_3D = np.array([
        [0.0, 0.0, 0.0],
        [0.0, -330.0, -65.0],
        [-225.0, 170.0, -135.0],
        [225.0, 170.0, -135.0],
        [-150.0, -150.0, -125.0],
        [150.0, -150.0, -125.0]
    ], dtype=np.float32)

    MIN_DETECTION_CONFIDENCE = 0.5
    MIN_TRACKING_CONFIDENCE = 0.5
    SMOOTHING_WINDOW_SIZE = 5
    OUTLIER_MAD_THRESHOLD = 3.0
    OUT_OF_FRAME_TOLERANCE = 0.05
    MAX_YAW_JUMP_THRESHOLD = 45.0
    MAX_PITCH_JUMP_THRESHOLD = 35.0
    MAX_ROLL_JUMP_THRESHOLD = 45.0
    TRANSITION_SMOOTHING_ALPHA = 0.65
    LOST_FACE_RESET_SEC = 0.30
    FRONTAL_YAW_THRESHOLD = 32.0
    FRONTAL_PITCH_THRESHOLD = 24.0
    MIN_TRACK_FRONTAL_RATIO = 0.55
    MIN_TRACK_FRONTAL_FRAMES = 8

    FACE_PADDING = 0.20

    def __init__(self, static_image_mode: bool = False, frame_skip: int = 2):
        super().__init__()
        self.frame_skip = max(1, frame_skip)
        self.mp_face_mesh = _get_face_mesh_module()
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            static_image_mode=static_image_mode,
            max_num_faces=5,
            refine_landmarks=True,
            min_detection_confidence=self.MIN_DETECTION_CONFIDENCE,
            min_tracking_confidence=self.MIN_TRACKING_CONFIDENCE
        )

    @staticmethod
    def _normalize_angle(angle: float) -> float:
        while angle > 180:
            angle -= 360
        while angle < -180:
            angle += 360
        return float(angle)

    @staticmethod
    def _angle_difference(angle1: float, angle2: float) -> float:
        diff = angle2 - angle1
        while diff > 180:
            diff -= 360
        while diff < -180:
            diff += 360
        return float(diff)

    @staticmethod
    def _normalize_vector(vector: np.ndarray) -> Optional[np.ndarray]:
        norm = np.linalg.norm(vector)
        if norm <= 1e-6:
            return None
        return vector / norm

    @staticmethod
    def _weighted_circular_average(values: List[float], weights: Optional[np.ndarray] = None) -> float:
        if not values:
            return 0.0
        values_rad = np.radians(values)
        if weights is None:
            weights = np.ones(len(values_rad), dtype=np.float64)
        sin_sum = np.sum(np.sin(values_rad) * weights)
        cos_sum = np.sum(np.cos(values_rad) * weights)
        return RobustHeadPoseEstimator._normalize_angle(np.degrees(np.arctan2(sin_sum, cos_sum)))

    @staticmethod
    def _face_area(landmarks: np.ndarray, frame_w: int, frame_h: int) -> float:
        xs = landmarks[:, 0] * frame_w
        ys = landmarks[:, 1] * frame_h
        return float((np.max(xs) - np.min(xs)) * (np.max(ys) - np.min(ys)))

    def _select_main_face(
        self,
        multi_face_landmarks: list,
        frame_w: int,
        frame_h: int,
        target_center: Optional[Tuple[float, float]] = None
    ) -> Optional[np.ndarray]:
        if not multi_face_landmarks:
            return None

        best_landmarks = None
        best_score = -1.0
        for face_landmarks in multi_face_landmarks:
            landmarks = np.array([[lm.x, lm.y, lm.z] for lm in face_landmarks.landmark], dtype=np.float32)
            area = self._face_area(landmarks, frame_w, frame_h)
            if target_center is None:
                score = area
            else:
                center_x = float(np.mean(landmarks[:, 0]))
                center_y = float(np.mean(landmarks[:, 1]))
                distance = np.hypot(center_x - target_center[0], center_y - target_center[1])
                center_bonus = max(0.0, 1.0 - min(distance / 0.75, 1.0))
                score = area * (0.45 + 0.55 * center_bonus)
            if score > best_score:
                best_score = score
                best_landmarks = landmarks
        return best_landmarks

    @staticmethod
    def _average_landmarks(landmarks_3d: np.ndarray, indices: List[int]) -> np.ndarray:
        return np.mean(landmarks_3d[indices], axis=0)

    def _landmarks_to_metric_space(self, landmarks: np.ndarray, image_width: int, image_height: int) -> np.ndarray:
        points = landmarks.astype(np.float64).copy()
        points[:, 0] *= image_width
        points[:, 1] *= image_height
        points[:, 2] *= -image_width
        return points

    def _estimate_pose_from_geometry(
        self,
        landmarks: np.ndarray,
        image_width: int,
        image_height: int
    ) -> Optional[Tuple[float, float, float]]:
        points = self._landmarks_to_metric_space(landmarks, image_width, image_height)
        left_anchor = self._average_landmarks(points, self.LEFT_FACE_INDICES)
        right_anchor = self._average_landmarks(points, self.RIGHT_FACE_INDICES)
        upper_anchor = self._average_landmarks(points, self.UPPER_FACE_INDICES)
        lower_anchor = self._average_landmarks(points, self.LOWER_FACE_INDICES)
        nose = points[self.NOSE_INDEX]
        face_center = np.mean([left_anchor, right_anchor, upper_anchor, lower_anchor], axis=0)

        x_axis = self._normalize_vector(right_anchor - left_anchor)
        y_reference = self._normalize_vector(lower_anchor - upper_anchor)
        if x_axis is None or y_reference is None:
            return None

        z_axis = self._normalize_vector(np.cross(x_axis, y_reference))
        if z_axis is None:
            return None
        if np.dot(nose - face_center, z_axis) < 0:
            z_axis = -z_axis

        y_axis = self._normalize_vector(np.cross(z_axis, x_axis))
        if y_axis is None:
            return None
        x_axis = self._normalize_vector(np.cross(y_axis, z_axis))
        if x_axis is None:
            return None

        yaw = np.degrees(np.arctan2(z_axis[0], z_axis[2]))
        pitch = np.degrees(np.arctan2(-z_axis[1], np.sqrt(z_axis[0] ** 2 + z_axis[2] ** 2)))
        roll = np.degrees(np.arctan2(x_axis[1], x_axis[0]))
        return (
            self._normalize_angle(yaw),
            self._normalize_angle(pitch),
            self._normalize_angle(roll)
        )

    def _extract_pnp_2d_points(
        self,
        landmarks: np.ndarray,
        image_width: int,
        image_height: int
    ) -> Optional[np.ndarray]:
        tol_x = self.OUT_OF_FRAME_TOLERANCE * image_width
        tol_y = self.OUT_OF_FRAME_TOLERANCE * image_height
        points_2d = []
        try:
            for landmark_idx in self.PNP_INDICES:
                x = landmarks[landmark_idx, 0] * image_width
                y = landmarks[landmark_idx, 1] * image_height
                if x < -tol_x or x > image_width + tol_x or y < -tol_y or y > image_height + tol_y:
                    return None
                points_2d.append([np.clip(x, 0, image_width), np.clip(y, 0, image_height)])
        except (IndexError, TypeError, ValueError):
            return None
        return np.array(points_2d, dtype=np.float32)

    @staticmethod
    def _estimate_camera_matrix(image_width: int, image_height: int) -> np.ndarray:
        focal_length = max(image_width, image_height)
        center_x = image_width / 2.0
        center_y = image_height / 2.0
        return np.array([
            [focal_length, 0.0, center_x],
            [0.0, focal_length, center_y],
            [0.0, 0.0, 1.0]
        ], dtype=np.float32)

    def _estimate_pose_with_pnp(
        self,
        landmarks: np.ndarray,
        image_width: int,
        image_height: int,
        camera_matrix: np.ndarray,
        previous_rvec: Optional[np.ndarray] = None,
        previous_tvec: Optional[np.ndarray] = None
    ) -> Tuple[Optional[Tuple[float, float, float]], Optional[np.ndarray], Optional[np.ndarray]]:
        image_points = self._extract_pnp_2d_points(landmarks, image_width, image_height)
        if image_points is None:
            return None, previous_rvec, previous_tvec

        dist_coeffs = np.zeros((4, 1), dtype=np.float32)
        for method in [cv2.SOLVEPNP_ITERATIVE, cv2.SOLVEPNP_EPNP]:
            try:
                use_guess = previous_rvec is not None and previous_tvec is not None and method == cv2.SOLVEPNP_ITERATIVE
                success, rotation_vector, translation_vector = cv2.solvePnP(
                    objectPoints=self.PNP_MODEL_POINTS_3D,
                    imagePoints=image_points,
                    cameraMatrix=camera_matrix,
                    distCoeffs=dist_coeffs,
                    rvec=previous_rvec if use_guess else None,
                    tvec=previous_tvec if use_guess else None,
                    useExtrinsicGuess=use_guess,
                    flags=method
                )
                if not success:
                    continue
                if hasattr(cv2, "solvePnPRefineLM"):
                    try:
                        rotation_vector, translation_vector = cv2.solvePnPRefineLM(
                            objectPoints=self.PNP_MODEL_POINTS_3D,
                            imagePoints=image_points,
                            cameraMatrix=camera_matrix,
                            distCoeffs=dist_coeffs,
                            rvec=rotation_vector,
                            tvec=translation_vector
                        )
                    except cv2.error:
                        pass
                rotation_matrix, _ = cv2.Rodrigues(rotation_vector)
                projection_matrix = np.hstack((rotation_matrix, translation_vector))
                _, _, _, _, _, _, euler_angles = cv2.decomposeProjectionMatrix(projection_matrix)
                pitch, yaw, roll = euler_angles.flatten()
                return (
                    (
                        self._normalize_angle(float(yaw)),
                        self._normalize_angle(float(pitch)),
                        self._normalize_angle(float(roll))
                    ),
                    rotation_vector,
                    translation_vector
                )
            except cv2.error:
                continue
        return None, previous_rvec, previous_tvec

    def _stabilize_pose_transition(
        self,
        previous_pose: Optional[Tuple[float, float, float]],
        current_pose: Tuple[float, float, float]
    ) -> Tuple[float, float, float]:
        if previous_pose is None:
            return current_pose
        limits = [
            self.MAX_YAW_JUMP_THRESHOLD,
            self.MAX_PITCH_JUMP_THRESHOLD,
            self.MAX_ROLL_JUMP_THRESHOLD
        ]
        stabilized = []
        for previous_angle, current_angle, limit in zip(previous_pose, current_pose, limits):
            diff = self._angle_difference(previous_angle, current_angle)
            diff = float(np.clip(diff, -limit, limit))
            stabilized.append(self._normalize_angle(previous_angle + (1.0 - self.TRANSITION_SMOOTHING_ALPHA) * diff))
        return tuple(stabilized)

    def _apply_temporal_smoothing(
        self,
        angles_list: List[Tuple[float, float, float]],
        window_size: Optional[int] = None
    ) -> List[Tuple[float, float, float]]:
        if not angles_list:
            return []
        if window_size is None:
            window_size = self.SMOOTHING_WINDOW_SIZE
        window_size = min(window_size, len(angles_list))
        weights = np.arange(1, window_size + 1, dtype=np.float64)
        weights = weights / weights.sum()
        smoothed = []
        for index in range(len(angles_list)):
            start = max(0, index - window_size + 1)
            window = angles_list[start:index + 1]
            current_weights = weights[-len(window):]
            current_weights = current_weights / current_weights.sum()
            smoothed.append((
                self._weighted_circular_average([a[0] for a in window], current_weights),
                float(np.average([a[1] for a in window], weights=current_weights)),
                self._weighted_circular_average([a[2] for a in window], current_weights)
            ))
        return smoothed

    def _remove_outliers_mad(self, angles_list: List[Tuple[float, float, float]]) -> List[Tuple[float, float, float]]:
        if len(angles_list) < 5:
            return angles_list

        yaw = np.array([a[0] for a in angles_list], dtype=np.float64)
        pitch = np.array([a[1] for a in angles_list], dtype=np.float64)
        roll = np.array([a[2] for a in angles_list], dtype=np.float64)

        median_yaw = np.median(yaw)
        median_pitch = np.median(pitch)
        median_roll = np.median(roll)

        yaw_residuals = np.array([abs(self._angle_difference(median_yaw, angle)) for angle in yaw], dtype=np.float64)
        pitch_residuals = np.abs(pitch - median_pitch)
        roll_residuals = np.array([abs(self._angle_difference(median_roll, angle)) for angle in roll], dtype=np.float64)

        mad_yaw = max(np.median(yaw_residuals), 1e-6)
        mad_pitch = max(np.median(pitch_residuals), 1e-6)
        mad_roll = max(np.median(roll_residuals), 1e-6)

        mask = (
            (yaw_residuals / mad_yaw < self.OUTLIER_MAD_THRESHOLD) &
            (pitch_residuals / mad_pitch < self.OUTLIER_MAD_THRESHOLD) &
            (roll_residuals / mad_roll < self.OUTLIER_MAD_THRESHOLD)
        )
        filtered = [angles_list[index] for index in range(len(angles_list)) if mask[index]]
        return filtered if filtered else angles_list

    def _compute_statistics(
        self,
        angles_list: List[Tuple[float, float, float]],
        fps: float,
        frame_skip: int
    ) -> Dict[str, float]:
        if len(angles_list) < 2:
            return {
                "mean_yaw": 0.0,
                "yaw_variance": 0.0,
                "mean_pitch": 0.0,
                "pitch_variance": 0.0,
                "mean_roll": 0.0,
                "roll_variance": 0.0,
                "yaw_angular_velocity": 0.0,
                "pitch_angular_velocity": 0.0,
                "roll_angular_velocity": 0.0
            }

        clean_angles = self._remove_outliers_mad(angles_list)
        if len(clean_angles) < 2:
            clean_angles = angles_list

        yaw_angles = np.array([a[0] for a in clean_angles], dtype=np.float64)
        pitch_angles = np.array([a[1] for a in clean_angles], dtype=np.float64)
        roll_angles = np.array([a[2] for a in clean_angles], dtype=np.float64)

        mean_yaw = self._weighted_circular_average(list(yaw_angles))
        mean_pitch = float(np.mean(pitch_angles))
        mean_roll = self._weighted_circular_average(list(roll_angles))

        yaw_diffs = np.array([self._angle_difference(mean_yaw, angle) for angle in yaw_angles], dtype=np.float64)
        pitch_diffs = pitch_angles - mean_pitch
        roll_diffs = np.array([self._angle_difference(mean_roll, angle) for angle in roll_angles], dtype=np.float64)

        effective_fps = fps / frame_skip if fps > 0 else 15.0
        time_delta = 1.0 / effective_fps if effective_fps > 0 else 1.0 / 15.0

        yaw_velocities = []
        pitch_velocities = []
        roll_velocities = []
        for index in range(1, len(clean_angles)):
            yaw_diff = self._angle_difference(clean_angles[index - 1][0], clean_angles[index][0])
            pitch_diff = clean_angles[index][1] - clean_angles[index - 1][1]
            roll_diff = self._angle_difference(clean_angles[index - 1][2], clean_angles[index][2])
            if abs(yaw_diff) <= self.MAX_YAW_JUMP_THRESHOLD:
                yaw_velocities.append(abs(yaw_diff) / time_delta)
            if abs(pitch_diff) <= self.MAX_PITCH_JUMP_THRESHOLD:
                pitch_velocities.append(abs(pitch_diff) / time_delta)
            if abs(roll_diff) <= self.MAX_ROLL_JUMP_THRESHOLD:
                roll_velocities.append(abs(roll_diff) / time_delta)

        return {
            "mean_yaw": float(mean_yaw),
            "yaw_variance": float(np.var(yaw_diffs)),
            "mean_pitch": mean_pitch,
            "pitch_variance": float(np.var(pitch_diffs)),
            "mean_roll": float(mean_roll),
            "roll_variance": float(np.var(roll_diffs)),
            "yaw_angular_velocity": float(np.mean(yaw_velocities)) if yaw_velocities else 0.0,
            "pitch_angular_velocity": float(np.mean(pitch_velocities)) if pitch_velocities else 0.0,
            "roll_angular_velocity": float(np.mean(roll_velocities)) if roll_velocities else 0.0
        }

    def _extract_pose_from_face(
        self,
        face_frame: np.ndarray,
        previous_rvec: Optional[np.ndarray],
        previous_tvec: Optional[np.ndarray]
    ) -> Optional[Dict[str, Any]]:
        if face_frame.size == 0:
            return None
        frame_h, frame_w = face_frame.shape[:2]
        rgb_frame = cv2.cvtColor(face_frame, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(rgb_frame)
        if not results.multi_face_landmarks:
            return None

        landmarks = self._select_main_face(results.multi_face_landmarks, frame_w, frame_h, target_center=(0.5, 0.5))
        if landmarks is None:
            return None

        camera_matrix = self._estimate_camera_matrix(frame_w, frame_h)
        geometry_pose = self._estimate_pose_from_geometry(landmarks, frame_w, frame_h)
        pnp_pose, updated_rvec, updated_tvec = self._estimate_pose_with_pnp(
            landmarks,
            frame_w,
            frame_h,
            camera_matrix,
            previous_rvec,
            previous_tvec
        )

        pose = geometry_pose if geometry_pose is not None else pnp_pose
        if pose is None:
            return None

        xs = landmarks[:, 0] * frame_w
        ys = landmarks[:, 1] * frame_h
        nose_point = (
            float(landmarks[self.NOSE_INDEX, 0] * frame_w),
            float(landmarks[self.NOSE_INDEX, 1] * frame_h)
        )
        local_face_bbox = self._expand_bbox(
            (
                int(np.min(xs)),
                int(np.min(ys)),
                int(np.max(xs)),
                int(np.max(ys))
            ),
            frame_w,
            frame_h,
            self.LANDMARK_BOX_PADDING
        )
        return {
            "pose": pose,
            "face_bbox": local_face_bbox,
            "rvec": updated_rvec,
            "tvec": updated_tvec,
            "camera_matrix": camera_matrix,
            "nose_point": nose_point,
            "axis_ready": bool(pnp_pose is not None and updated_rvec is not None and updated_tvec is not None)
        }

    @staticmethod
    def _default_result(video_path: Path) -> Dict[str, Any]:
        return {
            "video_path": video_path.name,
            "yaw_variance": -1.0,
            "pitch_variance": -1.0,
            "roll_variance": -1.0,
            "yaw_angular_velocity": -1.0,
            "pitch_angular_velocity": -1.0,
            "roll_angular_velocity": -1.0,
            "mean_yaw": -1.0,
            "mean_pitch": -1.0,
            "mean_roll": -1.0,
            "duration": 0.0,
            "frames_processed": 0,
            "faces_detected": 0,
            "primary_track_id": -1,
            "face_summaries": []
        }

    def _create_track(self, track_id: int, bbox: Tuple[int, int, int, int], frame: np.ndarray) -> Dict[str, Any]:
        return self._build_track(
            track_id,
            bbox,
            frame,
            {
                "angles": [],
                "previous_pose": None,
                "previous_rvec": None,
                "previous_tvec": None,
                "last_pose": (0.0, 0.0, 0.0),
                "last_axis": None
            }
        )

    def _track_summary(self, track: Dict[str, Any], fps: float, frame_skip: int) -> Dict[str, Any]:
        stats = self._compute_statistics(self._apply_temporal_smoothing(track["angles"]), fps, frame_skip)
        avg_area_ratio = (
            float(track["bbox_area_ratio_sum"] / track["frames_processed"])
            if track["frames_processed"] > 0 else 0.0
        )
        avg_center_proximity = (
            float(track["center_proximity_sum"] / track["frames_processed"])
            if track["frames_processed"] > 0 else 0.0
        )
        primary_score = (
            float(track["frames_processed"] * (0.40 + avg_area_ratio) * (0.55 + 0.45 * avg_center_proximity))
            if track["frames_processed"] > 0 else 0.0
        )
        return {
            "track_id": track["track_id"],
            "frames_processed": track["frames_processed"],
            "observed_face_frames": int(track.get("observed_face_frames", 0)),
            "frontal_face_frames": int(track.get("frontal_face_frames", 0)),
            "frontal_face_ratio": self._track_frontality_ratio(track),
            "avg_face_area_ratio": avg_area_ratio,
            "avg_center_proximity": avg_center_proximity,
            "primary_score": primary_score,
            **stats
        }

    def _draw_track_overlay(self, frame: np.ndarray, track: Dict[str, Any]) -> None:
        x1, y1, x2, y2 = track.get("smoothed_bbox", track["bbox"])
        yaw, pitch, roll = track["last_pose"]
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)

        axis_data = track.get("last_axis")
        if axis_data is not None:
            crop_x1, crop_y1 = axis_data["crop_origin"]
            nose_local = np.asarray(axis_data["nose_point"], dtype=np.float32).reshape(1, 1, 2)
            axis_length = max(35, int(0.45 * max(x2 - x1, y2 - y1)))
            axis_points_3d = np.array([
                [axis_length, 0.0, 0.0],
                [0.0, -axis_length, 0.0],
                [0.0, 0.0, axis_length]
            ], dtype=np.float32)
            projected, _ = cv2.projectPoints(
                axis_points_3d,
                axis_data["rvec"],
                axis_data["tvec"],
                axis_data["camera_matrix"],
                np.zeros((4, 1), dtype=np.float32)
            )
            nose_point = (
                int(round(crop_x1 + float(nose_local[0, 0, 0]))),
                int(round(crop_y1 + float(nose_local[0, 0, 1])))
            )
            axis_colors = [(0, 0, 255), (0, 255, 0), (255, 0, 0)]
            for projected_point, color in zip(projected.reshape(-1, 2), axis_colors):
                end_point = (
                    int(round(crop_x1 + float(projected_point[0]))),
                    int(round(crop_y1 + float(projected_point[1])))
                )
                cv2.line(frame, nose_point, end_point, color, 2)
            cv2.circle(frame, nose_point, 3, (255, 255, 255), -1)

        label_y = max(20, y1 - 10)
        cv2.putText(frame, f"ID {track['track_id']} Y:{yaw:.1f} P:{pitch:.1f} R:{roll:.1f}", (x1, label_y),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 2)
        cv2.putText(frame, f"Box:{track['last_backend']} Frames:{track['frames_processed']}",
                    (x1, min(frame.shape[0] - 10, y2 + 20)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 0), 2)

    def process_video(self, video_path: Union[str, Path], display: bool = False) -> Dict[str, Any]:
        video_path = Path(video_path)
        result = self._default_result(video_path)

        cap = None
        try:
            cap = cv2.VideoCapture(str(video_path))
            fps = cap.get(cv2.CAP_PROP_FPS)
            frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            if fps <= 0 or fps > 120:
                fps = 30.0
            if frame_count <= 0 or frame_width <= 0 or frame_height <= 0:
                cap.release()
                return result

            result["duration"] = frame_count / fps
            skip_options = [self.frame_skip]
            if self.frame_skip != 1:
                skip_options.append(1)

            final_result = None
            for current_skip in skip_options:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                processed_frame_idx = 0
                frame_idx = 0
                next_track_id = 1
                active_tracks: Dict[int, Dict[str, Any]] = {}
                all_tracks: Dict[int, Dict[str, Any]] = {}

                min_track_frames = max(8, int(np.ceil(0.05 * frame_count / current_skip)))
                summary_track_min_frames = max(8, int(np.ceil(0.015 * frame_count / current_skip)))
                lost_face_reset_frames = max(1, int(np.ceil(self.LOST_FACE_RESET_SEC * fps / current_skip)))

                while True:
                    ret, frame = cap.read()
                    if not ret:
                        break

                    frame_idx += 1
                    if frame_idx % current_skip != 0:
                        continue

                    processed_frame_idx += 1
                    run_detection = (
                        processed_frame_idx == 1
                        or processed_frame_idx % self.YOLO_DETECTION_INTERVAL == 0
                        or not active_tracks
                    )

                    if self.yolo is not None and run_detection:
                        detections = self._detect_faces(frame)
                        next_track_id = self._update_tracks_from_detections(
                            active_tracks,
                            all_tracks,
                            detections,
                            next_track_id,
                            frame,
                            self._create_track,
                            frame_index=processed_frame_idx,
                        )
                        self._prune_overlapping_tracks(active_tracks)
                    elif self.yolo is None and not active_tracks:
                        track = self._create_track(next_track_id, (0, 0, frame_width, frame_height), frame)
                        self._touch_track(track, processed_frame_idx)
                        active_tracks[next_track_id] = track
                        all_tracks[next_track_id] = track
                        next_track_id += 1

                    for track_id in list(active_tracks.keys()):
                        track = active_tracks.get(track_id)
                        if track is None:
                            continue

                        if track["last_backend"] != "yolo":
                            tracked_bbox = self._update_tracker_bbox(track.get("tracker"), frame, frame_width, frame_height)
                            if tracked_bbox is not None:
                                self._assign_track_bbox(
                                    track,
                                    tracked_bbox,
                                    backend="tracker",
                                    reinit_tracker=False,
                                    frame_index=processed_frame_idx,
                                )

                        bbox = self._expand_bbox(track.get("smoothed_bbox", track["bbox"]), frame_width, frame_height, self.FACE_PADDING)
                        if bbox is None:
                            track["missing_frames"] += 1
                            if track["missing_frames"] > self.TRACK_MAX_MISSES:
                                active_tracks.pop(track_id, None)
                            continue

                        x1, y1, x2, y2 = bbox
                        analysis = self._extract_pose_from_face(
                            frame[y1:y2, x1:x2],
                            track.get("previous_rvec"),
                            track.get("previous_tvec")
                        )
                        if analysis is None:
                            track["missing_frames"] += 1
                            if track["missing_frames"] >= lost_face_reset_frames:
                                track["previous_pose"] = None
                                track["previous_rvec"] = None
                                track["previous_tvec"] = None
                                track["last_axis"] = None
                            if track["missing_frames"] > self.TRACK_MAX_MISSES:
                                active_tracks.pop(track_id, None)
                            continue

                        track["missing_frames"] = 0
                        self._touch_track(track, processed_frame_idx)
                        track["observed_face_frames"] = int(track.get("observed_face_frames", 0)) + 1
                        refined_bbox = self._translate_local_bbox_to_global(analysis.get("face_bbox"), bbox, frame_width, frame_height)
                        if refined_bbox is not None:
                            overlap = self._bbox_iou(refined_bbox, track.get("smoothed_bbox", track["bbox"]))
                            center_distance = self._bbox_center_distance_norm(refined_bbox, track.get("smoothed_bbox", track["bbox"]))
                            if overlap >= 0.08 or center_distance <= 0.55:
                                self._assign_track_bbox(
                                    track,
                                    refined_bbox,
                                    frame=frame,
                                    backend="mesh",
                                    frame_index=processed_frame_idx,
                                )

                        pose = self._stabilize_pose_transition(track.get("previous_pose"), analysis["pose"])
                        if abs(float(pose[0])) <= self.FRONTAL_YAW_THRESHOLD and abs(float(pose[1])) <= self.FRONTAL_PITCH_THRESHOLD:
                            track["frontal_face_frames"] = int(track.get("frontal_face_frames", 0)) + 1
                        track["usable_face_frames"] = int(track.get("usable_face_frames", 0)) + 1
                        track["previous_pose"] = pose
                        track["previous_rvec"] = analysis.get("rvec")
                        track["previous_tvec"] = analysis.get("tvec")
                        track["last_pose"] = pose
                        if analysis.get("axis_ready"):
                            track["last_axis"] = {
                                "rvec": analysis["rvec"],
                                "tvec": analysis["tvec"],
                                "camera_matrix": analysis["camera_matrix"],
                                "nose_point": analysis["nose_point"],
                                "crop_origin": (x1, y1)
                            }
                        else:
                            track["last_axis"] = None
                        track["angles"].append(pose)
                        track["frames_processed"] += 1

                        current_bbox = track.get("smoothed_bbox", track["bbox"])
                        bbox_area_ratio = (
                            max(0, current_bbox[2] - current_bbox[0]) *
                            max(0, current_bbox[3] - current_bbox[1])
                        ) / max(1.0, frame_width * frame_height)
                        track["bbox_area_ratio_sum"] += float(bbox_area_ratio)
                        track["center_proximity_sum"] += self._center_proximity(current_bbox, frame_width, frame_height)

                    if display:
                        visible_tracks = [track for track in active_tracks.values() if track["frames_processed"] >= 2]
                        cv2.putText(frame, f"Tracked faces: {len(visible_tracks)}", (20, 35),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                        for track in visible_tracks:
                            self._draw_track_overlay(frame, track)
                        cv2.imshow("Head Pose Estimation", frame)
                        if cv2.waitKey(1) == 27:
                            break

                face_summaries = [
                    self._track_summary(track, fps, current_skip)
                    for track in all_tracks.values()
                    if (
                        track["frames_processed"] >= summary_track_min_frames
                        and not track.get("suppressed", False)
                        and self._track_is_frontal_majority(
                            track,
                            self.MIN_TRACK_FRONTAL_RATIO,
                            self.MIN_TRACK_FRONTAL_FRAMES,
                        )
                    )
                ]
                face_summaries.sort(
                    key=lambda item: (
                        item.get("primary_score", 0.0),
                        item["frames_processed"],
                        item.get("avg_face_area_ratio", 0.0),
                        item.get("avg_center_proximity", 0.0)
                    ),
                    reverse=True
                )

                if not face_summaries:
                    continue

                primary_face = face_summaries[0]
                if primary_face["frames_processed"] < min_track_frames:
                    continue

                final_result = {
                    "yaw_variance": primary_face["yaw_variance"],
                    "pitch_variance": primary_face["pitch_variance"],
                    "roll_variance": primary_face["roll_variance"],
                    "yaw_angular_velocity": primary_face["yaw_angular_velocity"],
                    "pitch_angular_velocity": primary_face["pitch_angular_velocity"],
                    "roll_angular_velocity": primary_face["roll_angular_velocity"],
                    "mean_yaw": primary_face["mean_yaw"],
                    "mean_pitch": primary_face["mean_pitch"],
                    "mean_roll": primary_face["mean_roll"],
                    "frames_processed": primary_face["frames_processed"],
                    "faces_detected": len(face_summaries),
                    "primary_track_id": primary_face["track_id"],
                    "face_summaries": face_summaries
                }
                break

            if final_result is not None:
                result.update(final_result)

            cap.release()
            if display:
                cv2.destroyAllWindows()
            return result

        except Exception as exc:
            print(f"  Error processing {video_path.name}: {exc}")
            if cap is not None:
                cap.release()
            if display:
                cv2.destroyAllWindows()
            return result

    def process_directory(self, directory: Path) -> List[Dict[str, Any]]:
        results = []
        for video_path in sorted(directory.glob("*.mp4")):
            results.append(self.process_video(video_path))
        return results


if __name__ == "__main__":
    default_video = (
        r"D:\New_folder\deepfake_detection\deepfake_project\data\real\03__walking_down_indoor_hall_disgust.mp4"
    )

    parser = argparse.ArgumentParser(description="Estimate head pose from a video or directory of videos.")
    parser.add_argument("input_path", nargs="?", default=str(default_video),
                        help="Path to an .mp4 file or a directory containing .mp4 files")
    parser.add_argument("--frame-skip", type=int, default=2, help="Process every nth frame")
    parser.add_argument("--no-display", action="store_true", help="Disable the preview window")
    args = parser.parse_args()

    target_path = Path(args.input_path)
    estimator = RobustHeadPoseEstimator(static_image_mode=False, frame_skip=args.frame_skip)

    if target_path.is_dir():
        output = estimator.process_directory(target_path)
    elif target_path.is_file():
        output = estimator.process_video(target_path, display=not args.no_display)
    else:
        raise SystemExit(f"Input path not found: {target_path}")

    print("\n---- RESULTS ----", flush=True)
    print(json.dumps(output, indent=2), flush=True)
