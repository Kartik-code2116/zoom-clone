# Deepfake Detection Integration

This document describes how the real-time deepfake detection system is integrated with the Zoom-Clone video conferencing platform.

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Video Call    │────▶│  Node.js Server │────▶│ Python ML     │
│   (Frontend)    │◄────│   (Port 5000)   │◄────│ Service (5001) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                        │                        │
        ▼                        ▼                        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ DeepfakeMonitor │     │ /api/deepfake/* │     │ ML Pipeline   │
│ Component       │     │ Routes          │     │ (TensorFlow)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Components

### 1. Frontend (DeepfakeMonitor.tsx)
- Captures video frames from the user's camera every 5 seconds
- Sends base64-encoded frames to the backend
- Displays real-time trust score and ML prediction
- Logs suspicious activity to the Fraud Dashboard

### 2. Node.js Backend (deepfake.ts)
- Receives frames from frontend
- Forwards to Python ML service for analysis
- Stores results in MongoDB for dashboard
- Provides APIs:
  - `POST /api/deepfake/analyze` - Analyze a frame
  - `POST /api/deepfake/log` - Store detection log
  - `GET /api/deepfake/logs/:meetingId` - Get logs for dashboard
  - `GET /api/deepfake/health` - Health check

### 3. Python ML Service (ml_service.py)
- Runs on port 5001
- Receives frames via HTTP API
- Accumulates frames into short video clips (10-30 frames)
- Runs deepfake detection pipeline:
  - Face detection (Haar Cascade / MediaPipe)
  - Blink detection
  - Head pose estimation
  - CNN visual feature extraction
  - Fusion classification (Random Forest/XGBoost)
- Returns prediction with confidence scores

## How It Works

### Real-Time Analysis Flow

1. **Frame Capture**: `DeepfakeMonitor` captures frames from the user's video stream
2. **Frame Analysis**: Sends frame to `/api/deepfake/analyze`
3. **ML Processing**: 
   - Server forwards to Python ML service
   - ML service accumulates frames into session buffers
   - When enough frames collected (10+), runs full pipeline analysis
   - Returns prediction: `{label: "real"|"fake", confidence: 0-1}`
4. **Trust Score Calculation**: Combines ML score with behavioral signals
5. **Dashboard Update**: Logs suspicious activity to Fraud Dashboard

### Session Management

Each participant gets a unique session ID (`{meetingId}_{participantId}`):
- Frames are accumulated per session
- Analysis improves as more frames are collected
- Sessions auto-expire after 1 hour
- Sessions can be manually reset via `/reset-session`

## Running the ML Service

### Windows
```bash
start-ml-service.bat
```

### Linux/Mac
```bash
./start-ml-service.sh
```

### Manual Setup
```bash
cd ML_model
python -m venv venv

# Windows
venv\Scripts\activate

# Linux/Mac
source venv/bin/activate

pip install flask numpy opencv-python mediapipe scikit-learn pandas tensorflow keras xgboost joblib ultralytics
python ml_service.py
```

## Environment Variables

### Server (.env)
```
PYTHON_ML_SERVICE_URL=http://localhost:5001
```

### Client (.env)
No ML-specific variables needed - uses server APIs.

## API Endpoints (ML Service)

### POST /analyze-frame
Analyze a single frame for deepfake detection.

**Request:**
```json
{
  "session_id": "meeting123_user456",
  "image_base64": "data:image/jpeg;base64,/9j/4AAQ...",
  "meeting_id": "meeting123",
  "participant_id": "user456"
}
```

**Response:**
```json
{
  "success": true,
  "face_detected": true,
  "prediction": {
    "label": "real",
    "confidence": 0.92,
    "probabilities": {
      "real": 0.92,
      "fake": 0.08
    },
    "features": {
      "blink_rate": 15.2,
      "yaw_variance": 12.5,
      "cnn_score": 0.15
    },
    "frame_count": 25
  },
  "trust_score": 92.0,
  "is_likely_fake": false,
  "frame_metrics": {
    "ear": 0.28,
    "blink_detected": false
  }
}
```

### POST /reset-session
Reset analysis session for a participant.

**Request:**
```json
{
  "session_id": "meeting123_user456"
}
```

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "pipeline": "full",
  "sessions_active": 5
}
```

## Trust Score Interpretation

| Score Range | Status | Meaning |
|-------------|--------|---------|
| 90-100 | 🟢 Stable | High confidence the participant is real |
| 70-89 | 🟡 Caution | Generally trustworthy, some anomalies detected |
| 40-69 | 🟠 Warning | Suspicious patterns, may need verification |
| 0-39 | 🔴 Alert | High probability of deepfake/spoof |

## Fraud Dashboard

Access the fraud dashboard during a meeting:
1. Click the **Settings** icon in the meeting toolbar
2. Click **Open Fraud Dashboard**
3. View real-time and historical detection results

The dashboard shows:
- Live trust score timeline
- Flagged detections with evidence snapshots
- ML model predictions with confidence
- Behavioral metrics (blinks, gaze, movements)

## Troubleshooting

### ML Service Not Available
- Check if Python ML service is running on port 5001
- Verify `PYTHON_ML_SERVICE_URL` in server `.env`
- Check server logs for connection errors

### No Face Detected
- Ensure good lighting conditions
- Participant should face the camera
- Check if face is visible and not obstructed

### Low Trust Scores
- May indicate actual deepfake OR poor video quality
- Check frame metrics for specific issues
- Review behavioral signals (blinking, movement)

### High False Positives
- Adjust lighting to avoid shadows on face
- Ensure stable camera position
- Avoid extreme head angles

## Model Details

The detection pipeline uses:
1. **Face Detection**: Haar Cascade / MediaPipe Face Mesh
2. **Blink Detection**: EAR (Eye Aspect Ratio) calculation
3. **Head Pose**: 3D head pose estimation
4. **Visual Features**: ResNet50 CNN backbone
5. **Fusion Classifier**: Random Forest or XGBoost ensemble

## Performance Notes

- Frame analysis takes ~1-3 seconds depending on hardware
- Accumulates 10 frames before full analysis
- Trust score updates every 5 seconds
- ML service can handle multiple concurrent sessions

## Security Considerations

- ML service runs locally (no external API calls)
- Video frames are processed in-memory only
- Snapshots only saved when `isLikelyFake` is true
- Session data auto-expires after 1 hour
