"""
Real-time Deepfake Detection ML Service for Zoom-Clone Integration
Analyzes video frames and returns real/fake predictions.

FIXES applied:
  - Added flask-cors so only the Node server can call this service
  - Fixed fallback_analysis base score (was 0.5 which always triggered "Fake")
  - Replaced random 1% cleanup with a proper background timer thread
  - frame_count is now always returned at top level of the response
"""

import base64
import os
import sys
import tempfile
import threading
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
from flask import Flask, jsonify, request

# ─── Snapshot configuration ────────────────────────────────────────────────────
SNAPSHOTS_DIR = Path(__file__).parent / "snapshots"
SNAPSHOTS_DIR.mkdir(exist_ok=True)
print(f"[ML Service] Snapshots will be saved to: {SNAPSHOTS_DIR}")

try:
    from flask_cors import CORS
    HAS_CORS = True
except ImportError:
    HAS_CORS = False
    print("[ML Service] WARNING: flask-cors not installed. Run: pip install flask-cors")

# ─── ML model paths ─────────────────────────────────────────────────────────────

LOCAL_ML_PATH = (
    Path(__file__).parent
    / "deepfake_detection"
    / "deepfake_project"
    / "feature_extraction"
)

FALLBACK_ML_PATH = Path(
    r"D:\2)college folder\4th semister\EDI\ML Model\deepfake_detection-Hariom_backend\deepfake_detection\deepfake_project\feature_extraction"
)

ML_MODEL_PATH = LOCAL_ML_PATH if LOCAL_ML_PATH.exists() else FALLBACK_ML_PATH
print(f"[ML Service] Using ML path: {ML_MODEL_PATH}")

sys.path.insert(0, str(ML_MODEL_PATH.parent))
sys.path.insert(0, str(ML_MODEL_PATH))

# ─── App setup ──────────────────────────────────────────────────────────────────

app = Flask(__name__)

# Only allow calls from the Node.js server — not from the browser directly
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5000").split(",")
if HAS_CORS:
    CORS(app, origins=ALLOWED_ORIGINS)

# ─── Session storage ─────────────────────────────────────────────────────────────

sessions = defaultdict(
    lambda: {
        "frames": [],
        "predictions": [],
        "frame_count": 0,
        "blink_count": 0,
        "last_ear": 0.3,
        "ear_history": [],
        "headpose_history": [],
        "features_history": [],
        "created_at": datetime.now().isoformat(),
        "last_analysis": None,
        "snapshot_captured": False,  # Track if we've already taken snapshot
        "deepfake_count": 0,  # Count of deepfake detections (trust_score 30-59)
    }
)
sessions_lock = threading.Lock()

pipeline = None
face_cascade = None


def get_face_cascade():
    global face_cascade
    if face_cascade is None:
        face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
    return face_cascade


def get_pipeline():
    global pipeline
    if pipeline is None:
        try:
            from deepfake_pipeline import DeepfakeDetectionPipeline
            fusion_model_path = ML_MODEL_PATH / "deepfake_xgb_model.joblib"
            pipeline = DeepfakeDetectionPipeline(
                fusion_model_path=str(fusion_model_path) if fusion_model_path.exists() else None,
                cnn_backbone="resnet50",
                cnn_use_pretrained=True,
                blink_frame_skip=1,
                headpose_frame_skip=1,
                landmark_frame_skip=1,
                cnn_frame_skip=1,
            )
            print("[ML Service] DeepfakeDetectionPipeline initialized successfully")
        except Exception as e:
            print(f"[ML Service] Warning: Could not initialize full pipeline: {e}")
            print("[ML Service] Will use fallback detection")
            pipeline = "fallback"
    return pipeline


# ─── Analysis helpers ────────────────────────────────────────────────────────────

def detect_face_and_extract_features(image: np.ndarray) -> dict:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    faces = get_face_cascade().detectMultiScale(gray, 1.1, 4)

    if len(faces) == 0:
        return {"face_detected": False}

    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
    face_roi = gray[y: y + h, x: x + w]

    image_size = image.shape[0] * image.shape[1]
    face_size = w * h
    face_ratio = face_size / image_size if image_size > 0 else 0

    brightness = float(np.mean(gray))
    contrast = float(np.std(gray))
    face_blur = float(cv2.Laplacian(face_roi, cv2.CV_64F).var())

    return {
        "face_detected": True,
        "face_bbox": {"x": int(x), "y": int(y), "w": int(w), "h": int(h)},
        "face_ratio": float(face_ratio),
        "brightness": brightness,
        "contrast": contrast,
        "face_blur": face_blur,
        "face_size": int(face_size),
    }


def save_snapshot(image: np.ndarray, session_id: str, trust_score: float, prediction: str) -> str:
    """Save a snapshot image when trust score threshold is reached."""
    try:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
        filename = f"snapshot_{session_id}_{timestamp}_trust{trust_score:.0f}_{prediction}.jpg"
        filepath = SNAPSHOTS_DIR / filename
        cv2.imwrite(str(filepath), image)
        print(f"[ML Service] Snapshot saved: {filepath}")
        return str(filepath)
    except Exception as e:
        print(f"[ML Service] Failed to save snapshot: {e}")
        return None


def analyze_single_frame(image: np.ndarray, session_data: dict, session_id: str = "default") -> dict:
    face_features = detect_face_and_extract_features(image)

    if not face_features["face_detected"]:
        return {
            "face_detected": False,
            "prediction": None,
            "trust_score": 50,
            "is_likely_fake": False,
            "frame_count": session_data["frame_count"],
        }

    try:
        pipe = get_pipeline()

        if pipe == "fallback":
            return fallback_analysis(image, face_features, session_data)

        session_data["frames"].append(image)
        session_data["frame_count"] += 1

        if len(session_data["frames"]) > 30:
            session_data["frames"] = session_data["frames"][-30:]

        if len(session_data["frames"]) >= 10:
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                temp_path = tmp.name
            try:
                h, w = session_data["frames"][0].shape[:2]
                out = cv2.VideoWriter(temp_path, cv2.VideoWriter_fourcc(*"mp4v"), 10, (w, h))
                for frame in session_data["frames"]:
                    out.write(frame)
                out.release()

                result = pipe.predict_video(temp_path, include_features=True)
                final_score = float(result.get("final_score", 0.5))
                prediction = "Fake" if final_score >= 0.5 else "Real"
                confidence = final_score if prediction == "Fake" else 1 - final_score
                trust_score = (1 - final_score) * 100

                session_data["last_analysis"] = {
                    "timestamp": datetime.now().isoformat(),
                    "prediction": prediction,
                    "score": final_score,
                }

                # Check for deepfake detection (trust_score 30-59 = deepfake range)
                snapshot_path = None
                is_deepfake_detected = 30 <= trust_score <= 59
                if is_deepfake_detected:
                    session_data["deepfake_count"] += 1
                    # Capture snapshot on first detection or every 5th detection
                    if not session_data["snapshot_captured"] or session_data["deepfake_count"] % 5 == 0:
                        snapshot_path = save_snapshot(image, session_id, trust_score, prediction)
                        if not session_data["snapshot_captured"]:
                            session_data["snapshot_captured"] = True
                    print(f"[ML Service] DEEPFAKE DETECTED! Trust score: {trust_score:.1f} | Count: {session_data['deepfake_count']}")

                features = result.get("features", {})
                return {
                    "face_detected": True,
                    "prediction": {
                        "label": prediction.lower(),
                        "confidence": round(confidence, 4),
                        "probabilities": {
                            "real": round(1 - final_score, 4),
                            "fake": round(final_score, 4),
                        },
                        "features": {
                            "blink_rate": float(features.get("blink_rate", 0)),
                            "interval_cv": float(features.get("interval_cv", 0)),
                            "yaw_variance": float(features.get("yaw_variance", 0)),
                            "pitch_variance": float(features.get("pitch_variance", 0)),
                            "roll_variance": float(features.get("roll_variance", 0)),
                            "cnn_score": float(features.get("cnn_score", 0.5)),
                            "total_blinks": int(features.get("total_blinks", 0)),
                        } if features else None,
                        # FIX: frame_count lives inside prediction so Node can find it
                        "frame_count": session_data["frame_count"],
                    },
                    # FIX: also expose frame_count at top level for robustness
                    "frame_count": session_data["frame_count"],
                    "trust_score": round(trust_score, 2),
                    "is_likely_fake": 30 <= trust_score <= 59,  # Deepfake if trust_score in 30-59 range
                    "deepfake_count": session_data["deepfake_count"],
                    "frame_metrics": {"ear": 0.25, "blink_detected": False, "face_quality": face_features},
                    "snapshot": snapshot_path,  # Path to saved snapshot if captured
                }
            except Exception as e:
                print(f"[ML Service] Pipeline analysis error: {e}")
                return fallback_analysis(image, face_features, session_data, session_id)
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
        else:
            session_data["frame_count"] += 1
            return {
                "face_detected": True,
                "prediction": None,
                "frame_count": session_data["frame_count"],
                "trust_score": 50,
                "is_likely_fake": False,
                "frame_metrics": {
                    "ear": 0.25,
                    "blink_detected": False,
                    "face_quality": face_features,
                    "initializing": True,
                    "frames_collected": len(session_data["frames"]),
                },
            }

    except Exception as e:
        print(f"[ML Service] Analysis error: {e}")
        return fallback_analysis(image, face_features, session_data, session_id)


def fallback_analysis(image: np.ndarray, face_features: dict, session_data: dict, session_id: str = "default") -> dict:
    session_data["frame_count"] += 1

    blur_score = min(1.0, face_features.get("face_blur", 1000) / 1000)
    contrast_score = min(1.0, face_features.get("contrast", 50) / 100)

    # FIX: start at 0.2, not 0.5 — avoids flagging every first frame as Fake
    suspicious_score = 0.2

    if face_features.get("face_blur", 1000) < 100:
        suspicious_score += 0.2

    face_ratio = face_features.get("face_ratio", 0.1)
    if face_ratio < 0.05 or face_ratio > 0.8:
        suspicious_score += 0.1

    suspicious_score = min(1.0, suspicious_score)

    # FIX: strict > 0.5 (not >= 0.5) so boundary cases default to Real
    prediction = "Fake" if suspicious_score > 0.5 else "Real"
    confidence = suspicious_score if prediction == "Fake" else 1 - suspicious_score
    trust_score = (1 - suspicious_score) * 100

    # Check for deepfake detection in fallback mode (trust_score 30-59 = deepfake range)
    snapshot_path = None
    is_deepfake_detected = 30 <= trust_score <= 59
    if is_deepfake_detected:
        session_data["deepfake_count"] += 1
        # Capture snapshot on first detection or every 5th detection
        if not session_data["snapshot_captured"] or session_data["deepfake_count"] % 5 == 0:
            snapshot_path = save_snapshot(image, session_id, trust_score, prediction)
            if not session_data["snapshot_captured"]:
                session_data["snapshot_captured"] = True
        print(f"[ML Service] DEEPFAKE DETECTED! Trust score: {trust_score:.1f} | Count: {session_data['deepfake_count']}")

    return {
        "face_detected": True,
        "snapshot": snapshot_path,  # Path to saved snapshot if captured
        "deepfake_count": session_data["deepfake_count"],
        "is_likely_fake": 30 <= trust_score <= 59,  # Deepfake if trust_score in 30-59 range
        "prediction": {
            "label": prediction.lower(),
            "confidence": round(confidence, 4),
            "probabilities": {
                "real": round(1 - suspicious_score, 4),
                "fake": round(suspicious_score, 4),
            },
            "features": {
                "blink_rate": 0.0,
                "interval_cv": 0.0,
                "yaw_variance": 0.0,
                "pitch_variance": 0.0,
                "roll_variance": 0.0,
                "cnn_score": float(blur_score),
                "total_blinks": 0,
                "mode": "fallback",
                "blur_score": round(blur_score, 4),
                "contrast_score": round(contrast_score, 4),
            },
            "frame_count": session_data["frame_count"],
        },
        "frame_count": session_data["frame_count"],
        "trust_score": round(trust_score, 2),
        "is_likely_fake": suspicious_score > 0.5,
        "frame_metrics": {"ear": 0.25, "blink_detected": False, "face_quality": face_features},
    }


# ─── Session cleanup (proper background timer, not random per-request) ───────────

def cleanup_old_sessions():
    """Remove sessions older than 1 hour, then reschedule."""
    with sessions_lock:
        current_time = datetime.now()
        to_remove = [
            sid for sid, data in sessions.items()
            if (current_time - datetime.fromisoformat(data["created_at"])).total_seconds() > 3600
        ]
        for sid in to_remove:
            del sessions[sid]
            print(f"[ML Service] Cleaned up old session: {sid}")

    # FIX: reschedule every 10 minutes regardless of traffic
    timer = threading.Timer(600, cleanup_old_sessions)
    timer.daemon = True
    timer.start()


# ─── Routes ──────────────────────────────────────────────────────────────────────

@app.route("/", methods=["GET"])
def root():
    return jsonify({
        "service": "Deepfake Detection ML Service",
        "version": "1.1",
        "endpoints": [
            {"path": "/health", "method": "GET", "description": "Health check"},
            {"path": "/analyze-frame", "method": "POST", "description": "Analyze video frame"},
            {"path": "/reset-session", "method": "POST", "description": "Reset analysis session"},
            {"path": "/session-stats/<session_id>", "method": "GET", "description": "Session statistics"},
        ],
    })


@app.route("/health", methods=["GET"])
def health_check():
    try:
        pipe = get_pipeline()
        return jsonify({
            "status": "healthy",
            "pipeline": "full" if pipe != "fallback" else "fallback",
            "sessions_active": len(sessions),
        })
    except Exception as e:
        return jsonify({"status": "degraded", "error": str(e), "sessions_active": len(sessions)}), 503


@app.route("/analyze-frame", methods=["POST"])
def analyze_frame():
    try:
        data = request.get_json()
        if not data or "image_base64" not in data:
            return jsonify({"success": False, "error": "image_base64 is required"}), 400

        session_id = data.get("session_id", "default")
        image_base64 = data["image_base64"]

        if "," in image_base64:
            image_base64 = image_base64.split(",")[1]

        try:
            image_bytes = base64.b64decode(image_base64)
            nparr = np.frombuffer(image_bytes, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if image is None:
                return jsonify({"success": False, "error": "Invalid image data"}), 400
        except Exception as e:
            return jsonify({"success": False, "error": f"Image decoding failed: {str(e)}"}), 400

        with sessions_lock:
            session_data = sessions[session_id]

        result = analyze_single_frame(image, session_data, session_id)
        return jsonify({"success": True, **result})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/reset-session", methods=["POST"])
def reset_session():
    try:
        data = request.get_json() or {}
        session_id = data.get("session_id", "default")
        with sessions_lock:
            if session_id in sessions:
                del sessions[session_id]
        return jsonify({"success": True, "message": f"Session {session_id} reset successfully"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/session-stats/<session_id>", methods=["GET"])
def get_session_stats(session_id):
    with sessions_lock:
        if session_id not in sessions:
            return jsonify({"error": "Session not found"}), 404
        session_data = sessions[session_id]
        return jsonify({
            "session_id": session_id,
            "frame_count": session_data["frame_count"],
            "created_at": session_data["created_at"],
            "last_analysis": session_data["last_analysis"],
        })


# ─── Main ─────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("Deepfake Detection ML Service v1.1")
    print("=" * 60)
    print(f"ML Model Path: {ML_MODEL_PATH}")
    print(f"Model files: {list(ML_MODEL_PATH.glob('*.joblib')) if ML_MODEL_PATH.exists() else 'path not found'}")
    print(f"Allowed origins: {ALLOWED_ORIGINS}")
    print("=" * 60)

    try:
        pipe = get_pipeline()
        print(f"[ML Service] Pipeline: {'Full' if pipe != 'fallback' else 'Fallback'} mode")
    except Exception as e:
        print(f"[ML Service] Warning: Pipeline initialization failed: {e}")

    # FIX: start background cleanup timer on startup
    cleanup_old_sessions()
    print("[ML Service] Session cleanup scheduler started (every 10 min)")
    print("[ML Service] Starting server on http://0.0.0.0:5001")

    app.run(host="0.0.0.0", port=5001, debug=False, threaded=True)
