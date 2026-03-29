import os
import sys
import cv2
import joblib
import numpy as np
import pandas as pd
from pathlib import Path

# Add the feature_extraction directory to sys.path to allow imports
current_dir = Path(__file__).resolve().parent
feature_extraction_dir = current_dir / "feature_extraction"
sys.path.append(str(feature_extraction_dir))

from blink_test import BlinkDetector
from headpose_test import RobustHeadPoseEstimator

class DeepfakeDetector:
    def __init__(self, model_path=None, scaler_path=None):
        """
        Initialize the DeepfakeDetector with a trained model and scaler.
        """
        if model_path is None:
            model_path = current_dir / "models" / "detector_model.pkl"
        if scaler_path is None:
            scaler_path = current_dir / "models" / "scaler.pkl"
            
        self.model = joblib.load(model_path)
        self.scaler = joblib.load(scaler_path)
        
        # Define features used during training
        self.feature_names = [
            'total_blinks', 'blink_rate', 'avg_ear', 'ear_variance',
            'yaw_variance', 'pitch_variance', 'yaw_angular_velocity', 
            'pitch_angular_velocity', 'mean_yaw', 'mean_pitch'
        ]
        
    def extract_features(self, video_path):
        """
        Extract features from a video file using the same logic as build_dataset.py.
        """
        video_path = Path(video_path)
        
        # Initialize detectors with optimized settings for inference
        blink_detector = BlinkDetector(static_image_mode=False, frame_skip=2)
        headpose_estimator = RobustHeadPoseEstimator(static_image_mode=False, frame_skip=2)
        
        # Process video
        blink_result = blink_detector.process_video(video_path)
        headpose_result = headpose_estimator.process_video(video_path)
        
        if blink_result is None or headpose_result is None:
            return None
            
        # Combine into a single feature dictionary
        features = {
            'total_blinks': blink_result.get('total_blinks', 0),
            'blink_rate': blink_result.get('blink_rate', 0.0),
            'avg_ear': blink_result.get('avg_ear', 0.0),
            'ear_variance': blink_result.get('ear_variance', 0.0),
            'yaw_variance': headpose_result.get('yaw_variance', 0.0),
            'pitch_variance': headpose_result.get('pitch_variance', 0.0),
            'yaw_angular_velocity': headpose_result.get('yaw_angular_velocity', 0.0),
            'pitch_angular_velocity': headpose_result.get('pitch_angular_velocity', 0.0),
            'mean_yaw': headpose_result.get('mean_yaw', 0.0),
            'mean_pitch': headpose_result.get('mean_pitch', 0.0)
        }
        
        return features

    def predict(self, video_path):
        """
        Extract features and predict if the video is real or fake.
        
        Returns:
            dict: result containing label, confidence, and raw features
        """
        features_dict = self.extract_features(video_path)
        
        if features_dict is None:
            return {
                "success": False,
                "error": "Failed to extract features from video. Ensure a face is clearly visible."
            }
            
        # Prepare for prediction
        X = pd.DataFrame([features_dict])[self.feature_names]
        X_scaled = self.scaler.transform(X)
        
        # Get probability
        probs = self.model.predict_proba(X_scaled)[0]
        # label mapping (0: real, 1: fake)
        prediction = int(self.model.predict(X_scaled)[0])
        label = "fake" if prediction == 1 else "real"
        confidence = float(probs[prediction])
        
        return {
            "success": True,
            "label": label,
            "confidence": confidence,
            "prediction": prediction,
            "probabilities": {
                "real": float(probs[0]),
                "fake": float(probs[1])
            },
            "features": features_dict
        }

if __name__ == "__main__":
    # Quick test if run directly
    if len(sys.argv) > 1:
        video_path = sys.argv[1]
        detector = DeepfakeDetector()
        print(f"Analyzing {video_path}...")
        result = detector.predict(video_path)
        print(result)
    else:
        print("Usage: python detector.py <video_path>")
