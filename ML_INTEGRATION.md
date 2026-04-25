# ML Integration — Deepfake Detection

This document explains how the real-time AI deepfake detection system works end-to-end, from camera frame capture to the Fraud Dashboard.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ React Frontend                                                   │
│                                                                  │
│  DeepfakeMonitor.tsx                                             │
│  ├── MediaPipe Face Mesh  (blink · gaze · micro-movements)      │
│  ├── Behavioural TrustScore (30% weight in final score)         │
│  └── Every 5s → POST /api/deepfake/analyze (base64 frame)       │
└─────────────────────────────────────────────┬───────────────────┘
                                              │ frame + session_id
                                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Node.js Backend  (port 5000)                                     │
│                                                                  │
│  POST /api/deepfake/analyze                                      │
│  ├── Validates JWT                                               │
│  ├── Rate limited: 5 req/sec per IP                             │
│  ├── Forwards frame to Python ML service                        │
│  └── Returns merged result to frontend                          │
└─────────────────────────────────────────────┬───────────────────┘
                                              │ HTTP POST
                                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Python ML Service  (port 5001)                                   │
│                                                                  │
│  /analyze-frame                                                  │
│  ├── Face detection (Haar Cascade)                               │
│  ├── Accumulate frames per session (needs 10+ frames)           │
│  ├── DeepfakeDetectionPipeline.predict_video()                  │
│  │   ├── Blink detection (EAR)                                  │
│  │   ├── Head pose estimation (yaw / pitch / roll)              │
│  │   ├── CNN visual features (ResNet50 backbone)                │
│  │   └── XGBoost fusion classifier                              │
│  └── Returns: label · confidence · probabilities · features     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Trust Score Calculation

The final TrustScore shown in the panel is a weighted blend:

```
TrustScore = (Behavioural × 0.30) + (ML Model × 0.70)
```

**Behavioural signals** (client-side, MediaPipe):

| Signal | What it checks | Penalty |
|--------|----------------|---------|
| Blink rate | < 5/min or = 0 → unnaturally still | −15 to −30 |
| Blink rate | > 45/min → unnaturally rapid | −20 |
| Micro-movements | Low jitter → static / pre-recorded | −10 to −25 |
| Gaze shifts | Too static or too erratic | −15 to −20 |

**ML model** (server-side, Python):
- `1 − final_score` × 100, where `final_score` is the XGBoost fake probability (0–1)

---

## Trust Score Interpretation

| Range | Badge | Meaning |
|-------|-------|---------|
| 90–100 | 🟢 Stable | Very high confidence participant is real |
| 70–89 | 🟡 Good | Generally trustworthy, minor anomalies |
| 40–69 | 🟠 Caution | Suspicious — further monitoring recommended |
| 0–39 | 🔴 Alert | High probability of deepfake or spoof |

A score below 40 triggers: deepfake alert badge on toolbar, red border on Fraud Dashboard panel, JPEG evidence snapshot saved to MongoDB.

---

## Session Management

Each participant has a unique session:

```
session_id = "{meetingId}_{participantId}"
```

- Frames accumulate per session in the Python service's in-memory store
- Full ML analysis runs once ≥ 10 frames are collected
- Until then, the service returns `prediction: null` and the frontend shows "Collecting frames…"
- Sessions auto-expire after **1 hour** via a background timer thread
- Sessions can be manually reset via `POST /api/deepfake/reset-session`

---

## API Reference

### Node.js Backend APIs

All endpoints require JWT authentication (except `/health` which is internal).

#### `POST /api/deepfake/analyze`
Sends a frame for ML analysis.

**Request body:**
```json
{
  "imageBase64": "data:image/jpeg;base64,/9j/4AAQ...",
  "meetingId": "abc-123",
  "participantId": "user_xyz"
}
```

**Response:**
```json
{
  "label": "real",
  "score": 0.92,
  "trustScore": 91.5,
  "isLikelyFake": false,
  "faceDetected": true,
  "probabilities": { "real": 0.92, "fake": 0.08 },
  "prediction": {
    "label": "real",
    "confidence": 0.92,
    "probabilities": { "real": 0.92, "fake": 0.08 },
    "features": {
      "blink_rate": 14.2,
      "interval_cv": 0.21,
      "yaw_variance": 8.3,
      "pitch_variance": 5.1,
      "roll_variance": 3.7,
      "cnn_score": 0.08,
      "total_blinks": 12
    },
    "frame_count": 24
  },
  "mlModel": {
    "type": "custom_zppm",
    "frameCount": 24,
    "features": { ... }
  },
  "frameMetrics": { "ear": 0.28, "blink_detected": false }
}
```

#### `POST /api/deepfake/log`
Stores a detection event in MongoDB.

#### `GET /api/deepfake/logs/:meetingId`
Returns all detection logs for a meeting (used by Fraud Dashboard).

#### `GET /api/deepfake/health`
Returns status of both the Node service and Python ML service.

#### `POST /api/deepfake/reset-session`
Resets the ML frame buffer for a session.

---

### Python ML Service APIs  (port 5001 — internal only)

#### `GET /health`
```json
{
  "status": "healthy",
  "pipeline": "full",
  "sessions_active": 3
}
```

#### `POST /analyze-frame`
**Request:**
```json
{
  "session_id": "abc-123_user_xyz",
  "image_base64": "/9j/4AAQ...",
  "meeting_id": "abc-123",
  "participant_id": "user_xyz"
}
```

**Response (enough frames collected):**
```json
{
  "success": true,
  "face_detected": true,
  "prediction": {
    "label": "real",
    "confidence": 0.92,
    "probabilities": { "real": 0.92, "fake": 0.08 },
    "features": { "blink_rate": 14.2, "cnn_score": 0.08, ... },
    "frame_count": 24
  },
  "trust_score": 91.5,
  "is_likely_fake": false,
  "frame_count": 24,
  "frame_metrics": { "ear": 0.28, "blink_detected": false }
}
```

**Response (still collecting frames):**
```json
{
  "success": true,
  "face_detected": true,
  "prediction": null,
  "frame_count": 7,
  "trust_score": 50,
  "is_likely_fake": false,
  "frame_metrics": { "initializing": true, "frames_collected": 7 }
}
```

#### `POST /reset-session`
```json
{ "session_id": "abc-123_user_xyz" }
```

---

## ML Pipeline Modes

### Full Mode (requires `deepfake_xgb_model.joblib`)
1. Face detection via Haar Cascade
2. Frame accumulation (10–30 frames per session)
3. EAR blink detection
4. 3D head pose estimation
5. ResNet50 CNN visual feature extraction
6. XGBoost fusion classification
7. Returns confidence + full feature vector

### Fallback Mode (no model file needed)
Activates automatically when `deepfake_xgb_model.joblib` is missing.
Uses image quality heuristics: face blur (Laplacian variance), face ratio, contrast.
Still returns valid trust scores — just less accurate.

To check which mode is active:
```bash
curl http://localhost:5001/health
# "pipeline": "full"  or  "pipeline": "fallback"
```

---

## Starting the ML Service

### Windows
```bat
cd ML_model
start-ml-service.bat
```

### Linux / Mac
```bash
cd ML_model
./start-ml-service.sh
```

### Manual
```bash
cd ML_model
python -m venv venv
source venv/bin/activate      # or venv\Scripts\activate on Windows
pip install -r requirements.txt
python ml_service.py
```

---

## Fraud Dashboard — How to Access

**During a meeting:**
1. Click the **Guard** button in the meeting toolbar
2. The Fraud Guard slide-in panel opens on the right
3. Click **"View Full Fraud Dashboard"** to open the full analytics page

**Direct URL:**
```
https://localhost:5173/meeting/{meetingId}/fraud-dashboard
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "ML Service unavailable" in meeting | Start `python ml_service.py` on port 5001 |
| Trust score stuck at 50% | ML still collecting frames (need 10+). Wait 30–60s. |
| "No face detected" in panel | Improve lighting, face the camera, avoid extreme angles |
| Always shows Fallback mode | Add `deepfake_xgb_model.joblib` to the feature_extraction folder |
| High false positives (real flagged as fake) | Improve lighting quality, keep camera stable, avoid shadows |
| Panel shows "Connecting…" forever | Check `PYTHON_ML_SERVICE_URL=http://localhost:5001` in `server/.env` |
| Evidence snapshot is blank | Only captured when `isLikelyFake=true` — normal if no detections |

---

## Performance Notes

- Frame analysis: ~1–3 seconds per request (depends on hardware and GPU availability)
- Minimum frames before full analysis: 10 (set in `ml_service.py`)
- Analysis frequency: every 5 seconds (set in `DeepfakeMonitor.tsx`)
- Maximum concurrent sessions: limited by available RAM (each session holds up to 30 frames in memory)
- Session cleanup: every 10 minutes via background timer thread
