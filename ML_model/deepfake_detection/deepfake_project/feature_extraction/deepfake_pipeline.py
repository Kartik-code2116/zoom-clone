"""
End-to-end deepfake detection pipeline built around the compact 8-feature fusion schema.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Union

from blink_test import BlinkDetector
from cnn_visual_detector import CNNVisualFeatureExtractor, resolve_cnn_checkpoint_path
from facial_landmarks import RobustFacialLandmarkExtractor
from fusion_classifier import DeepfakeFusionClassifier, FusionFeatureAssembler
from headpose_test import RobustHeadPoseEstimator


class DeepfakeDetectionPipeline:
    """Runs feature extraction modules and optional fusion classification."""

    def __init__(
        self,
        blink_frame_skip: int = 2,
        headpose_frame_skip: int = 2,
        landmark_frame_skip: int = 1,
        cnn_frame_skip: int = 5,
        cnn_backbone: str = "resnet50",
        cnn_weights_path: Optional[Union[str, Path]] = None,
        cnn_use_pretrained: bool = True,
        fusion_model_path: Optional[Union[str, Path]] = None,
        training_csv_path: Optional[Union[str, Path]] = None,
        fusion_model_type: str = "random_forest",
    ):
        resolved_cnn_weights_path = resolve_cnn_checkpoint_path(cnn_weights_path)
        try:
            self.blink_extractor = BlinkDetector(frame_skip=blink_frame_skip, tracking_mode="auto")
        except Exception as e:
            print(f"BlinkDetector unavailable (MediaPipe issue): {e}. Using fallback.")
            self.blink_extractor = None

        self.headpose_extractor = RobustHeadPoseEstimator(frame_skip=headpose_frame_skip)
        self.landmark_extractor = RobustFacialLandmarkExtractor(frame_skip=landmark_frame_skip)
        self.cnn_extractor = CNNVisualFeatureExtractor(
            backbone_name=cnn_backbone,
            model_weights_path=resolved_cnn_weights_path,
            frame_skip=cnn_frame_skip,
            use_pretrained=cnn_use_pretrained,
        )

        self.fusion_model_path = Path(fusion_model_path) if fusion_model_path else None
        self.training_csv_path = (
            Path(training_csv_path)
            if training_csv_path is not None
            else Path(__file__).with_name("dataset_features.csv")
        )
        self.fusion_model_type = fusion_model_type
        self.fusion_classifier: Optional[DeepfakeFusionClassifier] = None
        self.feature_columns = list(FusionFeatureAssembler.FEATURE_COLUMNS)

        if self.fusion_model_path is not None and self.fusion_model_path.exists():
            try:
                self.fusion_classifier = DeepfakeFusionClassifier.load(self.fusion_model_path)
            except Exception:
                self.fusion_classifier = None

    def _ensure_fusion_classifier(self) -> None:
        if self.fusion_classifier is not None:
            return

        if self.fusion_model_path is not None and self.fusion_model_path.exists():
            self.fusion_classifier = DeepfakeFusionClassifier.load(self.fusion_model_path)
            return

        if self.training_csv_path is None or not self.training_csv_path.exists():
            return

        try:
            classifier = DeepfakeFusionClassifier(model_type=self.fusion_model_type)
            classifier.fit_from_csv(self.training_csv_path)
            self.fusion_classifier = classifier
        except Exception:
            self.fusion_classifier = None

    def extract_features(
        self,
        video_path: Union[str, Path],
        label: Optional[str] = None,
    ) -> Tuple[Dict[str, Any], Dict[str, Dict[str, Any]]]:
        """Extract the compact fused record plus optional per-module payloads."""
        target_path = str(video_path)

        if self.blink_extractor:
            blink_result = self.blink_extractor.process_video(target_path)
        else:
            blink_result = {"blink_rate": 0.0, "interval_cv": 0.0}
        headpose_result = self.headpose_extractor.process_video(target_path)
        landmark_result = self.landmark_extractor.process_video(target_path)
        cnn_result = self.cnn_extractor.process_video(target_path)

        combined_record = FusionFeatureAssembler.from_extractor_results(
            video_path=target_path,
            label=label,
            blink_result=blink_result,
            headpose_result=headpose_result,
            landmark_result=landmark_result,
            cnn_result=cnn_result,
        )

        return combined_record, {
            "blink": blink_result,
            "headpose": headpose_result,
            "landmarks": landmark_result,
            "cnn": cnn_result,
        }

    def predict_video(
        self,
        video_path: Union[str, Path],
        include_features: bool = False,
        include_module_results: bool = False,
    ) -> Dict[str, Any]:
        feature_record, module_results = self.extract_features(video_path)

        print("\n========== DEBUG OUTPUT ==========")
        print("\n--- Feature Record ---")
        for k, v in feature_record.items():
            print(f"{k}: {v}")

        print("\n--- Module Results ---")
        for module, result in module_results.items():
            print(f"\n[{module.upper()}]")
            for k, v in result.items():
                print(f"{k}: {v}")

        print("=================================\n")
        cnn_score = float(feature_record.get("cnn_score", 0.5))
        if not 0.0 <= cnn_score <= 1.0:
            cnn_score = 0.5

        self._ensure_fusion_classifier()
        if self.fusion_classifier is not None:
            fusion_result = self.fusion_classifier.predict(feature_record)
            final_score = float(fusion_result["final_score"])
            prediction = str(fusion_result["prediction"])
        else:
            final_score = cnn_score
            prediction = "Fake" if final_score >= 0.5 else "Real"

        final_score = float(max(0.0, min(1.0, final_score)))

        response: Dict[str, Any] = {
            "cnn_score": cnn_score,
            "final_score": final_score,
            "prediction": prediction,
        }

        if include_features:
            response["features"] = feature_record
        if include_module_results:
            response["module_results"] = module_results

        return response

    def train_fusion_model(
        self,
        training_csv_path: Optional[Union[str, Path]] = None,
        output_model_path: Optional[Union[str, Path]] = None,
    ) -> Dict[str, Any]:
        csv_path = Path(training_csv_path) if training_csv_path is not None else self.training_csv_path
        if csv_path is None or not csv_path.exists():
            raise FileNotFoundError(f"Training CSV not found: {csv_path}")

        classifier = DeepfakeFusionClassifier(model_type=self.fusion_model_type)
        summary = classifier.fit_from_csv(csv_path)
        self.fusion_classifier = classifier

        if output_model_path is not None:
            classifier.save(output_model_path)

        return summary

    def process_video(
        self,
        video_path: Union[str, Path],
        include_features: bool = False,
        include_module_results: bool = False,
    ) -> Dict[str, Any]:
        return self.predict_video(
            video_path=video_path,
            include_features=include_features,
            include_module_results=include_module_results,
        )


if __name__ == "__main__":
    default_video = (
        r"D:\New_folder\deepfake_detection\deepfake_project\data\real\01__hugging_happy.mp4"
    )

    parser = argparse.ArgumentParser(description="Run the full deepfake detection pipeline on a video.")
    parser.add_argument("input_path", nargs="?", default=str(default_video))
    parser.add_argument("--cnn-weights", type=str, default=None, help="Optional fine-tuned CNN checkpoint.")
    parser.add_argument("--no-cnn-pretrained", action="store_true", help="Disable ImageNet backbone weights.")
    parser.add_argument("--fusion-model", type=str, default=None, help="Optional saved fusion model path.")
    parser.add_argument("--train-csv", type=str, default=None, help="Optional dataset CSV used to auto-fit fusion.")
    parser.add_argument("--include-features", action="store_true", help="Include fused feature payload in output.")
    parser.add_argument("--include-module-results", action="store_true", help="Include raw module outputs in output.")
    args = parser.parse_args()

    pipeline = DeepfakeDetectionPipeline(
        cnn_weights_path=args.cnn_weights,
        cnn_use_pretrained=not args.no_cnn_pretrained,
        fusion_model_path=args.fusion_model,
        training_csv_path=args.train_csv,
    )
    output = pipeline.predict_video(
        args.input_path,
        include_features=args.include_features,
        include_module_results=args.include_module_results,
    )
    print(json.dumps(output, indent=2), flush=True)
