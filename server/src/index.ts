import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import http from 'http';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';
import authRoutes from './routes/auth';
import meetingRoutes from './routes/meetings';
import deepfakeRoutes from './routes/deepfake';
import { setupSocket } from './socket';

const app = express();
const server = http.createServer(app);

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const MOBILE_URL = process.env.MOBILE_URL || 'http://localhost:5174';
const allowedOrigins = [CLIENT_URL, MOBILE_URL].filter(Boolean);

const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true },
});

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

// ── Rate limiters ────────────────────────────────────────────────────────────
// Auth: 30 attempts per 15 minutes (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ML analyze: max 5 frames/second per IP (heavy endpoint)
const mlLimiter = rateLimit({
  windowMs: 1000,
  max: 5,
  message: { error: 'ML analysis rate limit exceeded. Slow down frame capture.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/deepfake/analyze', mlLimiter);   // apply extra limit before the router
app.use('/api/deepfake', deepfakeRoutes);

// ── Socket.IO ─────────────────────────────────────────────────────────────────
setupSocket(io);

// ── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/zoom-clone';

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');
    server.listen(PORT, '0.0.0.0' as any, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error: any) {
    console.error('Server startup error:', error.message);
    process.exit(1);
  }
}

startServer();

export { io };
