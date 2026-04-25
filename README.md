# SecureMeet — AI-Powered Video Conferencing

> Enterprise-grade video conferencing with real-time AI deepfake detection, built on LiveKit, React, Node.js, and Python.

---

## Features

### Core Video Conferencing
- JWT authentication with httpOnly cookies (XSS-safe)
- Instant meeting creation with shareable invite links
- Schedule meetings for future dates
- LiveKit-powered HD video & audio (WebRTC SFU)
- Grid layout with automatic speaker detection
- Mute/unmute mic & camera — keyboard shortcuts `M` / `V`
- Multi-camera device switcher in the toolbar
- Screen sharing
- Real-time chat via Socket.IO with message history
- Pre-join camera preview with device selection
- Post-meeting summary with duration
- Draggable & resizable panels (Chat, Participants, Deepfake Monitor, Fraud Guard)

### AI Deepfake Detection
- **Client-side** — MediaPipe Face Mesh for blink detection, gaze estimation, micro-movement analysis
- **Server-side** — Python ML service: CNN (ResNet50) + XGBoost fusion classifier
- **Fused TrustScore** — 30% behavioral signals + 70% AI model probability
- ML service status shown in real-time: Active / Offline / Connecting
- Evidence snapshots (JPEG) captured and stored on detection events
- DeepFake Guard toggleable per session from Meeting Settings

### Fraud Guard Dashboard
- Live slide-in panel during meetings with auto-refresh every 5s
- Per-participant trust score cards with real/fake ML classification
- Full-page analytics at `/meeting/:id/fraud-dashboard`:
  - Trust Score Timeline with danger (40%) and caution (70%) reference lines
  - Summary cards: logs, ML detections, flagged events, avg/min trust
  - Evidence snapshot viewer with expandable modal
  - Export as JSON or CSV

### Security
- JWT in httpOnly cookies — no localStorage tokens
- bcrypt password hashing (min 8 characters)
- Rate limiting: 30 auth attempts per 15 min, 5 ML frames/sec per IP
- All protected routes require authentication
- ML service only accepts calls from the Node server (CORS-restricted)

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     React Frontend (Vite)                     │
│            TypeScript + Tailwind CSS + LiveKit SDK            │
│                                                               │
│  ┌────────────────────┐     ┌───────────────────────────────┐ │
│  │  LiveKit Room SDK  │     │  MediaPipe Face Mesh          │ │
│  │  (WebRTC video)    │     │  (blink / gaze / movement)    │ │
│  └─────────┬──────────┘     └──────────────┬────────────────┘ │
└────────────┼──────────────────────────────┼──────────────────┘
             │ WebRTC                        │ frames + scores
             ▼                               ▼
┌────────────────────────────────────────────────────────────┐
│                  Node.js + Express + TypeScript              │
│                                                              │
│  /api/auth          /api/meetings        /api/deepfake/*     │
│  Socket.IO (chat)   LiveKit token gen    Rate limited        │
│       │                   │                    │             │
│       ▼                   ▼                    ▼             │
│    MongoDB            LiveKit Cloud    Python ML Service      │
│  (Users, Meetings,    (SFU media)      Flask · port 5001     │
│   DeepfakeLogs,                        OpenCV · XGBoost      │
│   ChatMessages)                        ResNet50 CNN          │
└────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, DM Sans |
| Icons | Lucide React |
| Video / Audio | LiveKit Cloud (WebRTC SFU) |
| Face Analysis | MediaPipe Face Mesh (client-side, no server round-trip) |
| Charts | Recharts |
| Backend | Node.js 18+, Express, TypeScript, Socket.IO |
| Database | MongoDB 7 (Mongoose) |
| ML Service | Python 3.10+, Flask, OpenCV, TensorFlow, XGBoost, MediaPipe |
| Auth | JWT (httpOnly cookies) + bcrypt |
| Containerisation | Docker + Docker Compose |

---

## Project Structure

```
zoom-clone/
├── client/                   # React frontend
│   ├── src/
│   │   ├── components/       # Reusable UI components
│   │   │   ├── Navbar.tsx           # Sticky nav with active links + avatar dropdown
│   │   │   ├── MeetingToolbar.tsx   # Lucide icon toolbar (no emojis)
│   │   │   ├── MeetingHeader.tsx    # Meeting title + connection status
│   │   │   ├── DeepfakeMonitor.tsx  # Floating AI detection panel
│   │   │   ├── FraudDashboardPanel.tsx  # Slide-in fraud guard panel
│   │   │   ├── ChatPanel.tsx        # Draggable real-time chat
│   │   │   ├── ParticipantPanel.tsx # Participant list with mic/cam status
│   │   │   └── MeetingSettingsModal.tsx
│   │   ├── pages/            # Route-level pages
│   │   │   ├── Home.tsx             # Landing page
│   │   │   ├── Login.tsx / Register.tsx
│   │   │   ├── Dashboard.tsx        # Meeting management
│   │   │   ├── Meeting.tsx          # Main video conferencing page
│   │   │   ├── JoinMeeting.tsx      # Pre-join camera preview
│   │   │   ├── FraudDashboard.tsx   # Full analytics page
│   │   │   ├── MeetingSummary.tsx   # Post-meeting summary
│   │   │   └── ProfilePage.tsx
│   │   ├── context/          # AuthContext (JWT session)
│   │   ├── services/         # Axios API client
│   │   └── utils/            # Toast helpers
│   ├── .env                  # VITE_LIVEKIT_URL (gitignored)
│   ├── .env.example          # Template
│   └── tailwind.config.js    # Unified color system + safelist
│
├── server/                   # Express backend
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.ts       # Register, login, logout, profile
│   │   │   ├── meetings.ts   # CRUD + LiveKit token generation
│   │   │   └── deepfake.ts   # analyze, log, logs, health, reset-session
│   │   ├── models/           # User, Meeting, DeepfakeLog, ChatMessage
│   │   ├── middleware/       # JWT auth middleware
│   │   ├── utils/            # LiveKit token generator
│   │   ├── socket.ts         # Socket.IO chat + room events
│   │   └── index.ts          # App entry point + rate limiters
│   ├── .env                  # Server secrets (gitignored)
│   ├── .env.example          # Template
│   └── Dockerfile
│
├── ML_model/                 # Python deepfake detection service
│   ├── ml_service.py         # Flask app + DeepfakeDetectionPipeline
│   ├── requirements.txt      # All Python dependencies
│   └── Dockerfile
│
├── docker-compose.yml        # MongoDB + LiveKit + server + ML service
├── start-ml-service.bat      # Windows ML service launcher
├── start-ml-service.sh       # Linux/Mac ML service launcher
└── RUN_GUIDE.md              # Step-by-step setup instructions
```

---

## Quick Start

See **[RUN_GUIDE.md](./RUN_GUIDE.md)** for the complete guide.

```bash
# 1. Start MongoDB
docker compose up mongodb -d

# 2. Start Node backend
cd server && npm install && npm run dev

# 3. Start Python ML service
cd ML_model && python ml_service.py

# 4. Start React frontend
cd client && npm install && npm run dev
```

Open **https://localhost:5173**

---

## Environment Variables

### `server/.env`
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/zoom-clone
JWT_SECRET=your_long_random_secret_here_min_32_chars
CLIENT_URL=http://localhost:5173
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
LIVEKIT_URL=wss://your-project.livekit.cloud
PYTHON_ML_SERVICE_URL=http://localhost:5001
```

### `client/.env`
```env
VITE_LIVEKIT_URL=wss://your-project.livekit.cloud
```

> Get LiveKit credentials free at [livekit.io](https://livekit.io) → Settings → API Keys.  
> **Never commit `.env` files** — both are in `.gitignore`.

---

## Trust Score Reference

| Score | Status | Meaning |
|-------|--------|---------|
| 90–100 | 🟢 Stable | High confidence — participant is real |
| 70–89 | 🟡 Good | Generally trustworthy, minor anomalies |
| 40–69 | 🟠 Caution | Suspicious patterns — may need verification |
| 0–39 | 🔴 Alert | High probability of deepfake or spoof |

---

## License

MIT
