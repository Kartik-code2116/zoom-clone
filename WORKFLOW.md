# ZoomClone — Complete Workflow & Architecture Guide

---

## Table of Contents

1.  [System Architecture Overview](#1-system-architecture-overview)
2.  [Infrastructure & Docker Services](#2-infrastructure--docker-services)
3.  [Frontend Route Map](#3-frontend-route-map)
4.  [Authentication Flow](#4-authentication-flow)
5.  [Meeting Creation Flow](#5-meeting-creation-flow)
6.  [Meeting Join Flow (Pre-join Preview)](#6-meeting-join-flow-pre-join-preview)
7.  [In-Meeting Flow (LiveKit + Socket.IO)](#7-in-meeting-flow-livekit--socketio)
8.  [Real-Time Chat Flow (Socket.IO)](#8-real-time-chat-flow-socketio)
9.  [Meeting End & Summary Flow](#9-meeting-end--summary-flow)
10. [Database Schema](#10-database-schema)
11. [API Routes Reference](#11-api-routes-reference)
12. [Frontend Component Tree](#12-frontend-component-tree)
13. [Data Flow Summary](#13-data-flow-summary)
14. [Technology Responsibility Map](#14-technology-responsibility-map)

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          USER'S BROWSER                                  │
│                                                                          │
│   ┌───────────────────────────────────────────────────────────────────┐  │
│   │             REACT FRONTEND  (Vite + TypeScript + Tailwind)         │ │
│   │                                                                    │ │
│   │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐    │ │
│   │  │  Auth Pages   │  │  Dashboard   │  │    Meeting Room        │   │ │
│   │  │ Login/Register│  │ Create/Join  │  │ LiveKit VideoConference│   │ │
│   │  └──────┬───────┘  └──────┬───────┘  └───────────┬───────-─────┘   │ │
│   │         │                 │                      │                 │ │
│   │         └─────────────────┴──────── axios ───────┘                 │ │
│   │                           │          (REST)                        │ │
│   │                    Socket.IO client ──────────────────────────┐    │ │
│   └───────────────────────────┼───────────────────────────────────┼────┘ │
└───────────────────────────────┼───────────────────────────────────┼──────┘
                                │ HTTP / REST API                   │ WebSocket
                                ▼                                   │
┌───────────────────────────────────────────────────────────────────┼──────┐
│                    NODE.JS / EXPRESS SERVER  (:5000)               │     │
│                                                                    │     │
│  ┌──────────────────┐   ┌──────────────────┐                       │     │
│  │   /api/auth       │   │  /api/meetings   │                      │     │
│  │  register / login │   │  create / token  │                      │     │
│  │  logout / me      │   │  list / end      │                      │     │
│  └────────┬─────────┘   └────────┬─────────┘                       │     │
│           │                      │                                 │     │
│           └──────────────────────┼───────────────────────────────  │     │
│                                  │                                 │     │
│  ┌────────────────────────────── │ ──────────────────────────────┐ │     │
│  │           JWT Auth Middleware │                               │ │     │
│  └────────────────────────────── │ ──────────────────────────────┘ │     │
│                                  │                                 │     │
│  ┌─────────────────┐   ┌─────────┴────────┐   ┌───────────────┐    │     │
│  │   Mongoose ODM  │   │  LiveKit SDK     │   │  Socket.IO    │◄--─┘     │
│  └────────┬────────┘   └─────────┬────────┘   └───────┬───────┘          │
└───────────┼────────────-─────────┼────────────────────┼──────────────────┘
            │                      │                    │
            ▼                      ▼                    ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│    MONGODB        │   │  LIVEKIT SERVER  │   │   SOCKET ROOMS   │
│    (:27017)       │   │  (:7880 ws/tcp)  │   │  (in-memory on   │
│                  │   │  (:7881 udp/tcp) │   │   Node process)  │
│  Users           │   │  (:7882 tcp)     │   │                  │
│  Meetings        │   │                  │   │  join-room       │
│  ChatMessages    │   │  WebRTC SFU      │   │  send-message    │
│                  │   │  (audio/video    │   │  receive-message │
│  (Docker volume) │   │   media relay)   │   │                  │
└──────────────────┘   └──────────────────┘   └──────────────────┘
       (Docker)                (Docker)
```

---

## 2. Infrastructure & Docker Services

```
docker-compose.yml
┌──────────────────────────────────────────────────────────────┐
│                     DOCKER COMPOSE                           │
│                                                              │
│  ┌─────────────────────────────────────────────────-────┐    │
│  │  SERVICE: livekit                                    │    │
│  │  image: livekit/livekit-server:latest                │    │
│  │  mode: --dev  (devkey / secret)                      │    │
│  │                                                      │    │
│  │  Ports:                                              │    │
│  │    7880/udp  ── WebRTC UDP media transport           │    │
│  │    7880/tcp  ── WebSocket signalling                 │    │
│  │    7881/udp  ── TURN / ICE candidates                │    │
│  │    7881/tcp  ── TURN / ICE candidates (TCP fallback) │    │
│  │    7882/tcp  ── RTC TCP (firewall bypass)            │    │
│  └───────────────────────────────────────────────-──────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  SERVICE: mongodb                                   │     │
│  │  image: mongo:7                                     │     │
│  │  Port: 27017                                        │     │
│  │  Volume: mongo-data:/data/db  (persistent)          │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                              │
│  Named Volume: mongo-data  (survives container restarts)     │
└──────────────────────────────────────────────────────────────┘

  Start everything:  docker compose up -d
  Backend:           cd server && npm run dev   → :5000
  Frontend:          cd client && npm run dev   → :5173
```

---

## 3. Frontend Route Map

```
React Router v6 — Routes defined in App.tsx
                        wrapped in <AuthProvider>

  /                    ──► Home.tsx            (public landing page)
  /login               ──► Login.tsx           (public)
  /register            ──► Register.tsx        (public)
  /dashboard           ──► Dashboard.tsx       (🔒 ProtectedRoute — needs JWT)
  /join/:meetingId     ──► JoinMeeting.tsx     (public — guests allowed)
  /meeting/:meetingId  ──► Meeting.tsx         (public — needs token in state)
  /meeting/:meetingId/summary ──► MeetingSummary.tsx  (public)
  *                    ──► NotFound.tsx

  Route Guard Logic (ProtectedRoute.tsx):
  ┌─────────────────────────────────────────────────────────┐
  │  AuthContext.loading === true  →  show <Spinner />      │
  │  user === null                 →  <Navigate to="/login">│
  │  user exists                   →  render {children}     │
  └─────────────────────────────────────────────────────────┘

  Navigation Paths:
  Home ──(Login)──► Login ──(success)──► Dashboard
  Home ──(Register)► Register ──(success)──► Dashboard
  Dashboard ──(New Meeting)──► JoinMeeting (pre-join)
  Dashboard ──(Join Code)──► JoinMeeting
  JoinMeeting ──(Join)──► Meeting (token passed via router state)
  Meeting ──(Leave/End)──► MeetingSummary
  MeetingSummary ──(Back)──► Dashboard
  MeetingSummary ──(Rejoin)──► JoinMeeting
```

---

## 4. Authentication Flow

```
┌──────────────┐         ┌──────────────────┐          ┌──────────────┐
│   Browser    │         │  Express Server  │          │   MongoDB    │
│  (React App) │         │    (:5000)       │          │  (:27017)    │
└──────┬───────┘         └────────┬─────────┘          └──────┬───────┘
       │                          │                           │
       │  ── REGISTER ──────────────────────────────────────  │
       │                          │                           │
       │  POST /api/auth/register  │                          │
       │  { name, email, password }│                          │
       │ ─────────────────────────►│                           │
       │                          │  User.findOne({ email })   │
       │                          │ ──────────────────────────►│
       │                          │◄── null (not exists) ──────│
       │                          │  bcrypt.hash(password, 10) │
       │                          │  User.create({...})        │
       │                          │ ──────────────────────────►│
       │                          │◄── saved User doc ─────────│
       │                          │  jwt.sign({ id, email })   │
       │◄─ 201 + Set-Cookie: token─│  (7d expiry)               │
       │   { user: {id,name,...} } │                            │
       │                          │                            │
       │  ── LOGIN ─────────────────────────────────────────── │
       │                          │                            │
       │  POST /api/auth/login     │                            │
       │  { email, password }      │                            │
       │ ─────────────────────────►│                            │
       │                          │  User.findOne({ email })   │
       │                          │ ──────────────────────────►│
       │                          │◄── User doc ───────────────│
       │                          │  bcrypt.compare(pwd, hash) │
       │                          │  jwt.sign({ id, email })   │
       │◄─ 200 + Set-Cookie: token─│                            │
       │   { user: {id,name,...} } │                            │
       │                          │                            │
       │  ── SESSION RESTORE (on app load) ───────────────────  │
       │                          │                            │
       │  GET /api/auth/me         │                            │
       │  [cookie: token auto-sent]│                            │
       │ ─────────────────────────►│                            │
       │                          │  jwt.verify(token)         │
       │                          │  User.findById(id)         │
       │                          │ ──────────────────────────►│
       │                          │◄── User doc ───────────────│
       │◄─ 200 { user }  ──────────│                            │
       │   AuthContext sets user   │                            │
       │                          │                            │
       │  ── LOGOUT ────────────────────────────────────────── │
       │                          │                            │
       │  POST /api/auth/logout    │                            │
       │ ─────────────────────────►│                            │
       │◄─ 200 + clearCookie ──────│                            │
       │   AuthContext sets null   │                            │
       │                          │                            │

  Cookie Properties:
  ┌──────────────────────────────────────────────────────────┐
  │  httpOnly: true   → JS cannot read it (XSS protection)   │
  │  secure: true     → HTTPS only (in production)           │
  │  sameSite: 'lax'  → CSRF protection                      │
  │  maxAge: 7 days   → Persistent session                   │
  └──────────────────────────────────────────────────────────┘
```

---

## 5. Meeting Creation Flow

```
┌──────────────┐      ┌──────────────────┐      ┌────────────┐      ┌───────────┐
│  Dashboard   │      │  Express Server  │      │  MongoDB   │      │  nanoid   │
│  (React)     │      │    (:5000)       │      │  (:27017)  │      │ (library) │
└──────┬───────┘      └────────┬─────────┘      └─────┬──────┘      └─────┬─────┘
       │                       │                      │                   │
       │  User clicks          │                       │                   │
       │  "New Meeting"         │                       │                   │
       │                       │                        │                   │
       │  POST /api/meetings    │                       │                   │
       │  [cookie: token]       │                       │                   │
       │  { title? }            │                       │                   │
       │ ──────────────────────►│                       │                   │
       │                       │ jwt.verify(token)      │                   │
       │                       │ auth middleware passes │                   │
       │                       │                       │   nanoid()        │
       │                       │ ──────────────────────────────────────────►│
       │                       │◄── "V1StGXR8_Z5jdHi6B-myT" (unique ID) ───│
       │                       │                       │                   │
       │                       │  Meeting.create({     │                   │
       │                       │    meetingId: nanoid, │                   │
       │                       │    hostId: user._id,  │                   │
       │                       │    title: "Instant.." │                   │
       │                       │    status: "active"   │                   │
       │                       │  })                   │                   │
       │                       │ ──────────────────────►│                   │
       │                       │◄── saved Meeting doc ──│                   │
       │◄── 201 { meeting } ───│                       │                   │
       │                       │                       │                   │
       │  navigate(`/join/${meetingId}`)                │                   │
       │  (redirect to pre-join page)                   │                   │
       │                       │                       │                   │

  Meeting Document created in MongoDB:
  ┌──────────────────────────────────────────┐
  │  {                                        │
  │    _id: ObjectId,                         │
  │    meetingId: "V1StGXR8_Z5jdHi6B-myT",  │
  │    hostId: ObjectId(user._id),            │
  │    title: "Instant Meeting",              │
  │    status: "active",                      │
  │    createdAt: Date,                       │
  │    endedAt: undefined                     │
  │  }                                        │
  └──────────────────────────────────────────┘

  Creating a Scheduled Meeting:
  ┌──────────────────────────────────────────────────────────┐
  │  Dashboard → "Schedule" button                             │
  │  ↓                                                       │
  │  Modal opens with:                                       │
  │    - Meeting name input                                  │
  │    - Date picker (min: today)                            │
  │    - Time picker                                         │
  │  ↓                                                       │
  │  POST /api/meetings                                      │
  │  { title, scheduledDate: "2026-04-10T14:30:00Z" }         │
  │  ↓                                                       │
  │  Server creates meeting with status: "scheduled"         │
  │  Returns meeting details                                 │
  │  ↓                                                       │
  │  Dashboard refreshes, showing "Scheduled" badge           │
  └──────────────────────────────────────────────────────────┘
```

---

## 6. Meeting Join Flow (Pre-join Preview)

```
┌──────────────┐        ┌──────────────────┐        ┌────────────────────┐
│ JoinMeeting  │        │  Express Server  │        │  LiveKit Server    │
│  (React)     │        │    (:5000)       │        │  ws://localhost:7880│
└──────┬───────┘        └────────┬─────────┘        └────────┬───────────┘
       │                         │                           │
       │  (1) Page Load          │                           │
       │  GET /api/meetings/:id  │                           │
       │ ───────────────────────►│                           │
       │◄── Meeting info (title, status) ────────────────────│
       │                         │                           │
       │  (2) Camera Preview     │                           │
       │  navigator.mediaDevices.getUserMedia({ video:true })│
       │  ◄── MediaStream (local camera, muted)              │
       │  Display in <video> element (mirrored -scale-x-100) │
       │                         │                           │
       │  (3) User enters name   │                           │
       │  clicks "Join Meeting"  │                           │
       │                         │                           │
       │  POST /api/meetings/:id/token                       │
       │  { identity: name, name: name }                     │
       │ ────────────────────────►│                          │
       │                         │  Meeting.findOne({        │
       │                         │    meetingId: :id         │
       │                         │  })                       │
       │                         │  check status !== "ended" │
       │                         │                           │
       │                         │  createLivekitToken(      │
       │                         │    roomName: meetingId,   │
       │                         │    identity: name,        │
       │                         │    name: name             │
       │                         │  )                        │
       │                         │ ─── AccessToken SDK ─────►│
       │                         │◄── signed JWT token ──────│
       │◄── 200 { token: "..." } │                           │
       │                         │                           │
       │  (4) Stop camera preview tracks                     │
       │                         │                           │
       │  (5) navigate(`/meeting/${meetingId}`, {            │
       │        state: { token, userName }                   │
       │      })                                             │
       │  Token travels in React Router location.state       │
       │  (never touches URL or localStorage)                │

  LiveKit Token Grants (server-side):
  ┌────────────────────────────────────────────────┐
  │  roomJoin:     true  → can join the room       │
  │  room:         meetingId                       │
  │  canPublish:   true  → can send audio/video    │
  │  canSubscribe: true  → can receive audio/video │
  └────────────────────────────────────────────────┘

  Guest Join (no account needed):
  ─────────────────────────────────
  Anyone with the URL /join/:meetingId can join.
  The token endpoint is PUBLIC (no auth middleware).
  They just need to provide a display name.
```

---

## 7. In-Meeting Flow (LiveKit + Socket.IO)

```
 Participant A                LiveKit SFU Server               Participant B
 (Browser)                   ws://localhost:7880               (Browser)
     │                              │                              │
     │  LiveKitRoom connects        │                              │
     │  token="JWT..."              │                              │
     │ ────────────────────────────►│                              │
     │◄── WebRTC handshake (ICE) ───│                              │
     │                              │                              │
     │  Publish Camera Track        │                              │
     │  (video + audio)             │                              │
     │ ────────── WebRTC ──────────►│                              │
     │                              │   Forward to subscribers     │
     │                              │ ────────── WebRTC ──────────►│
     │                              │                              │
     │  Publish Screen Share        │                              │
     │ ────────── WebRTC ──────────►│                              │
     │                              │ ────────── WebRTC ──────────►│
     │                              │                              │
     │  Toggle Mic (M key / button) │                              │
     │  localParticipant            │                              │
     │  .setMicrophoneEnabled(bool) │                              │
     │ ── track mute/unmute ───────►│                              │
     │                              │── notify all participants ──►│
     │                              │                              │

  LiveKit Room UI — @livekit/components-react
  ┌──────────────────────────────────────────────────────────────┐
  │  <LiveKitRoom serverUrl token connect onDisconnected>        │
  │    │                                                         │
  │    ├── <VideoConference />   ← handles grid layout,          │
  │    │      (built-in)            speaker detection,           │
  │    │                            video tiles                  │
  │    │                                                         │
  │    ├── <MeetingTimer />      ← custom component              │
  │    │                            reads sessionStorage join time│
  │    │                                                          │
  │    ├── <MeetingToolbar />    ← custom component              │
  │    │      useLocalParticipant()   mic/cam/screen controls    │
  │    │      useRoomContext()         leave/disconnect          │
  │    │                                                         │
  │    ├── <ChatPanel />         ← Socket.IO sidebar             │
  │    │                                                         │
  │    └── <ParticipantPanel />  ← useParticipants() hook        │
  └──────────────────────────────────────────────────────────────┘

  Toolbar Controls & Keyboard Shortcuts:
  ┌────────────────────────────────────────────────────────┐
  │  Button         Action                    Shortcut     │
  │  ───────────────────────────────────────────────────── │
  │  🎤 Mic         setMicrophoneEnabled()    M key        │
  │  📹 Camera      setCameraEnabled()        V key        │
  │  🖥️ Share       setScreenShareEnabled()   (click only) │
  │  💬 Chat        toggle ChatPanel sidebar  (click only) │
  │  👥 People      toggle ParticipantPanel   (click only) │
  │  🔗 Invite      copy join link            (click only) │
  │  📞 Leave       room.disconnect()         (click only) │
  └────────────────────────────────────────────────────────┘
```

---

## 8. Real-Time Chat Flow (Socket.IO)

```
 Browser (Participant)          Node.js Server             MongoDB
 ChatPanel.tsx                  socket.ts                 ChatMessage
      │                              │                         │
      │  (on component mount)        │                         │
      │  io() connect                │                         │
      │ ─ WebSocket upgrade ────────►│                         │
      │◄── "connect" event ──────────│                         │
      │                              │                         │
      │  emit("join-room", {         │                         │
      │    meetingId,                │                         │
      │    userName                  │                         │
      │  })                          │                         │
      │ ────────────────────────────►│                         │
      │                              │  socket.join(meetingId) │
      │                              │  (joins Socket.IO room) │
      │                              │                         │
      │  User types message,         │                         │
      │  presses Enter               │                         │
      │                              │                         │
      │  emit("send-message", {      │                         │
      │    meetingId,                │                         │
      │    senderName,               │                         │
      │    message                   │                         │
      │  })                          │                         │
      │ ────────────────────────────►│                         │
      │                              │  ChatMessage.create({   │
      │                              │    meetingId,           │
      │                              │    senderName,          │
      │                              │    message              │
      │                              │  })                     │
      │                              │ ───────────────────────►│
      │                              │◄── saved doc ───────────│
      │                              │                         │
      │                              │  io.to(meetingId)       │
      │                              │  .emit("receive-message"│
      │                              │    { senderName,        │
      │                              │      message,           │
      │                              │      timestamp })       │
      │◄── "receive-message" ────────│──► (all in room get it) │
      │    setMessages(prev => [...])│                         │
      │    scroll to bottom          │                         │
      │                              │                         │
      │  (on component unmount)      │                         │
      │  socket.disconnect()         │                         │
      │ ────────────────────────────►│                         │
      │                              │  "disconnect" logged    │

  Unread Message Indicator:
  ┌─────────────────────────────────────────────────────────┐
  │  onNewMessage callback fires when receive-message fires  │
  │  If chatOpen === false → setIsChatUnread(true)           │
  │  Toolbar chat button shows pulsing blue dot              │
  │  When chat opened → setIsChatUnread(false)               │
  └─────────────────────────────────────────────────────────┘
```

---

## 9. Meeting End & Summary Flow

```
  Host ends meeting:                    Participant leaves:
  ┌───────────────────────┐             ┌────────────────────────┐
  │ Toolbar "Leave" click  │             │ Toolbar "Leave" click   │
  │ room.disconnect()      │             │ room.disconnect()       │
  │         │              │             │          │              │
  │         └──────────────┤             │          └─────────────┤
  │ POST /api/meetings/    │             │  onDisconnected fires  │
  │   :id/end              │             │  (LiveKitRoom prop)    │
  │ [auth required]        │             │          │              │
  │         │              │             │          ▼              │
  │  check hostId matches  │             │  navigate to /summary  │
  │  meeting.status="ended"│             └────────────────────────┘
  │  meeting.endedAt = now │
  │         │              │
  │  navigate to /summary  │
  └───────────────────────┘

  MeetingSummary.tsx (post-meeting page):
  ┌────────────────────────────────────────────────────────────┐
  │                                                            │
  │  (1) Reads sessionStorage[`meeting_join_${meetingId}`]     │
  │      set when user first joined → calculates duration      │
  │                                                            │
  │  (2) Displays:                                             │
  │      ✅ "Meeting Ended"                                    │
  │      ⏱  Duration  (HH:MM:SS)                              │
  │      🆔 Meeting ID                                         │
  │                                                            │
  │  (3) Action buttons:                                       │
  │      [ Back to Dashboard ]  →  /dashboard                 │
  │      [ Rejoin Meeting    ]  →  /join/:meetingId            │
  │                                                            │
  └────────────────────────────────────────────────────────────┘

  Note: Ended meetings are still accessible via /join/:meetingId
  but the token endpoint returns 404 "Meeting has ended"
  preventing new participants from joining.
```

---

## 10. Database Schema

```
MongoDB Collections (Mongoose Models)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Collection: users
  ┌────────────────────────────────────────────────────────┐
  │  Field         Type        Notes                        │
  │  ──────────────────────────────────────────────────── │
  │  _id           ObjectId    auto-generated               │
  │  name          String      required                     │
  │  email         String      required, unique, lowercase  │
  │  passwordHash  String      bcrypt hash (10 rounds)      │
  │  createdAt     Date        default: Date.now            │
  └────────────────────────────────────────────────────────┘

  Collection: meetings
  ┌────────────────────────────────────────────────────────┐
  │  Field       Type        Notes                          │
  │  ────────────────────────────────────────────────────  │
  │  _id         ObjectId    auto-generated                 │
  │  meetingId   String      unique, nanoid() generated     │
  │  hostId      ObjectId    ref: 'User' (FK)               │
  │  title       String      default: "Instant Meeting"     │
  │  status      String      enum: ['active', 'ended',     │
  │                            'scheduled']               │
  │  scheduledDate Date        optional, for scheduled      │
  │  createdAt   Date        default: Date.now              │
  │  endedAt     Date        optional, set when ended       │
  └────────────────────────────────────────────────────────┘

  Collection: chatmessages
  ┌────────────────────────────────────────────────────────┐
  │  Field       Type        Notes                          │
  │  ────────────────────────────────────────────────────  │
  │  _id         ObjectId    auto-generated                 │
  │  meetingId   String      indexed, links to Meeting      │
  │  senderName  String      display name (not user ID)     │
  │  message     String      the chat text                  │
  │  timestamp   Date        default: Date.now              │
  └────────────────────────────────────────────────────────┘

  Relationships:
  ┌─────────────────────────────────────────────────────────────────┐
  │                                                                 │
  │   User (1) ──────────────────────────── (many) Meeting          │
  │                   hostId (ObjectId ref)                         │
  │                                                                 │
  │   Meeting (1) ───────────────────────── (many) ChatMessage      │
  │                   meetingId (String, indexed)                   │
  │                                                                 │
  │   Note: ChatMessage uses senderName (String), NOT a User ref.   │
  │   This allows guests without accounts to appear in chat.        │
  └─────────────────────────────────────────────────────────────────┘
```

---

## 11. API Routes Reference

```
BASE URL: http://localhost:5000/api

AUTH ROUTES  /api/auth
┌────────────────────────────────────────────────────────────────────┐
│  Method  Path         Auth?  Description                           │
│  ──────────────────────────────────────────────────────────────── │
│  POST    /register    No     Create account, set JWT cookie        │
│  POST    /login       No     Login, set JWT cookie                 │
│  POST    /logout      No     Clear JWT cookie                      │
│  GET     /me          Yes    Get current user from cookie          │
└────────────────────────────────────────────────────────────────────┘

MEETING ROUTES  /api/meetings
┌────────────────────────────────────────────────────────────────────┐
│  Method  Path              Auth?       Description                 │
│  ──────────────────────────────────────────────────────────────── │
│  POST    /                 Yes(host)   Create a new meeting        │
│           Body: { title?, scheduledDate? }                          │
│  GET     /                 Yes(host)   List host's meetings        │
│  GET     /:meetingId       No(public)  Get meeting info            │
│  POST    /:meetingId/token No(public)  Generate LiveKit JWT token  │
│  POST    /:meetingId/end   Yes(host)   End meeting (host only)     │
└────────────────────────────────────────────────────────────────────┘

Auth Middleware (JWT cookie verification):
  ┌──────────────────────────────────────────────────────────┐
  │  req.cookies.token  →  jwt.verify()  →  req.user.id      │
  │  Missing token  →  401 "No token provided"               │
  │  Invalid token  →  401 "Token is not valid"              │
  │  Valid token    →  next() (passes to route handler)      │
  └──────────────────────────────────────────────────────────┘

SOCKET.IO EVENTS
┌────────────────────────────────────────────────────────────────────┐
│  Direction    Event             Payload                            │
│  ────────────────────────────────────────────────────────────────  │
│  Client→Srv   join-room         { meetingId, userName }           │
│  Client→Srv   send-message      { meetingId, senderName, message } │
│  Srv→Clients  receive-message   { meetingId, senderName,          │
│                                   message, timestamp }            │
└────────────────────────────────────────────────────────────────────┘
```

---

## 12. Frontend Component Tree

```
main.tsx
└── <BrowserRouter>
    └── <App>
        └── <AuthProvider>   (provides user, login, logout, register)
            │
            ├── <Route path="/">          → <Home />
            │       └── <Navbar />
            │
            ├── <Route path="/login">     → <Login />
            │       └── <Navbar />
            │
            ├── <Route path="/register">  → <Register />
            │       └── <Navbar />
            │
            ├── <Route path="/dashboard"> → <ProtectedRoute>
            │       └── <Dashboard />
            │             ├── <Navbar />
            │             ├── "New Meeting" button
            │             ├── "Join Meeting" input
            │             └── Meetings list (map)
            │
            ├── <Route path="/join/:meetingId"> → <JoinMeeting />
            │       ├── <Navbar />
            │       ├── <video> (camera preview, muted)
            │       └── Join form (display name input + button)
            │
            ├── <Route path="/meeting/:meetingId"> → <Meeting />
            │       └── <LiveKitRoom serverUrl token onDisconnected>
            │             ├── <VideoConference />    (LiveKit built-in)
            │             │      └── Resizes when panels open (margin-right adjustment)
            │             ├── <MeetingTimer />
            │             │       └── reads sessionStorage join time
            │             ├── <MeetingToolbar />
            │             │       ├── useLocalParticipant()
            │             │       ├── useRoomContext()
            │             │       ├── Mic / Cam / Screen buttons
            │             │       ├── Chat / Participants / Guard toggles
            │             │       ├── Draggable handle (when unpinned)
            │             │       ├── Dynamic positioning (shifts left when panels open)
            │             │       ├── Copy Invite Link
            │             │       └── Leave button
            │             ├── <ChatPanel />
            │             │       ├── Socket.IO client (io())
            │             │       ├── Resizable from left edge (280-600px)
            │             │       ├── Draggable when unpinned
            │             │       ├── Messages list
            │             │       └── Input + send button
            │             ├── <ParticipantPanel />
            │             │       ├── useParticipants() (LiveKit hook)
            │             │       ├── Resizable from left edge (280-600px)
            │             │       ├── Draggable when unpinned
            │             │       └── Dynamic host badge via metadata
            │             ├── <DeepfakeMonitor />
            │             │       ├── MediaPipe Face Mesh analysis
            │             │       ├── Resizable (width: 200-400px, height: 300-600px)
            │             │       ├── Draggable header
            │             │       ├── Sparkline trust score chart
            │             │       └── Real-time participant count
            │             └── <FraudDashboardPanel />
            │                     ├── Resizable from left edge (280-600px)
            │                     ├── Real-time participant tracking
            │                     └── Trust score timeline chart
            │
            └── <Route path="/meeting/:meetingId/summary">
                    └── <MeetingSummary />
                          ├── <Navbar />
                          ├── Duration display
                          ├── Meeting ID
                          └── [ Back to Dashboard ] [ Rejoin ]
```

---

## 13. Data Flow Summary

```
  Complete end-to-end flow for a typical meeting session:

  ① USER OPENS APP
     Browser → GET /api/auth/me (auto, via AuthContext useEffect)
     Server verifies httpOnly cookie → returns user or 401
     AuthContext sets user state (or null → redirect to /login)

  ② USER LOGS IN / REGISTERS
     Browser → POST /api/auth/login or /register
     Server → bcrypt verify → jwt.sign → Set-Cookie: token
     AuthContext.user = { id, name, email }
     React Router → navigate('/dashboard')

  ③ CREATE MEETING
     Dashboard → POST /api/meetings  [auth cookie]
     Server → nanoid() → Meeting.create() → return meetingId
     Dashboard → navigate('/join/:meetingId')

  ④ PRE-JOIN SCREEN
     JoinMeeting loads → GET /api/meetings/:id (fetch meeting info)
     Browser → getUserMedia({ video: true }) → live preview
     User enters name → POST /api/meetings/:id/token
     Server → AccessToken SDK → signed JWT for LiveKit room
     navigate('/meeting/:id', { state: { token, userName } })

  ⑤ ENTER MEETING ROOM
     Meeting.tsx reads token from location.state
     <LiveKitRoom> connects → WebRTC handshake with LiveKit SFU
     Video/audio tracks published & subscribed via WebRTC
     ChatPanel mounts → Socket.IO connects → joins socket room

  ⑥ DURING MEETING
     Audio/Video:  WebRTC peer tracks ←→ LiveKit SFU ←→ all peers
     Chat:         emit("send-message") → server saves to MongoDB
                   → io.to(roomId).emit("receive-message") → all panels
     Controls:     Mic/Cam toggled via LiveKit SDK
                   Screen share via setScreenShareEnabled()
                   Keyboard shortcuts: M (mic), V (video)

  ⑦ LEAVE MEETING
     Toolbar "Leave" → room.disconnect() → onDisconnected fires
     Host can also POST /api/meetings/:id/end to mark status="ended"
     navigate('/meeting/:id/summary')

  ⑧ SUMMARY PAGE
     Reads sessionStorage join time → calculates duration
     Options: Back to Dashboard  |  Rejoin Meeting
```

---

## 14. Technology Responsibility Map

```
┌───────────────────────────────────────────────────────────────────────┐
│  Technology        What it does in this project                       │
│  ───────────────────────────────────────────────────────────────────  │
│                                                                       │
│  React 18          UI rendering, routing (react-router-dom v6),       │
│                    state management (useState, useContext, useEffect) │
│                                                                       │
│  Vite              Ultra-fast dev server + build tool for frontend    │
│                    Proxies /api → :5000, /socket.io → :5000           │
│                                                                       │
│  TypeScript        Type safety across both client and server          │
│                                                                       │
│  TailwindCSS       Utility-first dark-mode UI styling                 │
│                                                                       │
│  Axios             HTTP client for REST API calls (withCredentials)   │
│                                                                       │
│  Express.js        REST API server (auth routes + meeting routes)     │
│                    Hosts both REST and Socket.IO on same http.Server  │
│                                                                       │
│  JWT               Stateless auth tokens stored in httpOnly cookies   │
│                    Signed with JWT_SECRET, 7-day expiry               │
│                                                                       │
│  bcryptjs          Password hashing (10 salt rounds) before storage   │
│                                                                       │
│  MongoDB           Persistent storage for users, meetings, chat msgs  │
│                                                                       │
│  Mongoose          ODM — schema validation + queries for MongoDB      │
│                                                                       │
│  LiveKit           WebRTC SFU (Selective Forwarding Unit)             │
│  (Server)          Routes audio/video tracks between participants     │
│                    Self-hosted in Docker, dev mode (no TURN config)   │
│                                                                       │
│  LiveKit SDK       Server-side: AccessToken generation                │
│  (livekit-server-  Grants: roomJoin, canPublish, canSubscribe         │
│   sdk)                                                                │
│                                                                       │
│  @livekit/         Client React components: <LiveKitRoom>,            │
│  components-react  <VideoConference> + hooks: useLocalParticipant,    │
│                    useRoomContext, useParticipants                    │
│                                                                       │
│  Socket.IO         Bidirectional real-time chat within meeting rooms  │
│  (server)          Stores messages to MongoDB before broadcasting     │
│                                                                       │
│  Socket.IO         Client-side chat panel: connect, join-room,        │
│  (client)          send-message, receive-message events               │
│                                                                       │
│  lucide-react      Icon library for UI (Shield, Activity, Users, etc) │
│                                                                       │
│  nanoid            Generates short unique meeting IDs (URL-safe)      │
│                                                                       │
│  Docker Compose    Orchestrates LiveKit server + MongoDB containers   │
│                    Persistent volume for MongoDB data                 │
│                                                                       │
│  cookie-parser     Express middleware to read httpOnly JWT cookies    │
│                                                                       │
│  dotenv            Loads .env variables into process.env              │
└───────────────────────────────────────────────────────────────────────┘
```

---

*Generated from full source analysis of zoom-clone project.*