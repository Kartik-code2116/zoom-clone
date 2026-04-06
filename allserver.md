# Zoom-Clone Server Architecture Guide

This document explains how all servers work together in the Zoom-Clone video conferencing platform with ML-powered deepfake detection.

---

## 🌐 System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ZOOM-CLONE ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐             │
│  │   React      │──────▶│  Node.js     │──────▶│ Python Flask │             │
│  │   Frontend   │◄──────│  Backend     │◄──────│  ML Service  │             │
│  │  (Port 5173) │      │  (Port 3001) │      │  (Port 5001) │             │
│  └──────────────┘      └──────────────┘      └──────────────┘             │
│         │                       │                       │                  │
│         ▼                       ▼                       ▼                  │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐             │
│  │   Browser    │      │   MongoDB    │      │   XGBoost    │             │
│  │   Camera     │      │  Database    │      │    Model     │             │
│  │  WebRTC      │      │              │      │              │             │
│  └──────────────┘      └──────────────┘      └──────────────┘             │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    LiveKit Cloud (External)                          │   │
│  │         WebSocket: wss://zoom-clone-2jil3ca0.livekit.cloud          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📡 Server Components

### 1. React Frontend (Vite Dev Server)
- **Port**: `https://localhost:5173`
- **Role**: User interface, video rendering, chat, ML dashboard
- **Tech**: React 18, TypeScript, Tailwind CSS, LiveKit Components
- **Key Features**:
  - Video conferencing UI
  - Deepfake Monitor panel (real-time)
  - Fraud Dashboard panel
  - Resizable/movable panels
  - Chat system

### 2. Node.js Backend API
- **Port**: `http://localhost:5000`
- **Role**: Business logic, authentication, ML proxy, database
- **Tech**: Express.js, TypeScript, MongoDB, Socket.IO
- **API Endpoints**:
  ```
  POST /api/auth/register      - User registration
  POST /api/auth/login         - User login
  GET  /api/auth/me            - Get current user
  POST /api/meetings           - Create meeting (instant or scheduled)
  GET  /api/meetings           - List user's meetings
  GET  /api/meetings/:id       - Get meeting info
  POST /api/meetings/:id/token - Get LiveKit token
  POST /api/meetings/:id/end   - End meeting (host only)
  POST /api/deepfake/analyze   - Analyze frame for deepfake
  POST /api/deepfake/log       - Log detection results
  GET  /api/deepfake/logs/:id  - Get detection history
  GET  /api/deepfake/health    - Health check
  ```

### 3. Python ML Service
- **Port**: `http://localhost:5001`
- **Role**: Deepfake detection using ML pipeline
- **Tech**: Flask, TensorFlow, XGBoost, OpenCV, MediaPipe
- **Endpoints**:
  ```
  POST /analyze-frame   - Analyze image for deepfake
  POST /reset-session   - Reset analysis session
  GET  /health          - Health check
  ```
- **ML Pipeline**:
  1. Face detection (Haar Cascade)
  2. Blink detection (EAR calculation)
  3. Head pose estimation
  4. CNN feature extraction (ResNet50)
  5. XGBoost classification (Real/Fake)

### 4. MongoDB Database
- **Connection**: `mongodb://localhost:27017/zoom-clone`
- **Role**: Store users, meetings, deepfake logs
- **Collections**:
  - `users` - User accounts
  - `meetings` - Meeting information
  - `deepfakelogs` - Detection results & trust scores

### 5. LiveKit Cloud (External)
- **URL**: `wss://zoom-clone-2jil3ca0.livekit.cloud`
- **Role**: WebRTC video/audio streaming infrastructure
- **Features**:
  - Real-time video/audio
  - Screen sharing
  - Participant management
  - Recording (optional)

---

## 🔄 Data Flow

### User Login Flow
```
1. User enters credentials on https://localhost:5173
2. Frontend POST /api/auth/login → Node.js (3001)
3. Node.js validates against MongoDB
4. Sets HTTP-only cookie with JWT token
5. User redirected to Dashboard
```

### Create Meeting Flow
```
1. User clicks "New Meeting" on Dashboard
2. Frontend POST /api/meetings → Node.js
3. Node.js generates meeting ID, saves to MongoDB
4. Returns meeting details
5. User redirected to Meeting page
```

### Join Meeting Flow
```
1. User clicks "Join Meeting"
2. Frontend POST /api/meetings/:id/token → Node.js
3. Node.js creates LiveKit token using:
   - API Key: APIFeCwrTYTucz6
   - Secret: hBBCNtgSG4lk8pbXAvNRGLrkQRi2Kz8sDS0iYcN7bbH
4. Token returned to frontend
5. Frontend connects to LiveKit Cloud via WebSocket
6. Video stream starts
```

### ML Deepfake Detection Flow
```
1. DeepfakeMonitor component captures video frame every 5s
2. Converts frame to base64 JPEG
3. POST /api/deepfake/analyze → Node.js (3001)
4. Node.js forwards to Python ML Service (5001)
5. ML Service analyzes:
   - Detects face
   - Calculates blink rate
   - Extracts CNN features
   - Runs XGBoost prediction
6. Returns: {label: "real"/"fake", confidence: 0.92, trust_score: 92}
7. Node.js returns result to frontend
8. Frontend updates Trust Score display
9. Logs result to MongoDB (if suspicious)
```

### Chat Message Flow
```
1. User types message in ChatPanel
2. Frontend emits Socket.IO event
3. Node.js broadcasts to all participants
4. Message displayed in real-time
```

---

## 🛠️ Configuration Files

### Server Environment (server/.env)
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/zoom-clone
JWT_SECRET=your_random_secret
CLIENT_URL=http://localhost:5173

# LiveKit Cloud
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
LIVEKIT_URL=ws://localhost:7880

# Python ML Service
PYTHON_ML_SERVICE_URL=http://localhost:5001
```

### Client Proxy (client/vite.config.ts)
```typescript
proxy: {
  '/api': {
    target: 'http://localhost:5000',
    changeOrigin: true,
  },
  '/socket.io': {
    target: 'http://localhost:5000',
    ws: true,
  },
}
```

---

## 🚀 Startup Sequence

### 1. Start Python ML Service
```bash
cd ML_model
.\venv\Scripts\activate
python ml_service.py
# Runs on http://localhost:5001
```

### 2. Start Node.js Backend
```bash
cd server
$env:PORT=5000
npm run dev
# Runs on http://localhost:5000
# Should show: "Connected to MongoDB" and "Server running on port 5000"
```

### 3. Start React Frontend
```bash
cd client
npm run dev
# Runs on https://localhost:5173
```

### 4. Verify All Services
Open browser and check:
- `https://localhost:5173` - Frontend (should show login page)
- `http://localhost:5000/api/auth/me` - Backend (should return 401 or user data)
- `http://localhost:5001/health` - ML Service (should return health status)

---

## 🧩 Key Components Interaction

### DeepfakeMonitor ↔ ML Service
```
┌─────────────────┐      ┌─────────────────┐     ┌─────────────────┐
│ DeepfakeMonitor │────▶│  Node.js API    │────▶│  Python ML      │
│ (React)         │     │  /deepfake/     │     │  /analyze-frame │
│                 │◄────│  analyze        │◄────│                 │
│ - Captures      │     │                 │     │ - Face detect   │
│   frames        │     │ - Proxies to    │     │ - Blink detect  │
│ - Shows trust   │     │   ML service    │     │ - CNN features  │
│   score         │     │ - Returns       │     │ - XGBoost       │
│ - Sparkline     │     │   prediction    │     │   prediction    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Meeting ↔ LiveKit
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Meeting Page    │────▶│  Node.js API    │────▶│  LiveKit Cloud  │
│ (React)         │     │  /meetings/     │     │  WebSocket      │
│                 │     │  token          │     │                 │
│ - Gets token    │◄────│                 │◄────│ - WebRTC        │
│ - Connects      │     │ - Generates     │     │   video/audio   │
│   to LiveKit    │     │   JWT token     │     │ - Participant   │
│ - Shows video   │     │                 │     │   management    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

---

## 📊 Monitoring & Debugging

### Check Server Logs
Watch the terminal where you ran `npm run dev` in server folder:
- `[Deepfake] Analyze request received` - ML analysis started
- `[Deepfake] ML service response` - ML analysis completed
- `Connected to MongoDB` - Database connected

### Browser DevTools
Open F12 → Network tab:
- Filter by "analyze" to see ML API calls
- Check response for `label`, `confidence`, `trustScore`

### Common Issues

| Issue | Solution |
|-------|----------|
| Port 3001 in use | Change to 3002 in both server/.env and client/vite.config.ts |
| 401 Unauthorized | Auth cookie not sent - check CORS settings |
| "Initializing AI model..." forever | Check Python ML service is running on port 5001 |
| LiveKit connection refused | Verify LIVEKIT_URL in server/.env matches cloud URL |
| Video not showing | Check camera permissions in browser |

---

## 🎯 ML Model Details

### Trust Score Calculation
```
Score 90-100: 🟢 Stable (High confidence real)
Score 70-89:  🟡 Caution (Generally trustworthy)
Score 40-69:  🟠 Warning (Suspicious patterns)
Score 0-39:   🔴 Alert (High probability deepfake)
```

### Features Analyzed
- **Blink Rate**: Normal 15-20 blinks/minute
- **EAR (Eye Aspect Ratio)**: Detects eye openness
- **Head Pose**: Yaw, pitch, roll variance
- **Micro Movements**: Natural face movements
- **CNN Features**: Visual patterns from ResNet50

---

## 📁 File Locations

```
zoom-clone/
├── client/                          # React Frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── DeepfakeMonitor.tsx  # ML detection UI
│   │   │   ├── FraudDashboardPanel.tsx
│   │   │   ├── ChatPanel.tsx
│   │   │   └── MeetingToolbar.tsx
│   │   ├── pages/
│   │   │   ├── Meeting.tsx          # Main meeting page
│   │   │   └── Dashboard.tsx
│   │   └── services/
│   │       └── api.ts               # API client
│   └── vite.config.ts               # Proxy config
│
├── server/                          # Node.js Backend
│   ├── src/
│   │   ├── routes/
│   │   │   ├── deepfake.ts          # ML API routes
│   │   │   ├── meetings.ts          # Meeting routes
│   │   │   └── auth.ts              # Auth routes
│   │   ├── utils/
│   │   │   └── livekit.ts           # LiveKit token generation
│   │   └── index.ts                 # Server entry
│   └── .env                         # Environment variables
│
└── ML_model/                        # Python ML Service
    ├── ml_service.py                # Flask server
    └── deepfake_detection/          # ML pipeline
```

---

## 🔐 Security Notes

1. **JWT Tokens**: Stored in HTTP-only cookies, not localStorage
2. **ML Service**: Runs locally, no external API calls
3. **LiveKit Tokens**: Generated server-side with expiration
4. **Video Frames**: Processed in-memory only
5. **Snapshots**: Only saved when `isLikelyFake` is true

---

## 🎓 Quick Commands

```bash
# Kill all Node processes (if ports stuck)
taskkill /F /IM node.exe

# Check what's using a port
netstat -ano | findstr :3001

# Test ML service
curl http://localhost:5001/health

# Test backend API
curl http://localhost:3001/api/auth/me

# View server logs
cd server && npm run dev
```

---

## ✅ Verification Checklist

- [ ] Python ML service running on port 5001
- [ ] Node.js server running on port 3001
- [ ] React client running on port 5173
- [ ] MongoDB connected (check server logs)
- [ ] LiveKit Cloud configured with correct API key/secret
- [ ] Client proxy pointing to port 3001
- [ ] Can login/register
- [ ] Can create meeting
- [ ] Can join meeting with video
- [ ] Deepfake Monitor shows "Initializing AI model..." then updates
- [ ] Trust score changes every 5 seconds
- [ ] Network tab shows analyze API calls

---

**Last Updated**: April 6, 2026  
**Project**: Zoom-Clone with ML Deepfake Detection  
**Status**: Production Ready
