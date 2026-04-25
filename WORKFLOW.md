# SecureMeet — Complete Workflow

This document explains the full data and control flow of the application — from user login to a completed meeting with AI deepfake analysis.

---

## 1. Authentication Flow

```
User fills Login form
        │
        ▼
POST /api/auth/login
        │
        ├── bcrypt.compare(password, hash)
        ├── JWT signed (1 day expiry)
        └── JWT set as httpOnly cookie (XSS-safe)
                │
                ▼
        Client redirected to /dashboard
        AuthContext stores user object in React state
```

**Password rules:** minimum 8 characters (enforced both client and server-side).

**Rate limiting:** 30 auth attempts per 15 minutes per IP.

---

## 2. Meeting Creation & Joining

### Create (from Dashboard)
```
Click "New Meeting"
        │
        ▼
POST /api/meetings
        ├── Creates Meeting document in MongoDB
        │   { title, hostId, status: "active", meetingId: uuid }
        └── Returns meetingId
                │
                ▼
Navigate to /join/{meetingId}
```

### Join
```
/join/{meetingId}  (JoinMeeting.tsx)
        │
        ├── Shows camera preview (getUserMedia)
        ├── Lists available camera devices
        └── User clicks "Join Meeting"
                │
                ▼
POST /api/meetings/{meetingId}/token
        ├── Server calls LiveKit.AccessToken.toJwt()
        ├── Token includes identity + room name
        └── Returns { token }
                │
                ▼
Navigate to /meeting/{meetingId}
State: { token, userName }
```

---

## 3. Live Meeting Flow

```
Meeting.tsx mounts
        │
        ├── Connects to LiveKit SFU with token
        ├── Publishes local camera + mic tracks
        ├── Subscribes to remote participant tracks
        │
        ├── If deepfakeGuardEnabled (from settings):
        │       └── Renders <DeepfakeMonitor />
        │
        ├── Chat: connects Socket.IO → joins room
        │
        └── Renders:
              ├── <MeetingHeader />      (top overlay)
              ├── LiveKit <VideoConference /> (grid)
              ├── <MeetingToolbar />     (bottom bar)
              ├── <ChatPanel />          (right panel, if open)
              ├── <ParticipantPanel />   (right panel, if open)
              ├── <FraudDashboardPanel />(right panel, if open)
              └── <DeepfakeMonitor />    (floating overlay)
```

---

## 4. AI Deepfake Detection Flow

```
DeepfakeMonitor.tsx
        │
        ├── MediaPipe Face Mesh initialises
        ├── requestAnimationFrame loop — processes every 3rd frame
        │
        ├── For each processed frame:
        │       ├── EAR (Eye Aspect Ratio) → blink count + rate
        │       ├── Nose-to-cheek ratio → gaze direction
        │       ├── Landmark jitter → micro-movements score
        │       └── Behavioural TrustScore calculated (0–100)
        │
        ├── Every 5 seconds:
        │       └── analyzeFrameWithML(canvas, meetingId, participantId)
        │               │
        │               ▼
        │       POST /api/deepfake/analyze  (Node.js, rate-limited 5/sec)
        │               │
        │               ▼
        │       POST http://localhost:5001/analyze-frame  (Python ML)
        │               │
        │               ├── Haar Cascade face detection
        │               ├── Accumulate frame into session buffer
        │               ├── If ≥ 10 frames: run full pipeline
        │               │       ├── Blink detection (EAR)
        │               │       ├── Head pose (yaw/pitch/roll)
        │               │       ├── ResNet50 CNN features
        │               │       └── XGBoost fusion → label + confidence
        │               └── Return prediction + trust_score + features
        │
        ├── Final TrustScore = Behavioural × 0.30 + ML × 0.70
        │
        ├── If TrustScore < 40 → isLikelyFake = true
        │       ├── Red border on monitor panel
        │       ├── Red alert badge on Guard button in toolbar
        │       └── Evidence snapshot captured
        │
        └── Every 5 seconds: POST /api/deepfake/log → MongoDB
```

---

## 5. Chat Flow

```
ChatPanel.tsx
        │
        ├── socket = io()  (connects to Node.js Socket.IO)
        ├── Emits "join-room" → server joins socket to meetingId room
        │
        └── User sends message:
                │
                ▼
        Emit "send-message" { meetingId, senderName, message }
                │
                ▼
        socket.ts (server)
                ├── Validates message length (max 4000 chars)
                ├── ChatMessage.create() → MongoDB
                └── io.to(meetingId).emit("receive-message")
                        │
                        ▼
                All clients in room receive message
                Unread badge appears on Chat button if panel is closed
```

---

## 6. Fraud Dashboard Flow

### Live panel (during meeting)
```
Guard button clicked in toolbar
        │
        ▼
FraudDashboardPanel opens (slide-in from right)
        │
        ├── GET /api/deepfake/logs/{meetingId}
        ├── Auto-refresh every 5 seconds
        ├── Groups logs by participantId
        ├── Calculates avg trust score per participant
        └── "View Full Fraud Dashboard" → /meeting/{meetingId}/fraud-dashboard
```

### Full analytics page
```
/meeting/{meetingId}/fraud-dashboard
        │
        ├── GET /api/deepfake/logs/{meetingId}
        ├── Summary cards: total logs, ML detections, flagged events, avg/min trust
        ├── Recharts LineChart — trust score over time
        │       ├── Reference line at 40% (danger threshold)
        │       └── Reference line at 70% (caution threshold)
        ├── Detection cards — each with:
        │       ├── Behavioural metrics (gaze, blink rate, micro-movements)
        │       ├── ML label + confidence
        │       ├── Real/Fake probability bars
        │       └── Evidence snapshot (click to expand)
        └── Export buttons: JSON / CSV
```

---

## 7. Meeting End Flow

```
User clicks "Leave" in toolbar
        │
        ▼
room.disconnect()  (LiveKit)
        │
        ├── PATCH /api/meetings/{meetingId}  (status → ended)
        └── Navigate to /meeting/{meetingId}/summary
                │
                ▼
MeetingSummary.tsx
        ├── Reads join timestamp from sessionStorage
        ├── Calculates duration (HH:MM:SS)
        └── Shows "Back to Dashboard" and "Rejoin Meeting" buttons
```

---

## 8. Data Models

### User
```typescript
{
  name: string          // Display name
  email: string         // Unique
  password: string      // bcrypt hashed
  avatar?: string
  createdAt: Date
}
```

### Meeting
```typescript
{
  meetingId: string     // UUID — used in all URLs
  title: string
  hostId: ObjectId      // ref: User
  status: 'scheduled' | 'active' | 'ended'
  scheduledAt?: Date
  participants: ObjectId[]
  createdAt: Date
}
```

### DeepfakeLog
```typescript
{
  meetingId: string
  participantId?: string
  userId?: ObjectId
  trustScore: number         // 0–100 fused score
  isLikelyFake: boolean      // trustScore < 40
  gazeDirection: string      // center|left|right|up|down|unknown
  blinkRatePerMin: number
  microMovementsScore: number
  gazeShiftFrequency: number
  snapshotJpegDataUrl?: string  // only saved when isLikelyFake=true
  mlLabel?: string           // "real" | "fake"
  mlConfidence?: number      // 0–1
  mlProbabilities?: { real: number; fake: number }
  mlFeatures?: { total_blinks, blink_rate, interval_cv, yaw_variance, ... }
  frameMetrics?: { ear, blink_detected, yaw?, pitch? }
  createdAt: Date
}
```

### ChatMessage
```typescript
{
  meetingId: string
  senderName: string
  message: string       // max 4000 chars (enforced server-side)
  timestamp: Date
}
```

---

## 9. Security Architecture

```
Browser
  ├── JWT in httpOnly cookie  (not accessible to JavaScript → XSS-safe)
  ├── HTTPS only (Vite dev server with self-signed cert)
  └── Camera access requires HTTPS or localhost

Node.js Server
  ├── CORS: only CLIENT_URL and MOBILE_URL allowed
  ├── Rate limiting: 30 auth req/15min, 5 ML frames/sec
  ├── All /api/deepfake/* routes require valid JWT
  └── Host-only meeting termination validated server-side

Python ML Service
  ├── CORS: only http://localhost:5000 (Node server) allowed
  ├── Not exposed to frontend directly
  └── Session data in-memory only (never written to disk)
```

---

## 10. Component Dependency Map

```
App.tsx
 ├── AuthProvider (context/AuthContext.tsx)
 ├── ErrorBoundary
 └── Routes
      ├── Home.tsx
      ├── Login.tsx
      ├── Register.tsx
      ├── Dashboard.tsx ────────────── api.ts (meetings CRUD)
      ├── JoinMeeting.tsx ──────────── api.ts (getMeetingToken)
      ├── Meeting.tsx
      │    ├── MeetingHeader.tsx
      │    ├── MeetingToolbar.tsx
      │    ├── DeepfakeMonitor.tsx ─── api.ts (/deepfake/analyze + /log)
      │    ├── FraudDashboardPanel.tsx  api.ts (/deepfake/logs)
      │    ├── ChatPanel.tsx ─────────  socket.io
      │    ├── ParticipantPanel.tsx
      │    └── MeetingSettingsModal.tsx
      ├── FraudDashboard.tsx ────────── api.ts (/deepfake/logs)
      └── MeetingSummary.tsx
```
