import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import http from 'http';
import { Server } from 'socket.io';
import authRoutes from './routes/auth';
import meetingRoutes from './routes/meetings';
import deepfakeRoutes from './routes/deepfake';
import { setupSocket } from './socket';

const app = express();
const server = http.createServer(app);

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const MOBILE_URL = 'http://10.92.33.127:5173';

const io = new Server(server, {
  cors: {
    origin: [CLIENT_URL, MOBILE_URL],
    credentials: true,
  },
});

// Middleware
app.use(cors({
  origin: [CLIENT_URL, MOBILE_URL],
  credentials: true,
}));
app.use(cookieParser());
// Increased to allow optional snapshot uploads for fraud dashboard evidence
app.use(express.json({ limit: '2mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/deepfake', deepfakeRoutes);

// Socket.IO
setupSocket(io);

// Connect to MongoDB and start server
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/zoom-clone';

async function startServer() {
  try {
    // Connect to local MongoDB
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
