# 🎥 ZoomClone — AI-Powered Video Conferencing Platform

A full-featured, production-ready video conferencing platform built with React, Node.js, LiveKit, and MongoDB — enhanced with an AI-based **DeepFake Detection Engine** and a **Host Verification Dashboard**.

---

## ✨ Features

### 🧑‍💻 Core Conferencing
- ✅ User registration & login (JWT + httpOnly cookies)
- ✅ Instant meeting creation with unique shareable invite links
- ✅ LiveKit-powered real-time video & audio conferencing
- ✅ Grid layout with automatic speaker detection
- ✅ Mute/unmute mic & camera controls
- ✅ Screen sharing support
- ✅ In-meeting real-time chat (Socket.IO)
- ✅ Meeting timer display
- ✅ Copy invite link with one click
- ✅ Keyboard shortcuts (`M` = toggle mic, `V` = toggle camera)
- ✅ Pre-join camera preview page
- ✅ Post-meeting summary page
- ✅ Dark mode UI with Zoom-style toolbar
- ✅ Guest join via link (no account required)

### 👥 Participant Management
- ✅ Participant panel with mic & camera status indicators
- ✅ **Dynamic Host Badge** — the meeting creator is identified and shown as "Host" in all participants' panels using LiveKit metadata (no hardcoding)
- ✅ Accurate identity resolution: authenticated users are matched by their unique User ID

- ✅ Real-time deepfake analysis powered by **Custom ML Pipeline** (TensorFlow + XGBoost)
- ✅ Eye Aspect Ratio (EAR) blink detection — flags abnormal blink rates
- ✅ Nose-to-cheek landmark gaze estimation — detects abnormal gaze shift patterns
- ✅ Micro-movement analysis — detects unnaturally still faces
- ✅ **Custom ZPPM AI Model** — Server-side deepfake detection with behavioral + CNN fusion
- ✅ **Fused TrustScore** (0–100) — Weighted combination of behavioral signals (30%) and AI model probability (70%)
- ✅ Configurable — guard can be toggled per user
- ✅ Events logged to MongoDB with AI confidence labels and JPEG snapshot evidence

### 📊 Host Fraud Dashboard
- ✅ Per-meeting deepfake event log viewer at `/meeting/:id/fraud-dashboard`
- ✅ **Trust Score Timeline** chart — shows both Integrated Trust and raw AI Model Confidence
- ✅ Summary cards — total snapshots, **AI model detections**, flagged events, min/avg trust score
- ✅ Evidence snapshot viewer for each flagged event with AI classification labels
- ✅ Export full event log as JSON for audit

### 🔒 Security & Auth
- ✅ JWT stored in httpOnly cookies (XSS-safe)
- ✅ Protected routes — Fraud Dashboard accessible only to authenticated users
- ✅ Host-only meeting termination endpoint (validated server-side)
- ✅ Package vulnerability patching via `npm audit fix`

---

## 🏗️ Architecture

```
                        ┌─────────────────────────────────┐
                        │          React Frontend          │
                        │   (Vite + TypeScript + Tailwind) │
                        │                                  │
                        │  ┌────────────┐ ┌─────────────┐ │
                        │  │  LiveKit   │ │  MediaPipe  │ │
                        │  │  Room SDK  │ │ Face Mesh   │ │
                        │  └─────┬──────┘ └──────┬──────┘ │
                        └────────┼───────────────┼─────────┘
                                 │               │ TrustScore + Snapshot
               WebSocket (video) │               ▼
               ┌─────────────────┘    ┌──────────────────────┐
               │                      │   Express Backend     │
               ▼                      │   (Node + TypeScript) │
  ┌────────────────────────┐          │                       │
  │   LiveKit SFU Server   │          │  /api/auth            │
  │   (Docker, port 7880)  │          │  /api/meetings        │
  └────────────────────────┘          │  /api/deepfake ───────┼──▶ Python ML Service
                                      └──────────┬────────────┘    (Port 5001)
                                                 │                        │
                                         ┌───────▼───────┐          ┌────▼────┐
                                         │   MongoDB      │          │  ML Pipeline
                                         │  (port 27017)  │          │ (TF+XGB)
                                         └───────────────┘          └─────────┘
```

---

## 🚀 Quick Start

### 0. Start the Python ML Service (Required for Deepfake Detection)

```bash
cd zoom-clone

# Windows
start-ml-service.bat

# Linux/Mac
chmod +x start-ml-service.sh
./start-ml-service.sh
```

The ML Service runs on `http://localhost:5001` and analyzes video frames for deepfake detection.

### 1. Start Docker services (LiveKit + MongoDB)

```bash
cd zoom-clone
docker compose up -d
```

This starts:
- **LiveKit server** on `ws://localhost:7880`
- **MongoDB** on `localhost:27017`

### 2. Start the backend server

```bash
cd server
npm install
npm run dev
```

Server runs on `http://localhost:5000`

### 3. Start the frontend

```bash
cd client
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`

### 4. Open the app

Visit **`http://localhost:5173`** in your browser.

---

## 📁 Project Structure

```
zoom-clone/
├── client/                       # React frontend (Vite + TS)
│   ├── src/
│   │   ├── components/
│   │   │   ├── ParticipantPanel.tsx    # Dynamic host badge (metadata-driven)
│   │   │   ├── DeepfakeMonitor.tsx     # AI deepfake detection (MediaPipe)
│   │   │   ├── MeetingToolbar.tsx      # Custom controls toolbar
│   │   │   ├── ChatPanel.tsx           # Real-time chat (Socket.IO)
│   │   │   ├── MeetingHeader.tsx       # Title + connection status
│   │   │   ├── MeetingSettingsModal.tsx
│   │   │   └── ...
│   │   ├── pages/
│   │   │   ├── Meeting.tsx             # Main meeting room
│   │   │   ├── JoinMeeting.tsx         # Pre-join preview + auth identity
│   │   │   ├── FraudDashboard.tsx      # Host deepfake dashboard + chart
│   │   │   ├── Dashboard.tsx           # User's meeting list
│   │   │   └── ...
│   │   ├── context/                    # Auth context (JWT)
│   │   ├── services/api.ts             # Axios API client
│   │   └── utils/                      # Toast helpers
│   └── vite.config.ts
│
├── server/                       # Express backend (Node + TS)
│   ├── src/
│   │   ├── models/
│   │   │   ├── Meeting.ts              # Meeting schema (hostId, status)
│   │   │   ├── User.ts                 # User schema
│   │   │   └── DeepfakeLog.ts          # Deepfake event logs
│   │   ├── routes/
│   │   │   ├── auth.ts                 # Register, login, logout, /me
│   │   │   ├── meetings.ts             # Create, list, token (host metadata), end
│   │   │   └── deepfake.ts             # /analyze (HuggingFace proxy), /log event, /logs/:meetingId
│   │   ├── utils/
│   │   │   └── livekit.ts              # Token generator (with metadata support)
│   │   ├── middleware/auth.ts          # JWT validation
│   │   └── socket.ts                   # Socket.IO chat setup
│   └── tsconfig.json
│
├── docker-compose.yml            # LiveKit SFU + MongoDB
└── README.md
```

---

## 🌍 Environment Variables

Create a `server/.env` file:

```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/zoom-clone
JWT_SECRET=your_super_secret_key
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
LIVEKIT_URL=ws://localhost:7880
CLIENT_URL=http://localhost:5173
PYTHON_ML_SERVICE_URL=http://localhost:5001
```

| Variable                | Default                                   | Description                      |
|-------------------------|-------------------------------------------|----------------------------------|
| `PORT`                  | `5000`                                    | Server port                      |
| `MONGODB_URI`           | `mongodb://localhost:27017/zoom-clone`    | MongoDB connection string        |
| `JWT_SECRET`            | *(set this)*                              | JWT signing key                  |
| `LIVEKIT_API_KEY`       | `devkey`                                  | LiveKit API key                  |
| `LIVEKIT_API_SECRET`    | `secret`                                  | LiveKit API secret               |
| `LIVEKIT_URL`           | `ws://localhost:7880`                     | LiveKit server WebSocket URL     |
| `CLIENT_URL`            | `http://localhost:5173`                   | Frontend origin (for CORS)       |
| `PYTHON_ML_SERVICE_URL` | `http://localhost:5001`                   | Python ML Service URL            |

> **Note:** See `ML_INTEGRATION.md` for detailed ML service configuration.

---

The `DeepfakeMonitor` component combines local behavioral analysis with server-side AI model verification:
1. **Face Landmark Detection (Behavioral)** — Uses Google's MediaPipe Face Mesh to track 468 facial points locally.
2. **Signal Analysis** — Computes Eye Aspect Ratio (EAR), Gaze Offset, and Micro-movement jitter.
3. **AI Model Verification** — Every 5 seconds, a frame is captured and sent to the Python ML Service (`ml_service.py`) running on port 5001.
4. **ML Pipeline** — The Python service accumulates frames, runs TensorFlow CNN + XGBoost fusion classifier for prediction.
5. **Fused Trust Score** — A weighted composite score:
    - **30% weight**: Local behavioral consistency (blinking, jitter, gaze).
    - **70% weight**: Custom ML model classification probability.
6. **Logging** — Events below the trust threshold are logged to MongoDB with JPEG snapshots and ML classification labels.

---

## 📋 API Endpoints

### Auth
| Method | Endpoint             | Description             |
|--------|----------------------|-------------------------|
| POST   | `/api/auth/register` | Register user           |
| POST   | `/api/auth/login`    | Login (sets JWT cookie) |
| POST   | `/api/auth/logout`   | Logout                  |
| GET    | `/api/auth/me`       | Get current user        |

### Meetings
| Method | Endpoint                         | Description                         |
|--------|----------------------------------|-------------------------------------|
| POST   | `/api/meetings`                  | Create meeting (auth required)      |
| GET    | `/api/meetings`                  | List user's meetings (auth required)|
| GET    | `/api/meetings/:id`              | Get meeting info (public)           |
| POST   | `/api/meetings/:id/token`        | Get LiveKit token (host metadata)   |
| POST   | `/api/meetings/:id/end`          | End meeting (host only)             |

### Deepfake
| Method | Endpoint                        | Description                          |
|--------|---------------------------------|--------------------------------------|
| POST   | `/api/deepfake/analyze`         | Analyze frame via Python ML Service  |
| POST   | `/api/deepfake/log`             | Log a deepfake detection event       |
| GET    | `/api/deepfake/logs/:meetingId` | Get all logs for a meeting (auth)    |
| GET    | `/api/deepfake/health`          | Check ML service health              |

---

## 🛠️ Tech Stack

| Layer        | Technology                                      |
|--------------|-------------------------------------------------|
| Frontend     | React 18, Vite, TypeScript, TailwindCSS         |
| Video/Audio  | LiveKit SDK + LiveKit SFU (Docker)              |
| Real-time    | Socket.IO                                       |
| AI Detection | Custom ML Pipeline (TensorFlow + XGBoost)      |
| ML Service   | Python Flask (Port 5001)                       |
| Charts       | Recharts                                        |
| Backend      | Node.js, Express.js, TypeScript                 |
| Database     | MongoDB (Mongoose)                              |
| Auth         | JWT (httpOnly cookies)                          |
| Dev Tools    | ts-node-dev, eslint, concurrently               |

---

## 📚 Additional Documentation

- **[ML_INTEGRATION.md](ML_INTEGRATION.md)** — Deepfake detection integration guide
- **[server/.env.example](server/.env.example)** — Server environment configuration

---

## 📜 License

MIT
