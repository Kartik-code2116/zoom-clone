# 🤖 ZPPM Deepfake ML Service

Real-time deepfake detection microservice for the ZPPM (Zoom Clone) Platform.

This Python Flask service provides real-time frame analysis using a custom trained ML model to detect deepfakes during live video meetings.

---

## 🏗️ Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   React Client  │──────▶  Node.js Server │──────▶  Python ML Svc  │
│  (Video Frame)  │      │  (Proxy/Auth)    │      │  (ML Analysis)  │
└─────────────────┘      └──────────────────┘      └─────────────────┘
```

**Ports:**
- React Client: `5173`
- Node.js Server: `5000`
- Python ML Service: `5001`

---

## 🚀 Quick Start

### Prerequisites

- Python 3.8+
- pip
- Trained model files (`detector_model.pkl` and `scaler.pkl` in `deepfake_project/models/`)

### 1. Setup Python Environment

```bash
cd ML_model/deepfake_detection-main

# Create virtual environment (recommended)
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Verify Model Files

Ensure your trained model files exist:
```
deepfake_project/
└── models/
    ├── detector_model.pkl    # Your trained classifier
    └── scaler.pkl            # Feature scaler
```

### 3. Start the ML Service

```bash
python realtime_service.py
```

The service will start on **port 5001**.

You should see:
```
Deepfake detector initialized successfully.
 * Running on http://0.0.0.0:5001
```

---

## 📡 API Endpoints

### Health Check
```
GET /health
```
Returns service status and model loading status.

### Analyze Frame (Real-time)
```
POST /analyze-frame
Content-Type: application/json

{
  "session_id": "meeting_123_user_456",
  "image_base64": "data:image/jpeg;base64,/9j/4AAQ...",
  "meeting_id": "meeting_123",
  "participant_id": "user_456"
}
```

**Response:**
```json
{
  "success": true,
  "face_detected": true,
  "session_id": "meeting_123_user_456",
  "frame_count": 45,
  "frame_metrics": {
    "ear": 0.245,
    "blink_detected": false,
    "yaw": 12.5,
    "pitch": -3.2
  },
  "prediction": {
    "label": "real",
    "confidence": 0.87,
    "probabilities": {
      "real": 0.87,
      "fake": 0.13
    }
  },
  "trust_score": 87,
  "is_likely_fake": false
}
```

### Reset Session
```
POST /reset-session
Content-Type: application/json

{
  "session_id": "meeting_123_user_456"
}
```

Clears the analysis buffer for a session (call when user leaves meeting).

### Video File Analysis (Batch)
```
POST /predict-video
Content-Type: multipart/form-data

file: <video_file.mp4>
```

---

## 🔧 Model Features

The custom ML model analyzes these temporal features:

| Feature | Description |
|---------|-------------|
| `total_blinks` | Count of blinks detected in buffer |
| `blink_rate` | Blinks per minute |
| `avg_ear` | Average Eye Aspect Ratio |
| `ear_variance` | Variance in EAR (detects unnatural patterns) |
| `yaw_variance` | Head rotation variance (yaw) |
| `pitch_variance` | Head rotation variance (pitch) |
| `yaw_angular_velocity` | Speed of head rotation |
| `pitch_angular_velocity` | Speed of head tilt |
| `mean_yaw` | Average head yaw |
| `mean_pitch` | Average head pitch |

---

## 🔄 Integration Flow

1. **Client** captures video frame every 5 seconds during meeting
2. **Client** sends frame to Node.js server (`/api/deepfake/analyze`)
3. **Node.js Server** forwards to Python ML service (`/analyze-frame`)
4. **Python ML Service**:
   - Buffers frames for temporal analysis
   - Extracts facial features using MediaPipe
   - Computes blink rate, head pose variance, etc.
   - Runs ML model prediction
   - Returns result
5. **Client** displays trust score and ML model confidence
6. **Node.js Server** logs results to MongoDB

---

## 🛠️ Troubleshooting

### "Detector not initialized"
- Check that `detector_model.pkl` and `scaler.pkl` exist in `deepfake_project/models/`
- Verify Python dependencies are installed: `pip list | grep scikit-learn`

### "No face detected"
- Ensure camera is working and face is clearly visible
- Check lighting conditions
- Verify MediaPipe is installed: `pip list | grep mediapipe`

### "ML Service unavailable" (503 error)
- Verify Python ML service is running on port 5001
- Check `PYTHON_ML_SERVICE_URL` environment variable in Node.js server

### Connection refused errors
- Make sure Python service is started before Node.js server
- Check firewall settings for port 5001

---

## 📝 Environment Variables

### Node.js Server (.env)
```env
PYTHON_ML_SERVICE_URL=http://localhost:5001
```

### Python Service (optional)
```env
FLASK_PORT=5001
FLASK_HOST=0.0.0.0
```

---

## 📊 Performance

- **Frame Processing Time:** ~100-300ms per frame
- **Buffer Size:** 150 frames (~5 seconds at 30fps)
- **Analysis Frequency:** Every 5 seconds
- **Memory Usage:** ~200MB for model + buffers

---

## 🔒 Security Notes

- ML service should only accept connections from the Node.js server
- In production, use a firewall to restrict port 5001 access
- Session IDs should be unique per meeting-participant pair
- No video frames are stored permanently by the ML service

---

## 📄 License

MIT License - Same as main project
