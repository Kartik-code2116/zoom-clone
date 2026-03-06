# ZoomClone - Video Conferencing Platform

A full-featured video conferencing platform built with React, Node.js, LiveKit, and MongoDB.

## Tech Stack

- **Frontend:** React + Vite + TypeScript + TailwindCSS
- **Backend:** Node.js + Express + TypeScript
- **Video/Audio:** LiveKit (self-hosted via Docker)
- **Real-time Chat:** Socket.IO
- **Database:** MongoDB
- **Auth:** JWT (httpOnly cookies)

## Prerequisites

- Node.js 18+
- Docker & Docker Compose
- npm

## Quick Start

### 1. Start Docker services (LiveKit + MongoDB)

```bash
cd zoom-clone
docker compose up -d
```

This starts:
- **LiveKit server** on `ws://localhost:7880` (dev mode, key: `devkey`, secret: `secret`)
- **MongoDB** on `localhost:27017`

### 2. Start the backend server

```bash
cd server
npm install   # already done if you cloned fresh
npm run dev
```

Server runs on `http://localhost:5000`

### 3. Start the frontend

```bash
cd client
npm install   # already done if you cloned fresh
npm run dev
```

Frontend runs on `http://localhost:5173`

### 4. Open the app

Visit `http://localhost:5173` in your browser.

## Features (Phase 1)

- ✅ User registration & login (JWT + httpOnly cookies)
- ✅ Instant meeting creation with unique shareable links
- ✅ LiveKit-powered video/audio conferencing
- ✅ Grid layout with speaker detection
- ✅ Mute/unmute mic & camera controls
- ✅ Screen sharing
- ✅ In-meeting real-time chat (Socket.IO)
- ✅ Participant list with mic/camera status
- ✅ Meeting timer
- ✅ Copy invite link
- ✅ Keyboard shortcuts (M = mic, V = video)
- ✅ Pre-join camera preview
- ✅ Post-meeting summary page
- ✅ Dark mode UI with Zoom-style toolbar
- ✅ Guest join via link (no account needed)

## Project Structure

```
zoom-clone/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/          # Route pages
│   │   ├── context/        # Auth context
│   │   ├── services/       # API client
│   │   └── utils/          # Toast helpers
│   └── ...configs
├── server/                 # Express backend
│   ├── src/
│   │   ├── models/         # Mongoose schemas
│   │   ├── routes/         # API routes
│   │   ├── middleware/      # Auth middleware
│   │   └── utils/          # LiveKit token generation
│   └── ...configs
├── docker-compose.yml      # LiveKit + MongoDB
└── README.md
```

## Environment Variables

Server environment variables are in `server/.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 5000 | Server port |
| MONGODB_URI | mongodb://localhost:27017/zoom-clone | MongoDB connection |
| JWT_SECRET | (set in .env) | JWT signing secret |
| LIVEKIT_API_KEY | devkey | LiveKit API key |
| LIVEKIT_API_SECRET | secret | LiveKit API secret |
| LIVEKIT_URL | ws://localhost:7880 | LiveKit server URL |
| CLIENT_URL | http://localhost:5173 | Frontend URL (CORS) |
