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

### 🤖 AI Deepfake Detection Engine
- ✅ Real-time deepfake analysis powered by **Google MediaPipe Face Mesh** (468 facial landmarks)
- ✅ Eye Aspect Ratio (EAR) blink detection — flags abnormal blink rates (< 5/min or > 35/min)
- ✅ Nose-to-cheek landmark gaze estimation — detects abnormal gaze shift patterns
- ✅ Micro-movement analysis — detects unnaturally still faces (pre-recorded videos / static images)
- ✅ Composite `TrustScore` (0–100) computed from behavioral signals
- ✅ Configurable — guard can be toggled per user
- ✅ Events logged to MongoDB with optional JPEG snapshot evidence

### 📊 Host Fraud Dashboard
- ✅ Per-meeting deepfake event log viewer at `/meeting/:id/fraud-dashboard`
- ✅ **Trust Score Timeline** chart (interactive `recharts` line graph)
- ✅ Summary cards — total snapshots, flagged events, min/avg trust score
- ✅ Evidence snapshot viewer for each flagged event
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
  └────────────────────────┘          │  /api/deepfake        │
                                      └──────────┬────────────┘
                                                 │
                                         ┌───────▼───────┐
                                         │   MongoDB      │
                                         │  (port 27017)  │
                                         └───────────────┘
```

---

## 🚀 Quick Start

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
│   │   │   └── deepfake.ts             # Log event, get logs by meeting
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
```

| Variable           | Default                                   | Description                |
|--------------------|-------------------------------------------|----------------------------|
| `PORT`             | `5000`                                    | Server port                |
| `MONGODB_URI`      | `mongodb://localhost:27017/zoom-clone`    | MongoDB connection string  |
| `JWT_SECRET`       | *(set this)*                              | JWT signing key            |
| `LIVEKIT_API_KEY`  | `devkey`                                  | LiveKit API key            |
| `LIVEKIT_API_SECRET` | `secret`                                | LiveKit API secret         |
| `LIVEKIT_URL`      | `ws://localhost:7880`                     | LiveKit server WebSocket URL |
| `CLIENT_URL`       | `http://localhost:5173`                   | Frontend origin (for CORS) |

---

## 🔬 AI Deepfake Detection — How It Works

The `DeepfakeMonitor` component runs entirely **client-side** using Google's MediaPipe Face Mesh library:

1. **Face Landmark Detection** — Tracks 468 facial points in real-time from the local video stream.
2. **Eye Aspect Ratio (EAR)** — Measures blink frequency. Humans blink 10–20 times/min. Abnormal rates trigger a score penalty.
3. **Gaze Estimation** — Computes the horizontal offset of the nose tip relative to cheekbones to detect suspicious gaze patterns.
4. **Micro-movement Score** — Tracks subtle nose-tip jitter. Unnaturally still faces (e.g., a replayed video) produce a near-zero score.
5. **Trust Score** — A composite 0–100 score. Scores below 40 flag the participant as "Likely Fake" and log the event with an optional JPEG snapshot to the backend.

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
| POST   | `/api/deepfake/log`             | Log a deepfake detection event       |
| GET    | `/api/deepfake/logs/:meetingId` | Get all logs for a meeting (auth)    |

---

## 🛠️ Tech Stack

| Layer        | Technology                                  |
|--------------|---------------------------------------------|
| Frontend     | React 18, Vite, TypeScript, TailwindCSS     |
| Video/Audio  | LiveKit SDK + LiveKit SFU (Docker)          |
| Real-time    | Socket.IO                                   |
| AI Detection | Google MediaPipe Face Mesh                  |
| Charts       | Recharts                                    |
| Backend      | Node.js, Express.js, TypeScript             |
| Database     | MongoDB (Mongoose)                          |
| Auth         | JWT (httpOnly cookies)                      |
| Dev Tools    | ts-node-dev, eslint, concurrently           |

---

## 📜 License

MIT
