# Complete Project Setup Guide

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   React Client  │────▶│  Node.js API    │────▶│   MongoDB       │
│   (Port 5173)   │     │   (Port 5000)   │     │   (Port 27017)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │
         │                       ▼
         │              ┌─────────────────┐
         │              │  Python ML      │
         │              │  Service        │
         │              │  (Port 5001)    │
         │              └─────────────────┘
         ▼
┌─────────────────┐
│  LiveKit Cloud  │
│  (wss://...)    │
└─────────────────┘
```

## Prerequisites

- **Node.js** v18+
- **MongoDB** (local or Atlas)
- **Python 3.10+** (for ML service)

---

## Environment Setup (do this once)

### Server — `server/.env`
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/zoom-clone
JWT_SECRET=change_this_to_a_long_random_string_in_production
CLIENT_URL=http://localhost:5173
MOBILE_URL=http://localhost:5174

# Your actual LiveKit Cloud credentials
LIVEKIT_API_KEY=APIFeCwrTYTucz6
LIVEKIT_API_SECRET=hBBCNtgSG4lk8pbXAvNRGLrkQRi2Kz8sDS0iYcN7bbH
LIVEKIT_URL=wss://zoom-clone-2jil3ca0.livekit.cloud

PYTHON_ML_SERVICE_URL=http://localhost:5001
```

> **Security:** Never commit `.env` files — they are in `.gitignore`.

### Client — `client/.env`
```env
VITE_LIVEKIT_URL=wss://zoom-clone-2jil3ca0.livekit.cloud
```

---

## Step 1: Start MongoDB

```bash
# Windows service
net start MongoDB

# Or Docker (simplest)
docker compose up mongodb -d
```

---

## Step 2: Start Node.js Backend

```bash
cd server
npm install          # first time only — installs express-rate-limit and others
npm run dev
```

Runs at http://localhost:5000

---

## Step 3: Start Python ML Service

```bash
cd ML_model

# Activate venv
venv\Scripts\activate          # Windows
# or: source venv/bin/activate  # Mac/Linux

# Install deps (first time)
pip install -r requirements.txt

# Start
python ml_service.py
```

Runs at http://localhost:5001

> The ML service runs in **fallback mode** if the XGBoost model file
> (`deepfake_xgb_model.joblib`) is not present — it still works using
> image quality heuristics.

---

## Step 4: Start React Frontend

```bash
cd client
npm install     # first time only
npm run dev
```

Runs at http://localhost:5173

---

## Step 5 (optional): Run all via Docker

```bash
# From project root — starts MongoDB, LiveKit, Node server, ML service
docker compose up --build
```

> The client is not containerised — run it separately with `npm run dev`.

---

## Verify all services

```powershell
# Windows PowerShell
Get-NetTCPConnection -LocalPort 5000,5001,5173,27017 |
  Select-Object LocalPort, State | Sort-Object LocalPort
```

Expected:
```
LocalPort  State
---------  -----
     5000  Listen   # Node server
     5001  Listen   # ML service
     5173  Listen   # React client
    27017  Listen   # MongoDB
```

---

## Quick start script (Windows)

```batch
@echo off
echo Starting Zoom Clone...

:: MongoDB
net start MongoDB

:: Backend
cd server
start "Backend" cmd /k "npm run dev"
cd ..

:: ML Service
cd ML_model
start "ML Service" cmd /k "venv\Scripts\activate && python ml_service.py"
cd ..

:: Frontend
cd client
start "Frontend" cmd /k "npm run dev"
cd ..

echo Open http://localhost:5173
pause
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Login fails with 500 | `JWT_SECRET` not set in `server/.env` |
| ML model shows "Initializing..." forever | ML service not running on port 5001 |
| DeepFake Guard shows results but ML panel empty | Check `PYTHON_ML_SERVICE_URL` in `server/.env` |
| Camera not working | Must be on HTTPS or localhost; check browser permissions |
| "Too many requests" on login | Rate limiter — wait 15 min or restart server in dev |
| LiveKit connection fails | Check `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` in `.env` |

---

## Project Structure

```
zoom-clone/
├── client/           # React + Vite + Tailwind frontend
│   ├── src/
│   │   ├── components/   # DeepfakeMonitor, ErrorBoundary, etc.
│   │   ├── pages/        # Meeting, FraudDashboard, etc.
│   │   └── services/     # API client
│   └── .env
├── server/           # Express + TypeScript + Socket.IO backend
│   ├── src/
│   │   ├── routes/       # auth, meetings, deepfake
│   │   ├── models/       # User, Meeting, DeepfakeLog, ChatMessage
│   │   ├── middleware/   # auth JWT
│   │   ├── utils/        # livekit token generator
│   │   └── socket.ts     # real-time chat + room events
│   ├── Dockerfile
│   └── .env
├── ML_model/         # Python Flask deepfake detection service
│   ├── ml_service.py
│   ├── requirements.txt
│   └── Dockerfile
└── docker-compose.yml
```
