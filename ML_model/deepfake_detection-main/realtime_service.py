"""
Real-time Deepfake Detection Microservice for Zoom Clone
Processes video frames and returns deepfake probability using custom ML model.
"""

import os
import sys
import uuid
import base64
import io
import cv2
import numpy as np
import pandas as pd
from collections import deque
from datetime import datetime
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS

# Add project directory to sys.path
project_root = Path(__file__).resolve().parent
sys.path.insert(0, str(project_root / "deepfake_project"))

from detector import DeepfakeDetector

app = Flask(__name__)
CORS(app)

# Initialize detector
try:
    detector = DeepfakeDetector()
    print("Deepfake detector initialized successfully.")
except Exception as e:
    print(f"Error initializing detector: {e}")
    detector = None

# Global session storage for real-time analysis sessions
# Each meeting/participant gets their own buffer
analysis_sessions = {}

class RealTimeAnalyzer:
    """
    Real-time frame analyzer that buffers frames and computes temporal features
    similar to the video-based detector but for live streams.
    """
    
    def __init__(self, session_id, buffer_size=150):  # ~5 seconds at 30fps
        self.session_id = session_id
        self.buffer_size = buffer_size
        self.frames_buffer = deque(maxlen=buffer_size)
        self.ears_history = deque(maxlen=buffer_size)
        self.head_poses_history = deque(maxlen=buffer_size)
        self.timestamps = deque(maxlen=buffer_size)
        self.total_blinks = 0
        self.last_blink_time = None
        self.ear_threshold = 0.2
        self.frame_count = 0
        
        # MediaPipe face mesh for real-time processing
        import mediapipe as mp
        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            static_image_mode=False,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        
        # Eye landmarks indices
        self.LEFT_EYE = [362, 385, 387, 263, 373, 380]
        self.RIGHT_EYE = [33, 160, 158, 133, 153, 144]
        
        # Head pose 3D model points
        self.model_points = np.array([
            [0.0, 0.0, 0.0],           # Nose tip
            [0.0, -330.0, -65.0],      # Chin
            [-225.0, 170.0, -135.0],   # Left eye left corner
            [225.0, 170.0, -135.0],    # Right eye right corner
            [-150.0, -150.0, -125.0],  # Left mouth corner
            [150.0, -150.0, -125.0]    # Right mouth corner
        ], dtype=np.float32)
        
    def get_distance(self, p1, p2):
        return np.linalg.norm(np.array(p1) - np.array(p2))
    
    def calculate_ear(self, landmarks, eye_indices):
        """Calculate Eye Aspect Ratio"""
        points = [landmarks[i] for i in eye_indices]
        p1, p2, p3, p4, p5, p6 = points
        
        vert1 = self.get_distance(p2, p6)
        vert2 = self.get_distance(p3, p5)
        horiz = self.get_distance(p1, p4)
        
        if horiz == 0:
            return 0
        return (vert1 + vert2) / (2.0 * horiz)
    
    def estimate_head_pose(self, landmarks, image_shape):
        """Estimate head pose (yaw, pitch, roll) from landmarks"""
        h, w = image_shape[:2]
        
        # Get 2D image points
        image_points = np.array([
            landmarks[1],      # Nose tip
            landmarks[152],    # Chin
            landmarks[33],     # Left eye left corner
            landmarks[263],    # Right eye right corner
            landmarks[61],     # Left mouth corner
            landmarks[291]     # Right mouth corner
        ], dtype=np.float32)
        
        # Convert to pixel coordinates
        image_points[:, 0] *= w
        image_points[:, 1] *= h
        
        # Camera matrix
        focal_length = w
        center = (w / 2, h / 2)
        camera_matrix = np.array([
            [focal_length, 0, center[0]],
            [0, focal_length, center[1]],
            [0, 0, 1]
        ], dtype=np.float32)
        
        dist_coeffs = np.zeros((4, 1))
        
        # Solve PnP
        success, rotation_vector, translation_vector = cv2.solvePnP(
            self.model_points, image_points, camera_matrix, dist_coeffs
        )
        
        if not success:
            return None, None, None
        
        # Convert rotation vector to rotation matrix
        rotation_matrix, _ = cv2.Rodrigues(rotation_vector)
        
        # Get angles
        pitch = np.degrees(np.arctan2(rotation_matrix[2, 1], rotation_matrix[2, 2]))
        yaw = np.degrees(np.arctan2(-rotation_matrix[2, 0], 
                                   np.sqrt(rotation_matrix[2, 1]**2 + rotation_matrix[2, 2]**2)))
        roll = np.degrees(np.arctan2(rotation_matrix[1, 0], rotation_matrix[0, 0]))
        
        return yaw, pitch, roll
    
    def process_frame(self, frame):
        """Process a single frame and extract features"""
        self.frame_count += 1
        timestamp = datetime.now().timestamp()
        
        # Convert BGR to RGB
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(rgb_frame)
        
        if not results.multi_face_landmarks:
            return None
        
        landmarks = results.multi_face_landmarks[0].landmark
        
        # Calculate EAR
        left_ear = self.calculate_ear(landmarks, self.LEFT_EYE)
        right_ear = self.calculate_ear(landmarks, self.RIGHT_EYE)
        avg_ear = (left_ear + right_ear) / 2.0
        
        # Detect blink
        blink_detected = False
        if avg_ear < self.ear_threshold:
            if self.last_blink_time is None or (timestamp - self.last_blink_time) > 0.3:
                blink_detected = True
                self.total_blinks += 1
                self.last_blink_time = timestamp
        
        # Estimate head pose
        yaw, pitch, roll = self.estimate_head_pose(landmarks, frame.shape)
        
        # Store in history
        self.ears_history.append(avg_ear)
        self.head_poses_history.append((yaw, pitch, roll))
        self.timestamps.append(timestamp)
        
        return {
            'ear': avg_ear,
            'blink_detected': blink_detected,
            'yaw': yaw,
            'pitch': pitch,
            'roll': roll
        }
    
    def compute_features(self):
        """Compute features from buffered frames for ML prediction"""
        if len(self.ears_history) < 30:  # Need at least 1 second of data
            return None
        
        # Calculate blink rate (blinks per minute)
        time_span = self.timestamps[-1] - self.timestamps[0] if len(self.timestamps) > 1 else 1
        blink_rate = (self.total_blinks / time_span) * 60 if time_span > 0 else 0
        
        # EAR statistics
        ears_array = np.array(list(self.ears_history))
        avg_ear = np.mean(ears_array)
        ear_variance = np.var(ears_array)
        
        # Head pose statistics
        yaws = [p[0] for p in self.head_poses_history if p[0] is not None]
        pitches = [p[1] for p in self.head_poses_history if p[1] is not None]
        
        if len(yaws) < 2:
            return None
        
        yaw_variance = np.var(yaws)
        pitch_variance = np.var(pitches)
        
        # Angular velocity (rate of change)
        yaw_velocities = [abs(yaws[i] - yaws[i-1]) for i in range(1, len(yaws))]
        pitch_velocities = [abs(pitches[i] - pitches[i-1]) for i in range(1, len(pitches))]
        
        yaw_angular_velocity = np.mean(yaw_velocities) if yaw_velocities else 0
        pitch_angular_velocity = np.mean(pitch_velocities) if pitch_velocities else 0
        
        mean_yaw = np.mean(yaws)
        mean_pitch = np.mean(pitches)
        
        return {
            'total_blinks': self.total_blinks,
            'blink_rate': blink_rate,
            'avg_ear': avg_ear,
            'ear_variance': ear_variance,
            'yaw_variance': yaw_variance,
            'pitch_variance': pitch_variance,
            'yaw_angular_velocity': yaw_angular_velocity,
            'pitch_angular_velocity': pitch_angular_velocity,
            'mean_yaw': mean_yaw,
            'mean_pitch': mean_pitch
        }
    
    def predict(self):
        """Run prediction using current feature buffer"""
        features = self.compute_features()
        if features is None:
            return None
        
        # Prepare for prediction
        feature_names = [
            'total_blinks', 'blink_rate', 'avg_ear', 'ear_variance',
            'yaw_variance', 'pitch_variance', 'yaw_angular_velocity', 
            'pitch_angular_velocity', 'mean_yaw', 'mean_pitch'
        ]
        
        X = pd.DataFrame([features])[feature_names]
        X_scaled = detector.scaler.transform(X)
        
        # Get probability
        probs = detector.model.predict_proba(X_scaled)[0]
        prediction = int(detector.model.predict(X_scaled)[0])
        label = "fake" if prediction == 1 else "real"
        confidence = float(probs[prediction])
        
        return {
            'label': label,
            'confidence': confidence,
            'prediction': prediction,
            'probabilities': {
                'real': float(probs[0]),
                'fake': float(probs[1])
            },
            'features': features
        }


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "model_loaded": detector is not None
    })


@app.route('/analyze-frame', methods=['POST'])
def analyze_frame():
    """
    Analyze a single video frame for deepfake detection.
    Expects: {
        "session_id": "unique_session_id",
        "image_base64": "base64_encoded_jpeg",
        "meeting_id": "optional_meeting_id",
        "participant_id": "optional_participant_id"
    }
    """
    if detector is None:
        return jsonify({
            "success": False,
            "error": "Detector not initialized"
        }), 500
    
    try:
        data = request.get_json()
        
        if not data or 'image_base64' not in data:
            return jsonify({
                "success": False,
                "error": "image_base64 is required"
            }), 400
        
        session_id = data.get('session_id', 'default')
        
        # Get or create analyzer session
        if session_id not in analysis_sessions:
            analysis_sessions[session_id] = RealTimeAnalyzer(session_id)
            print(f"Created new analysis session: {session_id}")
        
        analyzer = analysis_sessions[session_id]
        
        # Decode base64 image
        image_base64 = data['image_base64']
        # Remove data URL prefix if present
        if ',' in image_base64:
            image_base64 = image_base64.split(',')[1]
        
        image_bytes = base64.b64decode(image_base64)
        nparr = np.frombuffer(image_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None:
            return jsonify({
                "success": False,
                "error": "Invalid image data"
            }), 400
        
        # Process frame
        frame_result = analyzer.process_frame(frame)
        
        if frame_result is None:
            return jsonify({
                "success": True,
                "face_detected": False,
                "message": "No face detected in frame"
            })
        
        # Run prediction if we have enough data
        prediction_result = analyzer.predict()
        
        response = {
            "success": True,
            "face_detected": True,
            "session_id": session_id,
            "frame_count": analyzer.frame_count,
            "frame_metrics": {
                "ear": frame_result['ear'],
                "blink_detected": frame_result['blink_detected'],
                "yaw": frame_result['yaw'],
                "pitch": frame_result['pitch']
            }
        }
        
        if prediction_result:
            response["prediction"] = {
                "label": prediction_result['label'],
                "confidence": prediction_result['confidence'],
                "probabilities": prediction_result['probabilities']
            }
            response["trust_score"] = int(prediction_result['probabilities']['real'] * 100)
            response["is_likely_fake"] = prediction_result['label'] == 'fake' and prediction_result['confidence'] > 0.6
        else:
            # Not enough data yet
            response["prediction"] = None
            response["trust_score"] = 50  # Neutral
            response["is_likely_fake"] = False
            response["message"] = "Collecting data... Need more frames for analysis"
        
        return jsonify(response)
        
    except Exception as e:
        print(f"Error in analyze_frame: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route('/reset-session', methods=['POST'])
def reset_session():
    """Reset an analysis session (e.g., when a user leaves a meeting)"""
    data = request.get_json()
    session_id = data.get('session_id')
    
    if session_id and session_id in analysis_sessions:
        del analysis_sessions[session_id]
        return jsonify({"success": True, "message": f"Session {session_id} reset"})
    
    return jsonify({"success": False, "error": "Session not found"}), 404


@app.route('/predict-video', methods=['POST'])
def predict_video():
    """
    Original video file analysis endpoint (for batch processing)
    """
    if detector is None:
        return jsonify({"success": False, "error": "Detector not initialized"}), 500
    
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "No file part"}), 400
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({"success": False, "error": "No selected file"}), 400
    
    # Save uploaded file temporarily
    upload_folder = Path('/tmp/deepfake_uploads')
    upload_folder.mkdir(parents=True, exist_ok=True)
    
    filename = f"{uuid.uuid4()}_{file.filename}"
    filepath = upload_folder / filename
    file.save(str(filepath))
    
    try:
        result = detector.predict(filepath)
        
        # Cleanup
        os.remove(filepath)
        
        return jsonify(result)
    except Exception as e:
        if filepath.exists():
            os.remove(filepath)
        return jsonify({"success": False, "error": str(e)}), 500


# Cleanup old sessions periodically
@app.route('/cleanup-sessions', methods=['POST'])
def cleanup_sessions():
    """Remove inactive sessions (call periodically)"""
    current_time = datetime.now().timestamp()
    removed = []
    
    for session_id, analyzer in list(analysis_sessions.items()):
        # Remove sessions inactive for more than 10 minutes
        if analyzer.timestamps and (current_time - analyzer.timestamps[-1]) > 600:
            del analysis_sessions[session_id]
            removed.append(session_id)
    
    return jsonify({"success": True, "removed_sessions": removed})


if __name__ == '__main__':
    # Run on port 5001 to avoid conflict with main app
    app.run(host='0.0.0.0', port=5001, debug=False)
