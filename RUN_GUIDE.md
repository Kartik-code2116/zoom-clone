# Complete Project Setup Guide

## Project Overview
Zoom Clone with Deepfake Detection - A video conferencing platform with ML-powered deepfake detection.

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
         │              │  (Port 5001)    │
         │              └─────────────────┘
         ▼
┌─────────────────┐
│  LiveKit Server │
│  (Port 7880)    │
└─────────────────┘
```

## Prerequisites
1. **Node.js** (v18+) - https://nodejs.org
2. **MongoDB** - https://mongodb.com (or use MongoDB Atlas cloud)
3. **Python 3.10+** - https://python.org (for ML service)

---

## Step 1: Start MongoDB

### Option A: Local MongoDB
```bash
# Windows (if MongoDB is installed as service)
net start MongoDB

# Or start manually
"C:\Program Files\MongoDB\Server\7.0\bin\mongod.exe" --dbpath "C:\data\db"
```

### Option B: MongoDB Atlas (Cloud)
1. Create account at https://cloud.mongodb.com
2. Create a cluster
3. Get connection string: `mongodb+srv://username:password@cluster.mongodb.net/zoom-clone`
4. Update `server/.env` with this URI

### Verify MongoDB
```bash
# Should show port 27017 listening
Get-NetTCPConnection -LocalPort 27017
```

---

## Step 2: Start LiveKit Server

### Automatic Setup (Windows)
Run the LiveKit server we already downloaded:
```powershell
cd $env:TEMP\livekit
$env:LIVEKIT_KEYS="devkey: secret"
.\livekit-server.exe --dev
```

### Or Download Fresh
```powershell
mkdir $env:TEMP\livekit
cd $env:TEMP\livekit
Invoke-WebRequest -Uri "https://github.com/livekit/livekit/releases/latest/download/livekit-server_windows_amd64.zip" -OutFile "livekit.zip"
Expand-Archive livekit.zip -DestinationPath .
$env:LIVEKIT_KEYS="devkey: secret"
.\livekit-server.exe --dev
```

### Verify LiveKit
```bash
# Should show port 7880 listening
Get-NetTCPConnection -LocalPort 7880
```

---

## Step 3: Start Node.js Backend

```bash
cd server

# Install dependencies (first time only)
npm install

# Copy environment variables (first time only)
copy .env.example .env

# Start server
npm run dev
```

**Backend will run at:** http://localhost:5000

---

## Step 4: Start React Frontend

Open a new terminal:
```bash
cd client

# Install dependencies (first time only)
npm install

# Copy environment variables (first time only)
copy .env.example .env

# Start development server
npm run dev
```

**Frontend will run at:** https://localhost:5173

---

## Step 5: Start ML Service (Optional - for Deepfake Detection)

Open a new terminal:
```bash
cd ML_model

# Windows
start-ml-service.bat

# Or Linux/Mac
./start-ml-service.sh
```

**ML Service will run at:** http://localhost:5001

---

## Environment Variables

### Server (.env)
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/zoom-clone
JWT_SECRET=your_jwt_secret_key_here
CLIENT_URL=http://localhost:5173
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
LIVEKIT_URL=ws://localhost:7880
PYTHON_ML_SERVICE_URL=http://localhost:5001
```

### Client (.env)
```env
VITE_LIVEKIT_URL=ws://localhost:7880
```

---

## Verify All Services

Run in PowerShell:
```powershell
Get-NetTCPConnection -LocalPort 5000,5173,7880,27017,5001 | 
    Select-Object LocalPort, State | Sort-Object LocalPort
```

Expected output:
```
LocalPort  State
---------  -----
     5000 Listen    # Backend
     5001 Listen    # ML Service (optional)
     5173 Listen    # Frontend
     7880 Listen    # LiveKit
    27017 Listen    # MongoDB
```

---

## Access the Application

1. Open browser: **https://localhost:5173**
2. Accept the self-signed certificate warning
3. Register a new account or login
4. Create or join a meeting

---

## Troubleshooting

### "Connection Refused" on Login
- Backend server is not running. Start it with `npm run dev` in server folder.

### "No navigator.mediaDevices.getUserMedia exists"
- Using HTTP instead of HTTPS. The Vite dev server uses HTTPS by default.
- Accept the certificate warning in browser.

### "WebSocket connection failed" / "401 Authentication"
- LiveKit server not running or wrong credentials.
- Check LIVEKIT_API_KEY and LIVEKIT_API_SECRET match in server and LiveKit.

### Camera not working
- Check browser permissions
- Ensure you're on HTTPS (not HTTP)
- Try refreshing the page

### ML Service not responding
- Check Python 3.10+ is installed
- Check port 5001 is available
- Review ML_INTEGRATION.md for details

---

## Quick Start Script (Windows)

Create `start-all.bat`:
```batch
@echo off
echo Starting all services...

:: Start MongoDB (if not running as service)
:: net start MongoDB

:: Start LiveKit in new window
start "LiveKit Server" cmd /k "cd %TEMP%\livekit && set LIVEKIT_KEYS=devkey: secret && livekit-server.exe --dev"

:: Start Backend
cd server
start "Backend Server" cmd /k "npm run dev"
cd ..

:: Start Frontend
cd client
start "Frontend Server" cmd /k "npm run dev"
cd ..

echo All services starting...
echo Access the app at: https://localhost:5173
pause
```

---

## Project Structure
```
zoom-clone/
├── client/          # React frontend
├── server/          # Node.js backend
├── ML_model/        # Python deepfake detection
├── README.md        # Main documentation
├── ML_INTEGRATION.md # ML service details
└── RUN_GUIDE.md     # This file
```

## Need Help?
- Check `README.md` for architecture details
- Check `ML_INTEGRATION.md` for ML service details
- Review server logs in terminal for errors
