"""
CNN-based visual feature extraction for deepfake detection.

This module reuses the existing YOLO + tracker pipeline to:
1. sample tracked face crops from video frames,
2. preprocess them to 224x224,
3. run batched CNN inference,
4. return a temporally aggregated visual embedding for fusion.

The model is intentionally designed with both:
- an embedding head, used as the primary visual feature vector, and
- a binary classification head, used only when fine-tuned weights are loaded.

If no deepfake-specific checkpoint is supplied, or the classifier head cannot
be restored, the classifier head is zero-initialised so that `cnn_score`
stays at a neutral 0.5 instead of returning a misleading random probability.
Legacy checkpoints produced by a plain `torchvision.models.resnet50` binary
classifier are also supported.
"""

from __future__ import annotations

import argparse
import json
import warnings
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

import cv2
import numpy as np

from face_tracking import MultiFaceTracker

warnings.filterwarnings("ignore")

PROJECT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_CNN_CHECKPOINT_NAMES = (
    "Deepfake_cnn_weights.pth",
    "deepfake_cnn_weights.pth",
    "cnn_weights.pth",
)

try:
    import torch
    from torch import nn
except ImportError:  # pragma: no cover - dependency availability is environment-specific
    torch = None
    nn = None

try:
    import timm
except ImportError:  # pragma: no cover - optional dependency
    timm = None

try:
    from torchvision import models
    from torchvision.models import ResNet50_Weights
except ImportError:  # pragma: no cover - dependency availability is environment-specific
    models = None
    ResNet50_Weights = None


def resolve_cnn_checkpoint_path(
    checkpoint_path: Optional[Union[str, Path]] = None,
) -> Optional[Path]:
    candidates: List[Path] = []

    if checkpoint_path is not None:
        raw_path = Path(checkpoint_path).expanduser()
        candidates.append(raw_path)

        if raw_path.name in DEFAULT_CNN_CHECKPOINT_NAMES:
            for alias in DEFAULT_CNN_CHECKPOINT_NAMES:
                candidates.append(raw_path.with_name(alias))
                candidates.append(PROJECT_DIR / alias)
    else:
        for alias in DEFAULT_CNN_CHECKPOINT_NAMES:
            candidates.append(PROJECT_DIR / alias)

    seen: set[str] = set()
    for candidate in candidates:
        candidate_key = str(candidate)
        if candidate_key in seen:
            continue
        seen.add(candidate_key)
        if candidate.exists():
            return candidate.resolve()

    if checkpoint_path is None:
        return None

    return Path(checkpoint_path).expanduser()


class VisualDeepfakeNet(nn.Module):
    """Backbone + embedding head + binary classifier head."""

    def __init__(
        self,
        backbone_name: str = "resnet50",
        embedding_dim: int = 256,
        use_pretrained: bool = True,
    ):
        if nn is None or torch is None:
            raise RuntimeError(
                "PyTorch is required for CNN visual feature extraction. "
                "Use the feature_extraction virtualenv where torch is installed."
            )

        super().__init__()
        self.backbone_name = backbone_name.lower().strip()
        self.embedding_dim = int(embedding_dim)
        self.pretrained_loaded = False
        self.score_head = "embedding_classifier"
        self.vector_output_name = "embedding"
        self.legacy_classifier = None

        if self.backbone_name == "resnet50":
            weights = None
            if use_pretrained and ResNet50_Weights is not None:
                try:
                    weights = ResNet50_Weights.DEFAULT
                except Exception:
                    weights = None

            try:
                backbone = models.resnet50(weights=weights) if models is not None else None
                self.pretrained_loaded = weights is not None
            except Exception:
                backbone = models.resnet50(weights=None) if models is not None else None
                self.pretrained_loaded = False

            if backbone is None:
                raise RuntimeError("torchvision.models.resnet50 is unavailable.")

            feature_dim = int(backbone.fc.in_features)
            self.feature_dim = feature_dim
            backbone.fc = nn.Identity()
            self.feature_extractor = backbone
            self.input_mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
            self.input_std = np.array([0.229, 0.224, 0.225], dtype=np.float32)

        elif self.backbone_name == "xception":
            if timm is None:
                raise RuntimeError(
                    "Requested Xception backbone, but `timm` is not installed. "
                    "Use backbone='resnet50' or install timm."
                )

            try:
                backbone = timm.create_model("xception", pretrained=use_pretrained, num_classes=0)
                self.pretrained_loaded = bool(use_pretrained)
            except Exception:
                backbone = timm.create_model("xception", pretrained=False, num_classes=0)
                self.pretrained_loaded = False

            feature_dim = int(getattr(backbone, "num_features", 2048))
            self.feature_dim = feature_dim
            self.feature_extractor = backbone
            self.input_mean = np.array([0.5, 0.5, 0.5], dtype=np.float32)
            self.input_std = np.array([0.5, 0.5, 0.5], dtype=np.float32)

        else:
            raise ValueError("backbone_name must be 'resnet50' or 'xception'.")

        self.embedding_head = nn.Sequential(
            nn.Linear(feature_dim, self.embedding_dim),
            nn.ReLU(inplace=True),
            nn.Dropout(p=0.20),
        )
        self.classifier = nn.Linear(self.embedding_dim, 1)

    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        features = self.feature_extractor(x)
        embedding = self.embedding_head(features)
        if self.legacy_classifier is not None:
            logits = self.legacy_classifier(features)
            visual_vector = features
        else:
            logits = self.classifier(embedding)
            visual_vector = embedding
        return visual_vector, logits

    @staticmethod
    def _clean_state_dict(state_dict: Dict[str, Any]) -> Dict[str, Any]:
        cleaned = {}
        for key, value in state_dict.items():
            new_key = key
            if new_key.startswith("module."):
                new_key = new_key[len("module."):]
            cleaned[new_key] = value
        return cleaned

    def _compatible_state_dict(self, state_dict: Dict[str, Any]) -> Dict[str, Any]:
        current_state = self.state_dict()
        compatible = {}
        for key, value in state_dict.items():
            if key not in current_state:
                continue
            current_value = current_state[key]
            if not hasattr(value, "shape") or current_value.shape != value.shape:
                continue
            compatible[key] = value
        return compatible

    def _load_partial_state_dict(self, state_dict: Dict[str, Any]) -> Dict[str, Any]:
        compatible_state = self._compatible_state_dict(state_dict)
        if compatible_state:
            self.load_state_dict(compatible_state, strict=False)

        matched_keys = set(compatible_state.keys())
        embedding_classifier_loaded = {"classifier.weight", "classifier.bias"}.issubset(matched_keys)
        legacy_classifier_loaded = {"legacy_classifier.weight", "legacy_classifier.bias"}.issubset(matched_keys)
        classifier_loaded = embedding_classifier_loaded or legacy_classifier_loaded

        if embedding_classifier_loaded:
            self.score_head = "embedding_classifier"
            self.vector_output_name = "embedding"
            self.legacy_classifier = None
        elif legacy_classifier_loaded:
            self.score_head = "legacy_resnet_fc"
            self.vector_output_name = "backbone_features"

        return {
            "loaded": bool(compatible_state),
            "classifier_loaded": classifier_loaded,
            "load_mode": "native",
            "matched_keys": len(compatible_state),
        }

    def _load_legacy_resnet_checkpoint(self, state_dict: Dict[str, Any]) -> Dict[str, Any]:
        if self.backbone_name != "resnet50":
            return {
                "loaded": False,
                "classifier_loaded": False,
                "load_mode": "legacy_resnet50",
                "matched_keys": 0,
            }

        adapted_state_dict = {}
        for key, value in state_dict.items():
            if key.startswith("feature_extractor."):
                adapted_state_dict[key] = value
                continue
            if key.startswith(("conv1.", "bn1.", "layer1.", "layer2.", "layer3.", "layer4.")):
                adapted_state_dict[f"feature_extractor.{key}"] = value

        compatible_state = self._compatible_state_dict(adapted_state_dict)
        if compatible_state:
            self.load_state_dict(compatible_state, strict=False)

        classifier_loaded = False
        fc_weight = state_dict.get("fc.weight")
        fc_bias = state_dict.get("fc.bias")
        if (
            fc_weight is not None
            and fc_bias is not None
            and getattr(fc_weight, "shape", None) == torch.Size([1, self.feature_dim])
            and getattr(fc_bias, "shape", None) == torch.Size([1])
        ):
            legacy_classifier = nn.Linear(self.feature_dim, 1)
            with torch.no_grad():
                legacy_classifier.weight.copy_(fc_weight)
                legacy_classifier.bias.copy_(fc_bias)
            self.legacy_classifier = legacy_classifier
            self.score_head = "legacy_resnet_fc"
            self.vector_output_name = "backbone_features"
            classifier_loaded = True

        return {
            "loaded": bool(compatible_state) or classifier_loaded,
            "classifier_loaded": classifier_loaded,
            "load_mode": "legacy_resnet50",
            "matched_keys": len(compatible_state) + (2 if classifier_loaded else 0),
        }

    def load_checkpoint(self, checkpoint_path: Union[str, Path]) -> Dict[str, Any]:
        path = Path(checkpoint_path)
        if not path.exists():
            raise FileNotFoundError(f"CNN checkpoint not found: {path}")

        checkpoint = torch.load(path, map_location="cpu")
        if isinstance(checkpoint, dict):
            state_dict = (
                checkpoint.get("model_state_dict")
                or checkpoint.get("state_dict")
                or checkpoint.get("model")
                or checkpoint
            )
        else:
            state_dict = checkpoint

        state_dict = self._clean_state_dict(state_dict)
        native_info = self._load_partial_state_dict(state_dict)
        if native_info["classifier_loaded"]:
            return native_info

        legacy_info = self._load_legacy_resnet_checkpoint(state_dict)
        if legacy_info["classifier_loaded"]:
            return legacy_info
        if native_info["loaded"]:
            return native_info

        return legacy_info

    def zero_classifier_head(self) -> None:
        self.legacy_classifier = None
        self.score_head = "neutral_0.5"
        self.vector_output_name = "embedding"
        nn.init.zeros_(self.classifier.weight)
        nn.init.zeros_(self.classifier.bias)


class CNNVisualFeatureExtractor(MultiFaceTracker):
    """Tracked CNN face embedder for deepfake detection pipelines."""

    FACE_PADDING = 0.18
    DEFAULT_INPUT_SIZE = 224
    DEFAULT_BATCH_SIZE = 16
    DEFAULT_FRAME_SKIP = 5
    DEFAULT_EMBEDDING_DIM = 256
    MIN_FACE_SIZE_PX = 20
    MIN_TRACK_FRAMES = 5

    def __init__(
        self,
        backbone_name: str = "resnet50",
        model_weights_path: Optional[Union[str, Path]] = None,
        frame_skip: int = DEFAULT_FRAME_SKIP,
        batch_size: int = DEFAULT_BATCH_SIZE,
        input_size: int = DEFAULT_INPUT_SIZE,
        embedding_dim: int = DEFAULT_EMBEDDING_DIM,
        aggregation: str = "weighted_mean",
        classifier_threshold: float = 0.5,
        use_pretrained: bool = True,
        model_filename: str = "yolov8n-face-lindevs.pt",
    ):
        if torch is None:
            raise RuntimeError(
                "PyTorch is unavailable. The CNN visual feature extractor needs torch."
            )

        super().__init__(model_filename=model_filename)

        self.frame_skip = max(1, int(frame_skip))
        self.batch_size = max(1, int(batch_size))
        self.input_size = int(input_size)
        self.embedding_dim = int(embedding_dim)
        self.aggregation = aggregation.lower().strip()
        self.classifier_threshold = float(classifier_threshold)
        self.backbone_name = backbone_name.lower().strip()
        self.model_checkpoint_path = resolve_cnn_checkpoint_path(model_weights_path)

        self.torch_device = torch.device(self.device)
        self.model = VisualDeepfakeNet(
            backbone_name=self.backbone_name,
            embedding_dim=self.embedding_dim,
            use_pretrained=use_pretrained,
        )

        self.model_load_info = {
            "loaded": False,
            "classifier_loaded": False,
            "load_mode": "none",
            "matched_keys": 0,
        }
        if self.detector_backend == "haar":
            print("Warning: Ultralytics YOLO is unavailable. Falling back to OpenCV Haar face detection.")
        elif self.detector_backend == "none":
            print(
                "Warning: No face detector backend is available. "
                "cnn_score will remain neutral until YOLO or Haar detection is available."
            )

        if self.model_checkpoint_path is not None and self.model_checkpoint_path.exists():
            try:
                self.model_load_info = self.model.load_checkpoint(self.model_checkpoint_path)
            except Exception:
                self.model_load_info = {
                    "loaded": False,
                "classifier_loaded": False,
                "load_mode": "error",
                "matched_keys": 0,
                }
        elif self.model_checkpoint_path is not None:
            print(
                f"Warning: CNN checkpoint not found at {self.model_checkpoint_path}. "
                "cnn_score will remain neutral until compatible weights are provided."
            )

        if not self.model_load_info.get("classifier_loaded", False):
            checkpoint_label = (
                str(self.model_checkpoint_path)
                if self.model_checkpoint_path is not None
                else "no checkpoint provided"
            )
            print(
                "Warning: CNN classifier head was not loaded "
                f"({checkpoint_label}; mode={self.model_load_info.get('load_mode', 'none')}). "
                "cnn_score will default to 0.5 until a compatible VisualDeepfakeNet "
                "checkpoint is used."
            )
            self.model.zero_classifier_head()

        self.model.to(self.torch_device)
        self.model.eval()

    @staticmethod
    def _default_result(_: Path) -> Dict[str, Any]:
        return {
            "cnn_score": 0.5,
            "embedding_mean": float(np.nan),
        }

    def _create_track(
        self,
        track_id: int,
        bbox: Tuple[int, int, int, int],
        frame: np.ndarray,
    ) -> Dict[str, Any]:
        return self._build_track(
            track_id,
            bbox,
            frame,
            {
                "embedding_mean_sum": 0.0,
                "score_sum": 0.0,
                "weight_sum": 0.0,
                "sample_count": 0,
                "last_score": 0.5,
            },
        )

    @staticmethod
    def _safe_float(value: Any, default: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return float(default)

    def _preprocess_face(self, face_bgr: np.ndarray) -> np.ndarray:
        resized = cv2.resize(face_bgr, (self.input_size, self.input_size), interpolation=cv2.INTER_LINEAR)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        rgb = (rgb - self.model.input_mean) / self.model.input_std
        return np.transpose(rgb, (2, 0, 1)).astype(np.float32)

    def _sample_weight(
        self,
        bbox: Tuple[int, int, int, int],
        frame_w: int,
        frame_h: int,
    ) -> float:
        area_ratio = self._bbox_area(bbox) / max(1.0, float(frame_w * frame_h))
        area_score = float(np.clip(area_ratio / 0.12, 0.0, 1.0))
        center_score = self._center_proximity(bbox, frame_w, frame_h)
        return float(max(1e-3, (0.55 * center_score) + (0.45 * area_score)))

    def _run_inference(self, batch_faces: Sequence[np.ndarray]) -> Tuple[np.ndarray, np.ndarray]:
        batch = np.stack(batch_faces, axis=0)
        tensor = torch.from_numpy(batch).to(self.torch_device, non_blocking=True)

        with torch.no_grad():
            embeddings, logits = self.model(tensor)
            probabilities = torch.sigmoid(logits).squeeze(1)

        return (
            embeddings.detach().cpu().numpy().astype(np.float32),
            np.clip(
                probabilities.detach().cpu().numpy().astype(np.float32),
                0.0,
                1.0,
            ),
        )

    def _track_summary(self, track: Dict[str, Any]) -> Dict[str, Any]:
        frames_processed = int(track.get("frames_processed", 0))
        sample_count = int(track.get("sample_count", 0))
        avg_area_ratio = (
            float(track.get("bbox_area_ratio_sum", 0.0) / frames_processed)
            if frames_processed > 0 else 0.0
        )
        avg_center_proximity = (
            float(track.get("center_proximity_sum", 0.0) / frames_processed)
            if frames_processed > 0 else 0.0
        )
        primary_score = (
            float(frames_processed * (0.40 + avg_area_ratio) * (0.55 + 0.45 * avg_center_proximity))
            if frames_processed > 0 else 0.0
        )
        if sample_count <= 0:
            cnn_score = 0.5
            embedding_mean = float(np.nan)
        else:
            denominator = float(track.get("weight_sum", 0.0))
            if self.aggregation != "weighted_mean" or denominator <= 1e-6:
                denominator = float(sample_count)
            cnn_score = float(track.get("score_sum", 0.0) / max(denominator, 1e-6))
            embedding_mean = float(track.get("embedding_mean_sum", 0.0) / max(denominator, 1e-6))
            if not np.isfinite(cnn_score):
                cnn_score = 0.5
            cnn_score = float(np.clip(cnn_score, 0.0, 1.0))
            if not np.isfinite(embedding_mean):
                embedding_mean = float(np.nan)

        return {
            "track_id": int(track["track_id"]),
            "frames_processed": frames_processed,
            "avg_face_area_ratio": avg_area_ratio,
            "avg_center_proximity": avg_center_proximity,
            "primary_score": primary_score,
            "cnn_score": float(cnn_score),
            "embedding_mean": embedding_mean,
        }

    def _aggregate_face_summary_scores(self, summaries: Sequence[Dict[str, Any]]) -> float:
        """
        Compute the final video-level CNN score from all detected face summaries.

        We use the maximum valid face score so a suspicious non-primary face is
        not ignored. Invalid or missing scores are skipped, and the result falls
        back to 0.5 when no usable face scores are available.
        """
        if not summaries:
            return 0.5

        valid_scores: List[float] = []
        for summary in summaries:
            score = self._safe_float(summary.get("cnn_score"), default=np.nan)
            if np.isfinite(score):
                valid_scores.append(float(np.clip(score, 0.0, 1.0)))

        if not valid_scores:
            return 0.5

        return float(max(valid_scores))

    def _draw_track_overlay(self, frame: np.ndarray, track: Dict[str, Any]) -> None:
        x1, y1, x2, y2 = track.get("smoothed_bbox", track["bbox"])
        score = float(track.get("last_score", 0.5))
        color = (0, 200, 0) if score < self.classifier_threshold else (0, 80, 255)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        cv2.putText(
            frame,
            f"ID {track['track_id']} CNN:{score:.3f}",
            (x1, max(18, y1 - 10)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (255, 255, 0),
            2,
        )

    def process_video(
        self,
        video_path: Union[str, Path],
        display: bool = False,
    ) -> Dict[str, Any]:
        target_path = Path(video_path)
        result = self._default_result(target_path)

        cap = None
        try:
            cap = cv2.VideoCapture(str(target_path))
            fps = float(cap.get(cv2.CAP_PROP_FPS))
            frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            if fps <= 0 or fps > 120:
                fps = 30.0
            if frame_count <= 0 or frame_width <= 0 or frame_height <= 0:
                return result

            frame_idx = 0
            processed_frame_idx = 0
            next_track_id = 1
            active_tracks: Dict[int, Dict[str, Any]] = {}
            all_tracks: Dict[int, Dict[str, Any]] = {}

            summary_track_min_frames = max(self.MIN_TRACK_FRAMES, int(np.ceil(0.02 * frame_count / self.frame_skip)))

            frame_counter = 0
            max_frames = int(min(frame_count, fps * 6))
            
            while True:
                ok, frame = cap.read()
                if not ok:
                    break

                frame_idx += 1
                
                frame_counter += 1
                if frame_counter > max_frames:
                    break
                
                if frame_idx % self.frame_skip != 0:
                    continue

                processed_frame_idx += 1
                run_detection = (
                    processed_frame_idx == 1
                    or processed_frame_idx % self.YOLO_DETECTION_INTERVAL == 0
                    or not active_tracks
                )

                if self.detector_backend != "none" and run_detection:
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
                batch_faces: List[np.ndarray] = []
                batch_refs: List[Tuple[int, Tuple[int, int, int, int], float]] = []

                for track_id in list(active_tracks.keys()):
                    track = active_tracks.get(track_id)
                    if track is None:
                        continue

                    if track["last_backend"] != "yolo":
                        tracked_bbox = self._update_tracker_bbox(
                            track.get("tracker"),
                            frame,
                            frame_width,
                            frame_height,
                        )
                        if tracked_bbox is not None:
                            self._assign_track_bbox(
                                track,
                                tracked_bbox,
                                backend="tracker",
                                reinit_tracker=False,
                                frame_index=processed_frame_idx,
                            )

                    bbox = self._expand_bbox(
                        track.get("smoothed_bbox", track["bbox"]),
                        frame_width,
                        frame_height,
                        self.FACE_PADDING,
                    )
                    if bbox is None:
                        track["missing_frames"] += 1
                        if track["missing_frames"] > self.TRACK_MAX_MISSES:
                            active_tracks.pop(track_id, None)
                        continue

                    x1, y1, x2, y2 = bbox
                    face_crop = frame[y1:y2, x1:x2]
                    if (
                        face_crop.size == 0
                        or face_crop.shape[0] < self.MIN_FACE_SIZE_PX
                        or face_crop.shape[1] < self.MIN_FACE_SIZE_PX
                    ):
                        track["missing_frames"] += 1
                        if track["missing_frames"] > self.TRACK_MAX_MISSES:
                            active_tracks.pop(track_id, None)
                        continue

                    weight = self._sample_weight(bbox, frame_width, frame_height)
                    batch_faces.append(self._preprocess_face(face_crop))
                    batch_refs.append((track_id, bbox, weight))

                    track["missing_frames"] = 0
                    self._touch_track(track, processed_frame_idx)
                    track["observed_face_frames"] = int(track.get("observed_face_frames", 0)) + 1

                    current_bbox = track.get("smoothed_bbox", track["bbox"])
                    bbox_area_ratio = (
                        max(0, current_bbox[2] - current_bbox[0]) *
                        max(0, current_bbox[3] - current_bbox[1])
                    ) / max(1.0, float(frame_width * frame_height))
                    track["bbox_area_ratio_sum"] += float(bbox_area_ratio)
                    track["center_proximity_sum"] += self._center_proximity(current_bbox, frame_width, frame_height)

                for start_idx in range(0, len(batch_faces), self.batch_size):
                    batch_slice = batch_faces[start_idx:start_idx + self.batch_size]
                    ref_slice = batch_refs[start_idx:start_idx + self.batch_size]
                    embeddings, probabilities = self._run_inference(batch_slice)

                    for (track_id, _, weight), embedding, probability in zip(ref_slice, embeddings, probabilities):
                        track = active_tracks.get(track_id) or all_tracks.get(track_id)
                        if track is None:
                            continue
                        sample_weight = float(weight) if self.aggregation == "weighted_mean" else 1.0
                        if sample_weight <= 1e-6:
                            sample_weight = 1.0
                        track["embedding_mean_sum"] += float(np.mean(embedding)) * sample_weight
                        track["score_sum"] += float(probability) * sample_weight
                        track["weight_sum"] += sample_weight
                        track["sample_count"] += 1
                        track["last_score"] = float(probability)
                        track["frames_processed"] += 1

                if display:
                    out_frame = frame.copy()
                    visible_tracks = [track for track in active_tracks.values() if track["frames_processed"] >= 1]
                    cv2.putText(
                        out_frame,
                        f"Tracked faces: {len(visible_tracks)}",
                        (20, 35),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.8,
                        (0, 255, 0),
                        2,
                    )
                    for track in visible_tracks:
                        self._draw_track_overlay(out_frame, track)
                    cv2.imshow("CNN Visual Detector", out_frame)
                    if cv2.waitKey(1) == 27:
                        break

            summaries = [
                self._track_summary(track)
                for track in all_tracks.values()
                if (
                    int(track.get("frames_processed", 0)) >= summary_track_min_frames
                    and not track.get("suppressed", False)
                )
            ]
            summaries.sort(
                key=lambda item: (
                    item.get("primary_score", 0.0),
                    item["frames_processed"],
                    item.get("avg_face_area_ratio", 0.0),
                    item.get("avg_center_proximity", 0.0),
                ),
                reverse=True,
            )

            if summaries:
                primary_face = summaries[0]
                final_cnn_score = self._aggregate_face_summary_scores(summaries)
                result.update(
                    {
                        "cnn_score": float(np.clip(final_cnn_score, 0.0, 1.0)),
                        "embedding_mean": (
                            float(primary_face["embedding_mean"])
                            if np.isfinite(primary_face["embedding_mean"])
                            else float(np.nan)
                        ),
                    }
                )

            return result

        except Exception as exc:
            print(f"  Error processing {target_path.name}: {exc}")
            return result
        finally:
            if cap is not None:
                cap.release()
            if display:
                cv2.destroyAllWindows()

    def process_directory(self, directory: Path) -> List[Dict[str, Any]]:
        return [self.process_video(video_path) for video_path in sorted(directory.glob("*.mp4"))]

    def process(
        self,
        video_path: Optional[Union[str, Path]] = None,
        display: bool = False,
    ) -> Dict[str, Any]:
        if video_path is None:
            raise ValueError("Provide a video_path.")

        result = self.process_video(video_path, display=display)
        print("\n" + "=" * 14 + " CNN VISUAL RESULTS " + "=" * 14)
        print(f"  Video          : {Path(video_path).name}")
        print(f"  CNN score      : {result['cnn_score']:.4f}")
        print(f"  Embedding mean : {result['embedding_mean']:.6f}")
        print("=" * 49)
        return result


def _strip_feature_vectors(payload: Any) -> Any:
    return payload


if __name__ == "__main__":
    default_video = (
        r"D:\New_folder\deepfake_detection\deepfake_project\data\real\05__podium_speech_happy.mp4"
    )
    default_weights = resolve_cnn_checkpoint_path()

    parser = argparse.ArgumentParser(description="Extract CNN visual deepfake embeddings from a video.")
    parser.add_argument("input_path", nargs="?", default=str(default_video))
    parser.add_argument("--frame-skip", type=int, default=5, help="Process every nth frame.")
    parser.add_argument("--batch-size", type=int, default=16, help="Batch size for CNN inference.")
    parser.add_argument("--backbone", type=str, default="resnet50", help="resnet50 or xception.")
    parser.add_argument(
        "--weights",
        type=str,
        default=str(default_weights) if default_weights is not None and default_weights.exists() else None,
        help="Optional fine-tuned checkpoint path.",
    )
    parser.add_argument("--no-display", action="store_true", help="Disable preview window.")
    parser.add_argument(
        "--full-output",
        action="store_true",
        help="Include full CNN feature vectors in the final JSON output.",
    )
    args = parser.parse_args()

    extractor = CNNVisualFeatureExtractor(
        backbone_name=args.backbone,
        model_weights_path=args.weights,
        frame_skip=args.frame_skip,
        batch_size=args.batch_size,
    )

    target_path = Path(args.input_path)
    if target_path.is_dir():
        output = extractor.process_directory(target_path)
    elif target_path.is_file():
        output = extractor.process_video(target_path, display=not args.no_display)
    else:
        raise SystemExit(f"Input path not found: {target_path}")

    print("\n---- RESULTS ----", flush=True)
    payload = output if args.full_output else _strip_feature_vectors(output)
    print(json.dumps(payload, indent=2), flush=True)
