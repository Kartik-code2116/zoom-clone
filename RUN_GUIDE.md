# SecureMeet — Setup & Run Guide

## Architecture at a Glance

```
React Client (5173)  ──▶  Node.js API (5000)  ──▶  MongoDB (27017)
                                │
                                ▼
                     Python ML Service (5001)

React Client  ──────────────────────────────▶  LiveKit Cloud (wss://...)
```

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | v18+ | Backend + Frontend |
| Python | 3.10+ | ML service |
| MongoDB | 7+ | Database (or Docker) |
| LiveKit account | Free tier | WebRTC SFU media server |

Get a free LiveKit account at [livekit.io](https://livekit.io).

---

## Step 0 — Create Environment Files

### `server/.env`
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/zoom-clone
JWT_SECRET=replace_with_a_long_random_string_min_32_chars
CLIENT_URL=http://localhost:5173
MOBILE_URL=http://localhost:5174

LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
LIVEKIT_URL=wss://your-project.livekit.cloud

PYTHON_ML_SERVICE_URL=http://localhost:5001
```

### `client/.env`
```env
VITE_LIVEKIT_URL=wss://your-project.livekit.cloud
```

> **Never commit these files.** Both are already in `.gitignore`.

---

## Step 1 — Start MongoDB

```bash
# Option A: Windows service
net start MongoDB

# Option B: Docker (recommended — no install needed)
docker compose up mongodb -d
```

---

## Step 2 — Start Node.js Backend

```bash
cd server
npm install
npm run dev
```

Expected output:
```
Connected to MongoDB
Server running on port 5000
```

---

## Step 3 — Start Python ML Service

```bash
cd ML_model

# First time only — create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

# First time only — install dependencies
pip install -r requirements.txt

# Start the service
python ml_service.py
```

Expected output:
```
Deepfake Detection ML Service v1.1
ML Model Path: ...
Pipeline: Full (or Fallback) mode
Starting server on http://0.0.0.0:5001
```

> **Fallback mode** activates if `deepfake_xgb_model.joblib` is not found.
> The service still works — it uses image quality heuristics instead of the CNN model.
> Trust scores and detections continue to function normally.

---

## Step 4 — Start React Frontend

```bash
cd client
npm install
npm run dev
```

Expected output:
```
VITE ready
➜  Local:   https://localhost:5173/
```

> The browser shows a **certificate warning** on first launch. This is expected for local HTTPS.
> Click **Advanced → Proceed to localhost** to continue. Camera requires HTTPS or localhost.

---

## Step 5 (Optional) — Run Everything via Docker

```bash
# Builds and starts: MongoDB + LiveKit + Node server + Python ML service
docker compose up --build

# Start the frontend separately (not containerised)
cd client && npm run dev
```

---

## Verify All Services

```powershell
# Windows — check all required ports are listening
Get-NetTCPConnection -LocalPort 5000,5001,5173,27017 |
  Select-Object LocalPort, State | Sort-Object LocalPort
```

Expected:
```
LocalPort  State
---------  -----
     5000  Listen   ← Node.js server
     5001  Listen   ← Python ML service
     5173  Listen   ← React frontend
    27017  Listen   ← MongoDB
```

---

## Windows One-Click Start Script

Save as `start-all.bat` in the project root:

```batch
@echo off
echo Starting SecureMeet...

:: MongoDB
net start MongoDB

:: Backend
cd server
start "SecureMeet Backend" cmd /k "npm run dev"
cd ..

:: ML Service
cd ML_model
start "SecureMeet ML" cmd /k "venv\Scripts\activate && python ml_service.py"
cd ..

:: Frontend
cd client
start "SecureMeet Frontend" cmd /k "npm run dev"
cd ..

echo.
echo All services starting. Open https://localhost:5173
pause
```

---

## Route Reference

| URL | Page | Auth Required |
|-----|------|:---:|
| `/` | Home / Landing | No |
| `/login` | Sign in | No |
| `/register` | Create account | No |
| `/dashboard` | Meeting management | Yes |
| `/profile` | User profile | Yes |
| `/join/:meetingId` | Pre-join camera preview | No |
| `/meeting/:meetingId` | Live video call | No* |
| `/meeting/:meetingId/fraud-dashboard` | Full AI analytics | Yes |
| `/meeting/:meetingId/summary` | Post-meeting summary | No |

> *Meeting page validates LiveKit token server-side.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Login returns 500 error | `JWT_SECRET` missing | Add to `server/.env` |
| "ML Service unavailable" toast | Python service not running | Start `python ml_service.py` on port 5001 |
| Deepfake Guard shows "Connecting…" forever | Wrong ML URL in server env | Check `PYTHON_ML_SERVICE_URL` in `server/.env` |
| "View Full Fraud Dashboard" goes to 404 | Old code (fixed in latest) | Pull latest + rebuild |
| Camera not accessible | Not HTTPS or localhost | Use `https://localhost:5173` |
| "Too many requests" on login | Rate limiter (30 req / 15 min) | Wait 15 min or restart server |
| LiveKit fails immediately | Wrong credentials | Check `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` |
| Trust score always red | ML in fallback mode + poor lighting | Improve lighting; check if model file exists |
| ML model always shows "Fallback" | `deepfake_xgb_model.joblib` missing | Add model file to `ML_model/deepfake_detection/...` |
| Certificate warning in browser | Self-signed cert (normal) | Click Advanced → Proceed to localhost |
| Video works but chat is empty | Socket.IO not connecting | Check server logs for Socket.IO errors |
| Port already in use | Previous process still running | Kill existing process or change `PORT` in `.env` |
