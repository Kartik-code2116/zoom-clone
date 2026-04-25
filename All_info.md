# SecureMeet Android App - Complete Development Guide

## 1. APP OVERVIEW

**App Name:** SecureMeet (Zoom Clone with AI Deepfake Detection)
**Platform:** Android (Android Studio - Kotlin)
**Backend:** Node.js + MongoDB + Python ML Service
**Video Service:** LiveKit Cloud (WebRTC)

SecureMeet is a full-featured video conferencing Android app with real-time AI deepfake detection, fraud monitoring dashboard, and end-to-end encrypted communication.

---

## 2. TOTAL SCREENS / PAGES (10 Screens)

| # | Screen | Purpose | Auth Required |
|---|--------|---------|---------------|
| 1 | **SplashScreen** | App launch, logo animation | No |
| 2 | **LoginScreen** | User login with email/password | No |
| 3 | **RegisterScreen** | User registration | No |
| 4 | **HomeScreen** | Landing page with feature highlights | No |
| 5 | **DashboardScreen** | User's meeting hub - create/join/schedule meetings | Yes |
| 6 | **JoinMeetingScreen** | Pre-join camera preview, settings selection | No (for guests) |
| 7 | **MeetingScreen** | Main video conference room | Yes/No (guests allowed) |
| 8 | **MeetingSummaryScreen** | Post-meeting stats and duration | Yes/No |
| 9 | **FraudDashboardScreen** | AI detection results, trust scores, evidence | Yes |
| 10 | **ProfileScreen** | User profile management, settings | Yes |

---

## 3. ALL FEATURES (Categorized)

### 3.1 Authentication & User Management
- Email/password registration with validation
- JWT-based authentication (httpOnly cookies)
- Auto-login with token persistence
- Password hashing with bcrypt
- Profile management (name update)
- Guest mode support (join without account)

### 3.2 Video Conferencing (Core)
- **LiveKit WebRTC integration** - HD video/audio
- Grid layout with automatic speaker detection
- Mute/unmute microphone
- Enable/disable camera
- Multi-camera support (switch between front/back)
- Screen sharing capability
- Picture-in-picture mode
- Meeting timer display
- Speaker view / Gallery view toggle
- Audio-only mode option

### 3.3 Meeting Management
- **Instant meeting** creation with unique ID
- **Scheduled meetings** for future dates
- Shareable invite links
- Join meeting via link or meeting ID
- Host identification badge
- Participant list with status indicators
- Meeting lock/unlock capability
- Host-only meeting termination
- Meeting status: active/ended/scheduled

### 3.4 Chat System (Socket.IO)
- Real-time text chat during meetings
- Message history persistence
- 4000 character message limit
- Send/receive notifications
- Chat message timestamps
- System messages (join/leave notifications)

### 3.5 AI Deepfake Detection (Premium Feature)
- **Real-time frame analysis** every 5 seconds
- **MediaPipe Face Mesh** integration (on-device)
- **Eye Aspect Ratio (EAR)** blink detection
- **Nose-to-cheek gaze estimation**
- **Micro-movement analysis**
- **Trust Score** calculation (0-100 scale)
  - 90-100: Stable (High confidence real)
  - 70-89: Good (Generally trustworthy)
  - 40-69: Caution (Suspicious patterns)
  - 0-39: Alert (High probability fake)
- Visual trust score indicator in UI
- Alert notifications for suspicious participants

### 3.6 Fraud Guard Dashboard
- Real-time trust score timeline chart
- Per-participant status cards
- Evidence snapshot viewer
- ML model predictions with confidence
- Behavioral metrics display:
  - Blink rate per minute
  - Gaze direction tracking
  - Micro-movements score
  - Gaze shift frequency
- Export detection logs (JSON/CSV)
- Historical data visualization

### 3.7 UI/UX Features
- Material Design 3 components
- Dark/Light theme support
- Responsive layouts for phones/tablets
- Draggable panels (Chat, Participants, Deepfake Monitor)
- Floating action buttons for quick actions
- Toast notifications
- Loading states and skeleton screens
- Error boundaries

### 3.8 Security Features
- Rate limiting (30 auth attempts per 15 min)
- ML frame rate limiting (5 frames/second per IP)
- XSS protection (httpOnly cookies)
- Input validation and sanitization
- Protected API routes
- Host-only privileged operations

---

## 4. DATABASE SCHEMA (MongoDB)

### 4.1 User Collection
```javascript
{
  _id: ObjectId,
  name: String (required),
  email: String (required, unique, lowercase),
  passwordHash: String (required),
  createdAt: Date (default: now)
}
```

### 4.2 Meeting Collection
```javascript
{
  _id: ObjectId,
  meetingId: String (required, unique), // nanoid generated
  hostId: ObjectId (ref: 'User', required),
  title: String (default: 'Instant Meeting'),
  status: Enum ['active', 'ended', 'scheduled'],
  createdAt: Date (default: now),
  endedAt: Date (optional),
  scheduledDate: Date (optional)
}
```

### 4.3 ChatMessage Collection
```javascript
{
  _id: ObjectId,
  meetingId: String (required, indexed),
  senderName: String (required),
  message: String (required, max 4000 chars),
  timestamp: Date (default: now)
}
```

### 4.4 DeepfakeLog Collection
```javascript
{
  _id: ObjectId,
  meetingId: String (required, indexed),
  participantId: String (optional),
  userId: ObjectId (ref: 'User', optional),
  trustScore: Number (required),
  isLikelyFake: Boolean (required),
  gazeDirection: Enum ['center', 'left', 'right', 'up', 'down', 'unknown'],
  blinkRatePerMin: Number (default: 0),
  microMovementsScore: Number (default: 0),
  gazeShiftFrequency: Number (default: 0),
  snapshotJpegDataUrl: String (optional),
  hfLabel: String (optional),
  hfScore: Number (optional),
  mlLabel: String (optional),
  mlConfidence: Number (optional),
  mlProbabilities: { real: Number, fake: Number },
  mlFeatures: {
    total_blinks: Number,
    blink_rate: Number,
    interval_cv: Number,
    yaw_variance: Number,
    pitch_variance: Number,
    roll_variance: Number,
    cnn_score: Number
  },
  frameMetrics: {
    ear: Number,
    blink_detected: Boolean,
    yaw: Number,
    pitch: Number
  },
  createdAt: Date (default: now, indexed)
}
```

---

## 5. API ENDPOINTS (REST + Socket.IO)

### 5.1 Authentication APIs (Base: `/api/auth`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/register` | Create new account | No |
| POST | `/login` | User login | No |
| POST | `/logout` | User logout | No |
| GET | `/me` | Get current user | Yes |
| PUT | `/profile` | Update user profile | Yes |

### 5.2 Meeting APIs (Base: `/api/meetings`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/` | Create new meeting | Yes |
| GET | `/` | List user's meetings | Yes |
| GET | `/:meetingId` | Get meeting details | No |
| POST | `/:meetingId/token` | Generate LiveKit token | No |
| POST | `/:meetingId/end` | End meeting (host only) | Yes |

### 5.3 Deepfake Detection APIs (Base: `/api/deepfake`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/analyze` | Analyze frame for deepfake | Yes (Rate limited: 5/sec) |
| POST | `/log` | Store detection log | Yes |
| GET | `/logs/:meetingId` | Get logs for meeting | Yes |
| POST | `/reset-session` | Reset analysis session | Yes |
| GET | `/health` | ML service health check | Yes |

### 5.4 Socket.IO Events
| Event | Direction | Description |
|-------|-----------|-------------|
| `connection` | Server | Client connects |
| `join-room` | Client → Server | Join meeting room |
| `leave-room` | Client → Server | Leave meeting room |
| `send-message` | Client → Server | Send chat message |
| `receive-message` | Server → Client | Receive chat message |
| `participant-joined` | Server → Client | Someone joined |
| `participant-left` | Server → Client | Someone left |
| `disconnect` | Server | Client disconnected |

---

## 6. REQUIRED API KEYS & SERVICES

### 6.1 LiveKit Cloud (Video Conferencing)
- **Website:** https://livekit.io
- **Required Keys:**
  - `LIVEKIT_API_KEY` - Your project API key
  - `LIVEKIT_API_SECRET` - Your project API secret
  - `LIVEKIT_URL` - WebSocket URL (e.g., `wss://your-project.livekit.cloud`)

### 6.2 MongoDB (Database)
- **Local:** `mongodb://localhost:27017/zoom-clone`
- **Atlas (Cloud):** Create cluster at mongodb.com
- **Connection String:** Get from MongoDB Atlas dashboard

### 6.3 JWT Secret (Self-generated)
- Generate a long random string (min 32 characters)
- Store in environment variables
- NEVER commit to version control

### 6.4 Python ML Service (Self-hosted)
- Runs on port `5001`
- URL: `http://localhost:5001` (or deployed URL)
- No external API key required

---

## 7. ANDROID PROJECT STRUCTURE

```
app/
├── src/
│   ├── main/
│   │   ├── java/com/securemeet/
│   │   │   ├── MainActivity.kt
│   │   │   ├── SecureMeetApp.kt
│   │   │   ├──
│   │   │   ├── data/
│   │   │   │   ├── api/
│   │   │   │   │   ├── ApiService.kt
│   │   │   │   │   ├── AuthApi.kt
│   │   │   │   │   ├── MeetingApi.kt
│   │   │   │   │   └── DeepfakeApi.kt
│   │   │   │   ├── local/
│   │   │   │   │   ├── SecureMeetDatabase.kt
│   │   │   │   │   ├── UserDao.kt
│   │   │   │   │   └── ChatDao.kt
│   │   │   │   ├── model/
│   │   │   │   │   ├── User.kt
│   │   │   │   │   ├── Meeting.kt
│   │   │   │   │   ├── ChatMessage.kt
│   │   │   │   │   ├── DeepfakeLog.kt
│   │   │   │   │   └── TrustScore.kt
│   │   │   │   └── repository/
│   │   │   │       ├── AuthRepository.kt
│   │   │   │       ├── MeetingRepository.kt
│   │   │   │       └── ChatRepository.kt
│   │   │   │
│   │   │   ├── di/
│   │   │   │   ├── AppModule.kt
│   │   │   │   └── NetworkModule.kt
│   │   │   │
│   │   │   ├── domain/
│   │   │   │   ├── usecase/
│   │   │   │   │   ├── auth/
│   │   │   │   │   ├── meeting/
│   │   │   │   │   └── chat/
│   │   │   │   └── util/
│   │   │   │
│   │   │   ├── service/
│   │   │   │   ├── LiveKitService.kt
│   │   │   │   ├── SocketService.kt
│   │   │   │   ├── DeepfakeDetectionService.kt
│   │   │   │   └── TrustScoreCalculator.kt
│   │   │   │
│   │   │   ├── ui/
│   │   │   │   ├── screens/
│   │   │   │   │   ├── splash/
│   │   │   │   │   │   └── SplashScreen.kt
│   │   │   │   │   ├── auth/
│   │   │   │   │   │   ├── LoginScreen.kt
│   │   │   │   │   │   └── RegisterScreen.kt
│   │   │   │   │   ├── home/
│   │   │   │   │   │   └── HomeScreen.kt
│   │   │   │   │   ├── dashboard/
│   │   │   │   │   │   └── DashboardScreen.kt
│   │   │   │   │   ├── meeting/
│   │   │   │   │   │   ├── JoinMeetingScreen.kt
│   │   │   │   │   │   ├── MeetingScreen.kt
│   │   │   │   │   │   └── MeetingSummaryScreen.kt
│   │   │   │   │   ├── fraud/
│   │   │   │   │   │   └── FraudDashboardScreen.kt
│   │   │   │   │   └── profile/
│   │   │   │   │       └── ProfileScreen.kt
│   │   │   │   │
│   │   │   │   ├── components/
│   │   │   │   │   ├── VideoGrid.kt
│   │   │   │   │   ├── MeetingControls.kt
│   │   │   │   │   ├── ChatPanel.kt
│   │   │   │   │   ├── ParticipantPanel.kt
│   │   │   │   │   ├── DeepfakeMonitor.kt
│   │   │   │   │   ├── TrustScoreIndicator.kt
│   │   │   │   │   ├── MeetingToolbar.kt
│   │   │   │   │   ├── CameraPreview.kt
│   │   │   │   │   └── common/
│   │   │   │   │       ├── Buttons.kt
│   │   │   │   │       ├── Inputs.kt
│   │   │   │   │       └── Cards.kt
│   │   │   │   │
│   │   │   │   ├── theme/
│   │   │   │   │   ├── Color.kt
│   │   │   │   │   ├── Theme.kt
│   │   │   │   │   └── Type.kt
│   │   │   │   │
│   │   │   │   ├── viewmodel/
│   │   │   │   │   ├── AuthViewModel.kt
│   │   │   │   │   ├── MeetingViewModel.kt
│   │   │   │   │   ├── DashboardViewModel.kt
│   │   │   │   │   └── FraudDashboardViewModel.kt
│   │   │   │   │
│   │   │   │   └── navigation/
│   │   │   │       ├── NavGraph.kt
│   │   │   │       └── Screen.kt
│   │   │   │
│   │   │   └── util/
│   │   │       ├── Constants.kt
│   │   │       ├── Extensions.kt
│   │   │       ├── SecurityUtils.kt
│   │   │       └── FrameCaptureUtil.kt
│   │   │
│   │   ├── res/
│   │   │   ├── drawable/
│   │   │   ├── values/
│   │   │   └── xml/
│   │   │
│   │   └── AndroidManifest.xml
│   │
│   └── build.gradle.kts
│
├── build.gradle.kts
└── settings.gradle.kts
```

---

## 8. DEPENDENCIES (build.gradle)

### 8.1 Core Android
```kotlin
implementation("androidx.core:core-ktx:1.12.0")
implementation("androidx.appcompat:appcompat:1.6.1")
implementation("com.google.android.material:material:1.11.0")
implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
implementation("androidx.activity:activity-compose:1.8.2")
```

### 8.2 Jetpack Compose
```kotlin
implementation(platform("androidx.compose:compose-bom:2024.02.00"))
implementation("androidx.compose.ui:ui")
implementation("androidx.compose.ui:ui-graphics")
implementation("androidx.compose.ui:ui-tooling-preview")
implementation("androidx.compose.material3:material3")
implementation("androidx.navigation:navigation-compose:2.7.7")
```

### 8.3 WebRTC / LiveKit
```kotlin
implementation("io.livekit:livekit-android:2.0.1")
implementation("com.google.protobuf:protobuf-javalite:3.25.1")
```

### 8.4 Networking
```kotlin
implementation("com.squareup.retrofit2:retrofit:2.9.0")
implementation("com.squareup.retrofit2:converter-gson:2.9.0")
implementation("com.squareup.okhttp3:okhttp:4.12.0")
implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
implementation("io.socket:socket.io-client:2.1.0")
```

### 8.5 MediaPipe (On-device ML)
```kotlin
implementation("com.google.mediapipe:tasks-vision:0.10.8")
```

### 8.6 Local Database
```kotlin
implementation("androidx.room:room-runtime:2.6.1")
implementation("androidx.room:room-ktx:2.6.1")
kapt("androidx.room:room-compiler:2.6.1")
```

### 8.7 Dependency Injection
```kotlin
implementation("com.google.dagger:hilt-android:2.50")
kapt("com.google.dagger:hilt-compiler:2.50")
implementation("androidx.hilt:hilt-navigation-compose:1.1.0")
```

### 8.8 Image Loading & Charts
```kotlin
implementation("io.coil-kt:coil-compose:2.5.0")
implementation("com.github.PhilJay:MPAndroidChart:v3.1.0")
```

### 8.9 Coroutines & Flow
```kotlin
implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.7.3")
```

### 8.10 Security
```kotlin
implementation("androidx.security:security-crypto:1.1.0-alpha06")
implementation("androidx.biometric:biometric:1.1.0")
```

---

## 9. AUTHENTICATION FLOW

### 9.1 Registration
1. User enters name, email, password
2. Client validates:
   - Name: min 2 characters
   - Email: valid format regex
   - Password: min 8 characters
3. POST to `/api/auth/register`
4. Server returns JWT in httpOnly cookie
5. Store user data in local preferences
6. Navigate to Dashboard

### 9.2 Login
1. User enters email, password
2. POST to `/api/auth/login`
3. Server validates credentials
4. Returns JWT in httpOnly cookie + user data
5. Store auth token securely
6. Navigate to Dashboard

### 9.3 Token Management
- Use EncryptedSharedPreferences for token storage
- Auto-refresh token before expiry (7 days)
- Clear token on logout

### 9.4 Protected Routes
- Check auth status before navigating to protected screens
- Redirect to Login if not authenticated

---

## 10. WEBRTC/MEETING IMPLEMENTATION

### 10.1 Joining a Meeting
1. User enters meeting ID or clicks invite link
2. Call `POST /api/meetings/:meetingId/token`
   - Body: `{ identity: userId, name: userName }`
3. Receive LiveKit token
4. Initialize LiveKit Room with token
5. Connect to Room
6. Join Socket.IO room: `emit('join-room', { meetingId, userName })`
7. Publish local audio/video tracks
8. Subscribe to remote participants' tracks

### 10.2 Video Grid Layout
- Use `LazyVerticalGrid` or custom layout
- Each participant cell shows:
  - Video track (or avatar if camera off)
  - Name label
  - Mic on/off indicator
  - Host badge (if applicable)
- Highlight active speaker

### 10.3 Meeting Controls
- Mute/Unmute mic: `room.localParticipant.setMicrophoneEnabled()`
- Enable/Disable camera: `room.localParticipant.setCameraEnabled()`
- Switch camera: `room.switchCamera()`
- Screen share: `room.localParticipant.setScreenShareEnabled()`
- Leave meeting: Disconnect room, emit 'leave-room'

### 10.4 Chat Implementation
- Socket.IO integration
- Message list with RecyclerView/LazyColumn
- Text input with send button
- Message bubbles (sent/received)
- Auto-scroll to latest message

---

## 11. DEEPFAKE DETECTION IMPLEMENTATION

### 11.1 MediaPipe Integration
```kotlin
// Face Mesh setup
val faceMesh = FaceLandmarker.createFromOptions(
    context,
    FaceLandmarker.FaceLandmarkerOptions.builder()
        .setBaseOptions(
            BaseOptions.builder()
                .setModelAssetPath("face_landmarker.task")
                .build()
        )
        .setRunningMode(RunningMode.LIVE_STREAM)
        .setResultListener { result, _ ->
            processFaceLandmarks(result)
        }
        .build()
)
```

### 11.2 Frame Capture (every 5 seconds)
```kotlin
// Capture frame from video track
fun captureFrame(videoTrack: VideoTrack): Bitmap {
    // Use VideoSink to get frame
    // Convert to Bitmap
    // Compress to JPEG base64
}
```

### 11.3 Analysis Flow
1. Capture video frame every 5 seconds
2. Run MediaPipe Face Mesh detection (on-device)
3. Calculate EAR (Eye Aspect Ratio) for blink detection
4. Estimate gaze direction
5. Send frame to server: `POST /api/deepfake/analyze`
6. Receive trust score and ML prediction
7. Update UI indicator
8. Log suspicious activity if `isLikelyFake` is true

### 11.4 Trust Score UI
- Circular progress indicator (0-100)
- Color coding:
  - Green (90-100): #4CAF50
  - Yellow (70-89): #FFC107
  - Orange (40-69): #FF9800
  - Red (0-39): #F44336
- Real-time updates
- Alert dialog for suspicious participants

---

## 12. ENVIRONMENT CONFIGURATION

### 12.1 Android local.properties (NOT in version control)
```properties
# Server URLs
# For Android Emulator (uses 10.0.2.2 to reach host localhost)
# API_BASE_URL=http://10.0.2.2:5000

# For Physical Device (use your PC's IP address)
API_BASE_URL=http://26.189.116.187:5000

# Production server
# API_BASE_URL=https://your-server.com

# LiveKit
LIVEKIT_URL=wss://your-project.livekit.cloud

# Feature flags
ENABLE_DEEPFAKE_DETECTION=true
ENABLE_FRAUD_DASHBOARD=true
```

### 12.2 Backend .env (Server-side)
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/zoom-clone
JWT_SECRET=your_long_random_secret_here_min_32_chars
CLIENT_URL=http://localhost:5173
# Android Device IP (your IPv4: 26.189.116.187)
MOBILE_URL=http://26.189.116.187:8080

# LiveKit Cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret

# Python ML Service
PYTHON_ML_SERVICE_URL=http://localhost:5001
```

---

## 13. PERMISSIONS (AndroidManifest.xml)

```xml
<!-- Internet -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

<!-- Camera & Microphone -->
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />

<!-- Screen Capture (for screen sharing) -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />

<!-- Storage (for snapshots, logs) -->
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />

<!-- Hardware features -->
<uses-feature android:name="android.hardware.camera" android:required="false" />
<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
<uses-feature android:name="android.hardware.microphone" android:required="false" />
```

---

## 14. BUILD CONFIGURATION

### 14.1 app/build.gradle.kts
```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.dagger.hilt.android")
    id("kotlin-kapt")
}

android {
    namespace = "com.securemeet"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.securemeet"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "API_BASE_URL", "\"${project.findProperty("API_BASE_URL")}\"")
        buildConfigField("String", "LIVEKIT_URL", "\"${project.findProperty("LIVEKIT_URL")}\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.8"
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }
}
```

---

## 15. KEY TECHNICAL CONSIDERATIONS

### 15.1 WebRTC on Android
- Use LiveKit Android SDK (wraps WebRTC)
- Handle audio focus changes
- Manage camera lifecycle properly
- Support both front and back cameras
- Handle network switching (WiFi ↔ Mobile Data)

### 15.2 Performance Optimization
- Use LazyColumn for participant lists
- Debounce deepfake frame capture (5s intervals)
- Compress images before sending (max 2MB)
- Use Room database for offline message persistence
- Implement pagination for chat history

### 15.3 Battery Optimization
- Reduce frame capture frequency when screen off
- Pause video tracks when app in background
- Use WorkManager for background sync

### 15.4 Security
- Use https for all API calls in production
- Store JWT in EncryptedSharedPreferences
- Validate all inputs server-side
- Sanitize chat messages
- Implement certificate pinning for production

### 15.5 Error Handling
- Network connectivity checks
- Retry mechanisms for API calls
- Graceful degradation when ML service unavailable
- Error boundaries in Compose UI

---

## 16. TESTING REQUIREMENTS

### 16.1 Unit Tests
- ViewModel tests
- Repository tests
- Use case tests
- Utility function tests

### 16.2 Integration Tests
- API service tests
- Database operations
- Socket.IO connection

### 16.3 UI Tests
- Navigation flow tests
- Screen interaction tests
- Compose component tests

### 16.4 Device Testing
- Test on various screen sizes (phones, tablets)
- Test with different Android versions (8.0+)
- Test camera/mic permissions
- Test in low-bandwidth conditions

---

## 17. DEPLOYMENT CHECKLIST

### 17.1 Pre-release
- [ ] All API keys configured
- [ ] Backend deployed and accessible
- [ ] ML service running
- [ ] LiveKit project configured
- [ ] MongoDB accessible
- [ ] ProGuard rules configured
- [ ] App signing configured

### 17.2 Release Build
```bash
./gradlew assembleRelease
```

### 17.3 Distribution
- Google Play Store
- Firebase App Distribution (beta testing)
- Direct APK distribution

---

## 18. SUMMARY FOR AI CODE GENERATION

**When giving this file to an AI for code generation, emphasize:**

1. **Use Kotlin + Jetpack Compose** for all UI
2. **Use MVVM architecture** with Repository pattern
3. **Use Hilt** for dependency injection
4. **Use LiveKit Android SDK** for video (not custom WebRTC)
5. **Use Socket.IO** for real-time chat
6. **Use MediaPipe** for on-device face detection
7. **Follow Material Design 3** guidelines
8. **Implement all 10 screens** listed in Section 2
9. **Include all features** from Section 3
10. **Use the exact API endpoints** from Section 5
11. **Implement deepfake detection** with trust score UI
12. **Handle all permissions** properly
13. **Add proper error handling** throughout

---

**Document Version:** 1.0
**Created:** For SecureMeet Android App Development
**Compatible Backend:** Node.js Server (Port 5000) + Python ML Service (Port 5001)
