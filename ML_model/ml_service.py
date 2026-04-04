"""
Real-time Deepfake Detection ML Service for Zoom-Clone Integration
Analyzes video frames and returns real/fake predictions.
"""

from flask import Flask, request, jsonify
import os
import sys
import base64
import tempfile
import numpy as np
import cv2
from pathlib import Path
from collections import defaultdict
from datetime import datetime
import threading
import json

# Add the ML model path for imports
ML_MODEL_PATH = Path(__file__).parent.parent / "ML_model" / "deepfake_detection" / "deepfake_project" / "feature_extraction"
if not ML_MODEL_PATH.exists():
    # Fallback to the original ML Model folder
    ML_MODEL_PATH = Path(r"d:\2)college folder\4th semister\EDI\ML Model\deepfake_detection-Hariom_backend\deepfake_detection\deepfake_project\feature_extraction")

sys.path.insert(0, str(ML_MODEL_PATH))

app = Flask(__name__)

# Session storage for continuous analysis
sessions = defaultdict(lambda: {
    "frames": [],
    "predictions": [],
    "frame_count": 0,
    "blink_count": 0,
    "last_ear": 0.3,
    "ear_history": [],
    "headpose_history": [],
    "features_history": [],
    "created_at": datetime.now().isoformat(),
    "last_analysis": None
})
sessions_lock = threading.Lock()

# Initialize pipeline lazily
pipeline = None
face_cascade = None

def get_face_cascade():
    global face_cascade
    if face_cascade is None:
        face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    return face_cascade

def get_pipeline():
    """Lazy initialization of the ML pipeline"""
    global pipeline
    if pipeline is None:
        try:
            # Try to import and initialize the pipeline
            from deepfake_pipeline import DeepfakeDetectionPipeline
            
            # Look for fusion model
            fusion_model_path = ML_MODEL_PATH / "deepfake_xgb_model.joblib"
            
            pipeline = DeepfakeDetectionPipeline(
                fusion_model_path=str(fusion_model_path) if fusion_model_path.exists() else None,
                cnn_backbone="resnet50",
                cnn_use_pretrained=True,
                blink_frame_skip=1,
                headpose_frame_skip=1,
                landmark_frame_skip=1,
                cnn_frame_skip=1
            )
            print("[ML Service] DeepfakeDetectionPipeline initialized successfully")
        except Exception as e:
            print(f"[ML Service] Warning: Could not initialize full pipeline: {e}")
            print("[ML Service] Will use fallback CNN-based detection")
            pipeline = "fallback"  # Mark as fallback mode
    return pipeline

def detect_face_and_extract_features(image: np.ndarray) -> dict:
    """
    Detect face and extract basic features from a single frame.
    Returns face detection results and basic metrics.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    faces = get_face_cascade().detectMultiScale(gray, 1.1, 4)
    
    if len(faces) == 0:
        return {"face_detected": False}
    
    # Get the largest face
    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
    face_roi = gray[y:y+h, x:x+w]
    
    # Calculate basic metrics
    face_size = w * h
    image_size = image.shape[0] * image.shape[1]
    face_ratio = face_size / image_size if image_size > 0 else 0
    
    # Calculate image quality metrics
    brightness = np.mean(gray)
    contrast = np.std(gray)
    
    # Face sharpness (Laplacian variance)
    face_blur = cv2.Laplacian(face_roi, cv2.CV_64F).var()
    
    return {
        "face_detected": True,
        "face_bbox": {"x": int(x), "y": int(y), "w": int(w), "h": int(h)},
        "face_ratio": float(face_ratio),
        "brightness": float(brightness),
        "contrast": float(contrast),
        "face_blur": float(face_blur),
        "face_size": int(face_size)
    }

def analyze_single_frame(image: np.ndarray, session_data: dict) -> dict:
    """
    Analyze a single frame and return prediction results.
    Uses accumulated session data for better accuracy.
    """
    face_features = detect_face_and_extract_features(image)
    
    if not face_features["face_detected"]:
        return {
            "face_detected": False,
            "prediction": {"label": "unknown", "confidence": 0},
            "trust_score": 50,
            "is_likely_fake": False
        }
    
    # Try to use the full ML pipeline if available
    try:
        pipe = get_pipeline()
        
        if pipe == "fallback":
            # Use simple heuristics for fallback mode
            return fallback_analysis(image, face_features, session_data)
        
        # For the full pipeline, we need to create a short video clip
        # Since the pipeline expects video, we'll use accumulated frames
        session_data["frames"].append(image)
        session_data["frame_count"] += 1
        
        # Keep only last 30 frames (1 second at 30fps)
        if len(session_data["frames"]) > 30:
            session_data["frames"] = session_data["frames"][-30:]
        
        # Only run full analysis when we have enough frames
        if len(session_data["frames"]) >= 10:
            # Create temporary video file
            with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as tmp:
                temp_path = tmp.name
            
            try:
                # Write frames to video
                h, w = session_data["frames"][0].shape[:2]
                fourcc = cv2.VideoWriter_fourcc(*'mp4v')
                out = cv2.VideoWriter(temp_path, fourcc, 10, (w, h))
                
                for frame in session_data["frames"]:
                    out.write(frame)
                out.release()
                
                # Run pipeline analysis
                result = pipe.predict_video(temp_path, include_features=True)
                
                final_score = float(result.get("final_score", 0.5))
                prediction = "Fake" if final_score >= 0.5 else "Real"
                confidence = final_score if prediction == "Fake" else 1 - final_score
                
                # Calculate trust score (0-100, higher is more trustworthy)
                trust_score = (1 - final_score) * 100
                
                session_data["last_analysis"] = {
                    "timestamp": datetime.now().isoformat(),
                    "prediction": prediction,
                    "score": final_score
                }
                
                # Extract features from the result if available
                features = result.get("features", {})
                
                return {
                    "face_detected": True,
                    "prediction": {
                        "label": prediction.lower(),
                        "confidence": round(confidence, 4),
                        "probabilities": {
                            "real": round(1 - final_score, 4),
                            "fake": round(final_score, 4)
                        },
                        "features": {
                            "blink_rate": float(features.get("blink_rate", 0)),
                            "interval_cv": float(features.get("interval_cv", 0)),
                            "yaw_variance": float(features.get("yaw_variance", 0)),
                            "pitch_variance": float(features.get("pitch_variance", 0)),
                            "roll_variance": float(features.get("roll_variance", 0)),
                            "cnn_score": float(features.get("cnn_score", 0.5)),
                            "total_blinks": int(features.get("total_blinks", 0))
                        } if features else None,
                        "frame_count": session_data["frame_count"]
                    },
                    "trust_score": round(trust_score, 2),
                    "is_likely_fake": final_score >= 0.5,
                    "frame_metrics": {
                        "ear": 0.25,  # Default EAR value
                        "blink_detected": False,
                        "face_quality": face_features
                    }
                }
                
            except Exception as e:
                print(f"[ML Service] Pipeline analysis error: {e}")
                return fallback_analysis(image, face_features, session_data)
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
        else:
            # Not enough frames yet, return initial status
            return {
                "face_detected": True,
                "prediction": None,
                "trust_score": 50,
                "is_likely_fake": False,
                "frame_metrics": {
                    "ear": 0.25,
                    "blink_detected": False,
                    "face_quality": face_features,
                    "initializing": True,
                    "frames_collected": len(session_data["frames"])
                }
            }
            
    except Exception as e:
        print(f"[ML Service] Analysis error: {e}")
        return fallback_analysis(image, face_features, session_data)

def fallback_analysis(image: np.ndarray, face_features: dict, session_data: dict) -> dict:
    """
    Fallback analysis using simple heuristics when ML pipeline is unavailable.
    """
    # Simple heuristic based on face quality metrics
    blur_score = min(1.0, face_features.get("face_blur", 1000) / 1000)
    contrast_score = min(1.0, face_features.get("contrast", 50) / 100)
    
    # Deepfakes often have certain artifacts
    suspicious_score = 0.5
    
    # Low blur can indicate synthetic face
    if face_features.get("face_blur", 1000) < 100:
        suspicious_score += 0.2
    
    # Unusual face ratios
    face_ratio = face_features.get("face_ratio", 0.1)
    if face_ratio < 0.05 or face_ratio > 0.8:
        suspicious_score += 0.1
    
    suspicious_score = min(1.0, suspicious_score)
    
    prediction = "Fake" if suspicious_score >= 0.5 else "Real"
    confidence = suspicious_score if prediction == "Fake" else 1 - suspicious_score
    trust_score = (1 - suspicious_score) * 100
    
    return {
        "face_detected": True,
        "prediction": {
            "label": prediction.lower(),
            "confidence": round(confidence, 4),
            "probabilities": {
                "real": round(1 - suspicious_score, 4),
                "fake": round(suspicious_score, 4)
            },
            "features": {
                "mode": "fallback",
                "blur_score": round(blur_score, 4),
                "contrast_score": round(contrast_score, 4)
            },
            "frame_count": session_data["frame_count"]
        },
        "trust_score": round(trust_score, 2),
        "is_likely_fake": suspicious_score >= 0.5,
        "frame_metrics": {
            "ear": 0.25,
            "blink_detected": False,
            "face_quality": face_features
        }
    }

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        pipe = get_pipeline()
        return jsonify({
            "status": "healthy",
            "pipeline": "full" if pipe != "fallback" else "fallback",
            "sessions_active": len(sessions)
        })
    except Exception as e:
        return jsonify({
            "status": "degraded",
            "error": str(e),
            "sessions_active": len(sessions)
        }), 503

@app.route('/analyze-frame', methods=['POST'])
def analyze_frame():
    """
    Analyze a single frame for deepfake detection.
    Expects: { "session_id": str, "image_base64": str, "meeting_id": str, "participant_id": str }
    Returns: Prediction results with confidence scores
    """
    try:
        data = request.get_json()
        
        if not data or 'image_base64' not in data:
            return jsonify({
                "success": False,
                "error": "image_base64 is required"
            }), 400
        
        session_id = data.get('session_id', 'default')
        image_base64 = data['image_base64']
        
        # Remove data URL prefix if present
        if ',' in image_base64:
            image_base64 = image_base64.split(',')[1]
        
        # Decode base64 image
        try:
            image_bytes = base64.b64decode(image_base64)
            nparr = np.frombuffer(image_bytes, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if image is None:
                return jsonify({
                    "success": False,
                    "error": "Invalid image data"
                }), 400
        except Exception as e:
            return jsonify({
                "success": False,
                "error": f"Image decoding failed: {str(e)}"
            }), 400
        
        # Get or create session
        with sessions_lock:
            session_data = sessions[session_id]
        
        # Analyze frame
        result = analyze_single_frame(image, session_data)
        
        return jsonify({
            "success": True,
            **result
        })
        
    except Exception as e:
        print(f"[ML Service] Error in analyze_frame: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/reset-session', methods=['POST'])
def reset_session():
    """
    Reset analysis session for a participant.
    Expects: { "session_id": str }
    """
    try:
        data = request.get_json() or {}
        session_id = data.get('session_id', 'default')
        
        with sessions_lock:
            if session_id in sessions:
                del sessions[session_id]
        
        return jsonify({
            "success": True,
            "message": f"Session {session_id} reset successfully"
        })
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/session-stats/<session_id>', methods=['GET'])
def get_session_stats(session_id):
    """Get statistics for a specific session"""
    with sessions_lock:
        if session_id not in sessions:
            return jsonify({"error": "Session not found"}), 404
        
        session_data = sessions[session_id]
        return jsonify({
            "session_id": session_id,
            "frame_count": session_data["frame_count"],
            "created_at": session_data["created_at"],
            "last_analysis": session_data["last_analysis"]
        })

# Cleanup old sessions periodically
def cleanup_old_sessions():
    """Remove sessions older than 1 hour"""
    with sessions_lock:
        current_time = datetime.now()
        to_remove = []
        for session_id, data in sessions.items():
            created = datetime.fromisoformat(data["created_at"])
            if (current_time - created).total_seconds() > 3600:  # 1 hour
                to_remove.append(session_id)
        
        for session_id in to_remove:
            del sessions[session_id]
            print(f"[ML Service] Cleaned up old session: {session_id}")

@app.before_request
def before_request():
    """Periodic cleanup check"""
    # Simple throttling - only check every ~100 requests
    import random
    if random.random() < 0.01:  # 1% chance
        cleanup_old_sessions()

if __name__ == '__main__':
    print("=" * 60)
    print("Deepfake Detection ML Service")
    print("=" * 60)
    print(f"ML Model Path: {ML_MODEL_PATH}")
    print(f"Model files exist: {list(ML_MODEL_PATH.glob('*.joblib'))}")
    print("=" * 60)
    
    # Try to initialize pipeline on startup
    try:
        pipe = get_pipeline()
        print(f"[ML Service] Pipeline initialized: {'Full' if pipe != 'fallback' else 'Fallback'} mode")
    except Exception as e:
        print(f"[ML Service] Warning: Pipeline initialization failed: {e}")
    
    print("[ML Service] Starting server on http://0.0.0.0:5001")
    
    app.run(host='0.0.0.0', port=5001, debug=False, threaded=True)
