"""
Compact feature fusion utilities for the deepfake pipeline.

The fusion contract is intentionally limited to 8 ordered numeric features:
blink_rate, interval_cv, yaw_variance, pitch_variance, landmark_jitter,
face_symmetry_mean, cnn_score, and embedding_mean.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Union

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

try:  # pragma: no cover - optional dependency
    from xgboost import XGBClassifier
except ImportError:  # pragma: no cover - optional dependency
    XGBClassifier = None


class FusionFeatureAssembler:
    """Normalise extractor outputs into the compact fusion schema."""

    FEATURE_COLUMNS = [
        "blink_rate",
        "interval_cv",
        "yaw_variance",
        "pitch_variance",
        "landmark_jitter",
        "cnn_score",
        "embedding_mean",
    ]
    METADATA_COLUMNS = ["video_path", "label"]

    @staticmethod
    def _safe_float(value: Any, default: float = np.nan) -> float:
        if value is None:
            return float(default)
        if isinstance(value, bool):
            return float(value)
        try:
            return float(value)
        except (TypeError, ValueError):
            return float(default)

    @classmethod
    def _coerce_embedding(cls, value: Any) -> List[float]:
        if value is None:
            return []
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            try:
                value = json.loads(text)
            except json.JSONDecodeError:
                return []
        if isinstance(value, np.ndarray):
            value = value.tolist()
        if not isinstance(value, (list, tuple)):
            return []
        embedding: List[float] = []
        for item in value:
            number = cls._safe_float(item)
            if np.isfinite(number):
                embedding.append(float(number))
        return embedding

    @classmethod
    def _extract_interval_cv(cls, blink_result: Dict[str, Any]) -> float:
        if "interval_cv" in blink_result:
            return cls._safe_float(blink_result.get("interval_cv"))

        nested = blink_result.get("deepfake_features")
        if isinstance(nested, dict):
            return cls._safe_float(nested.get("interval_cv"))

        return float(np.nan)

    @classmethod
    def _extract_embedding_mean(cls, cnn_result: Dict[str, Any]) -> float:
        direct_value = cls._safe_float(cnn_result.get("embedding_mean"))
        if np.isfinite(direct_value):
            return direct_value

        embedding = cls._coerce_embedding(cnn_result.get("cnn_feature_vector"))
        if embedding:
            return float(np.mean(np.asarray(embedding, dtype=np.float32)))

        cnn_feat_values = []
        for key in sorted(cnn_result.keys()):
            if key.startswith("cnn_feat_"):
                value = cls._safe_float(cnn_result.get(key))
                if np.isfinite(value):
                    cnn_feat_values.append(value)
        if cnn_feat_values:
            return float(np.mean(np.asarray(cnn_feat_values, dtype=np.float32)))

        return float(np.nan)

    @classmethod
    def from_extractor_results(
        cls,
        video_path: Union[str, Path],
        label: Optional[str] = None,
        blink_result: Optional[Dict[str, Any]] = None,
        headpose_result: Optional[Dict[str, Any]] = None,
        landmark_result: Optional[Dict[str, Any]] = None,
        cnn_result: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        blink_result = blink_result or {}
        headpose_result = headpose_result or {}
        landmark_result = landmark_result or {}
        cnn_result = cnn_result or {}

        cnn_score = cls._safe_float(cnn_result.get("cnn_score"), default=0.5)
        if not np.isfinite(cnn_score) or not 0.0 <= cnn_score <= 1.0:
            cnn_score = 0.5

        return {
            "video_path": Path(video_path).name,
            "label": label,
            "blink_rate": cls._safe_float(blink_result.get("blink_rate")),
            "interval_cv": cls._extract_interval_cv(blink_result),
            "yaw_variance": cls._safe_float(headpose_result.get("yaw_variance")),
            "pitch_variance": cls._safe_float(headpose_result.get("pitch_variance")),
            "landmark_jitter": cls._safe_float(landmark_result.get("landmark_jitter")),
            "cnn_score": float(cnn_score),
            "embedding_mean": cls._extract_embedding_mean(cnn_result),
        }

    @classmethod
    def normalise_record(cls, record: Dict[str, Any]) -> Dict[str, Any]:
        row = {
            "video_path": str(record.get("video_path", "")),
            "blink_rate": cls._safe_float(record.get("blink_rate")),
            "interval_cv": cls._extract_interval_cv(record),
            "yaw_variance": cls._safe_float(record.get("yaw_variance")),
            "pitch_variance": cls._safe_float(record.get("pitch_variance")),
            "landmark_jitter": cls._safe_float(record.get("landmark_jitter")),
            "cnn_score": cls._safe_float(record.get("cnn_score"), default=0.5),
            "embedding_mean": cls._extract_embedding_mean(record),
        }
        if "label" in record:
            row["label"] = record.get("label")

        if not np.isfinite(row["cnn_score"]) or not 0.0 <= row["cnn_score"] <= 1.0:
            row["cnn_score"] = 0.5
        return row

    @classmethod
    def tabularize_records(cls, records: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [cls.normalise_record(record) for record in records]

    @classmethod
    def classifier_feature_columns(cls, rows: Sequence[Dict[str, Any]]) -> List[str]:
        return list(cls.FEATURE_COLUMNS) if rows else []

    @staticmethod
    def write_csv(rows: Sequence[Dict[str, Any]], output_path: Union[str, Path]) -> Path:
        rows = list(rows)
        path = Path(output_path)
        if not rows:
            raise ValueError("No rows available to write.")

        fieldnames = list(rows[0].keys())
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for row in rows:
                writer.writerow(row)
        return path

    @staticmethod
    def read_csv(csv_path: Union[str, Path]) -> List[Dict[str, Any]]:
        with Path(csv_path).open("r", newline="", encoding="utf-8") as handle:
            return list(csv.DictReader(handle))


class DeepfakeFusionClassifier:
    """Classical fusion classifier for final real/fake inference."""

    def __init__(
        self,
        model_type: str = "random_forest",
        threshold: float = 0.85,
        random_state: int = 42,
    ):
        self.model_type = model_type.lower().strip()
        self.threshold = float(threshold)
        self.random_state = int(random_state)
        self.pipeline = self._build_pipeline()
        self.feature_columns: List[str] = []

    def _build_estimator(self):
        if self.model_type == "random_forest":
            return RandomForestClassifier(
                n_estimators=300,
                max_depth=None,
                min_samples_leaf=1,
                class_weight="balanced_subsample",
                random_state=self.random_state,
                n_jobs=1,
            )

        if self.model_type == "xgboost":
            if XGBClassifier is None:
                raise RuntimeError("XGBoost is not installed. Use model_type='random_forest' instead.")
            return XGBClassifier(
                n_estimators=350,
                max_depth=5,
                learning_rate=0.05,
                subsample=0.9,
                colsample_bytree=0.9,
                reg_lambda=1.0,
                objective="binary:logistic",
                eval_metric="logloss",
                random_state=self.random_state,
            )

        raise ValueError("model_type must be 'random_forest' or 'xgboost'.")

    def _build_pipeline(self) -> Pipeline:
        return Pipeline(
            [
                ("imputer", SimpleImputer(strategy="median")),
                ("scaler", StandardScaler()),
                ("model", self._build_estimator()),
            ]
        )

    @staticmethod
    def _encode_labels(labels: Sequence[Any]) -> np.ndarray:
        mapping = {
            "real": 0,
            "fake": 1,
            "0": 0,
            "1": 1,
            0: 0,
            1: 1,
        }
        encoded = []
        for value in labels:
            key = value.strip().lower() if isinstance(value, str) else value
            if key not in mapping:
                raise ValueError(f"Unsupported label value: {value!r}")
            encoded.append(mapping[key])
        return np.asarray(encoded, dtype=np.int64)

    def _prepare_rows(
        self,
        records: Union[Dict[str, Any], Sequence[Dict[str, Any]]],
        require_labels: bool,
    ) -> List[Dict[str, Any]]:
        raw_rows = [records] if isinstance(records, dict) else list(records)
        if not raw_rows:
            raise ValueError("No records provided.")

        rows = FusionFeatureAssembler.tabularize_records(raw_rows)
        if require_labels:
            for row in rows:
                if "label" not in row:
                    raise ValueError("Training data must include a 'label' column.")
        return rows

    def _rows_to_matrix(self, rows: Sequence[Dict[str, Any]], feature_columns: Sequence[str]) -> np.ndarray:
        matrix = np.asarray(
            [
                [FusionFeatureAssembler._safe_float(row.get(column)) for column in feature_columns]
                for row in rows
            ],
            dtype=np.float32,
        )
        if matrix.size == 0:
            return matrix

        all_missing_columns = np.all(np.isnan(matrix), axis=0)
        if np.any(all_missing_columns):
            matrix[:, all_missing_columns] = 0.0
        return matrix

    def fit(
        self,
        records: Sequence[Dict[str, Any]],
        label_column: str = "label",
    ) -> Dict[str, Any]:
        rows = self._prepare_rows(records, require_labels=True)
        feature_columns = FusionFeatureAssembler.classifier_feature_columns(rows)
        if not feature_columns:
            raise ValueError("No fusion features are available for training.")

        X = self._rows_to_matrix(rows, feature_columns)
        y = self._encode_labels([row[label_column] for row in rows])

        self.pipeline.fit(X, y)
        self.feature_columns = feature_columns

        return {
            "samples": int(len(rows)),
            "feature_count": int(len(feature_columns)),
            "positive_fraction": float(np.mean(y)) if len(y) else 0.0,
        }

    def fit_from_csv(
        self,
        csv_path: Union[str, Path],
        label_column: str = "label",
    ) -> Dict[str, Any]:
        rows = FusionFeatureAssembler.read_csv(csv_path)
        return self.fit(rows, label_column=label_column)

    def predict_proba(
        self,
        record: Union[Dict[str, Any], Sequence[Dict[str, Any]]],
    ) -> float:
        if not self.feature_columns:
            raise RuntimeError("Fusion classifier is not trained or loaded yet.")

        rows = self._prepare_rows(record, require_labels=False)
        X = self._rows_to_matrix(rows[:1], self.feature_columns)
        return float(self.pipeline.predict_proba(X)[0, 1])

    def predict(
        self,
        record: Union[Dict[str, Any], Sequence[Dict[str, Any]]],
    ) -> Dict[str, Any]:
        probability = self.predict_proba(record)
        return {
            "final_score": probability,
            "prediction": "Fake" if probability >= self.threshold else "Real",
        }

    def save(self, output_path: Union[str, Path]) -> Path:
        path = Path(output_path)
        payload = {
            "model_type": self.model_type,
            "threshold": self.threshold,
            "random_state": self.random_state,
            "feature_columns": self.feature_columns,
            "pipeline": self.pipeline,
        }
        joblib.dump(payload, path)
        return path

    @classmethod
    def load(cls, model_path: Union[str, Path]) -> "DeepfakeFusionClassifier":
        payload = joblib.load(model_path)
        
        # Handle case where model was saved directly (from train_fusion.py)
        if not isinstance(payload, dict):
            # Assume it's the model/pipeline directly
            # Use optimal threshold 0.85 for XGBoost models
            classifier = cls(
                model_type="xgboost",
                threshold=0.85,
                random_state=42,
            )
            classifier.feature_columns = list(FusionFeatureAssembler.FEATURE_COLUMNS)
            classifier.pipeline = payload
            return classifier
        
        # Handle dict payload format (from fusion_classifier.save())
        classifier = cls(
            model_type=payload.get("model_type", "random_forest"),
            threshold=payload.get("threshold", 0.85),
            random_state=payload.get("random_state", 42),
        )
        classifier.feature_columns = list(payload.get("feature_columns", FusionFeatureAssembler.FEATURE_COLUMNS))
        classifier.pipeline = payload["pipeline"]
        return classifier