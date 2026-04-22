import { Server, Socket } from 'socket.io';
import { ChatMessage } from './models/ChatMessage';

interface JoinRoomData {
  meetingId: string;
  userName: string;
}

interface LeaveRoomData {
  meetingId: string;
  userName: string;
}

interface SendMessageData {
  meetingId: string;
  senderName: string;
  message: string;
}

const MAX_MESSAGE_LENGTH = 4000;

export const setupSocket = (io: Server): void => {
  io.on('connection', (socket: Socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('join-room', (data: JoinRoomData) => {
      const { meetingId, userName } = data;
      socket.join(meetingId);
      console.log(`${userName} joined room: ${meetingId}`);
      // FIX: notify other participants that someone joined
      socket.to(meetingId).emit('participant-joined', { userName });
    });

    // FIX: handle explicit leave-room event so participants know someone left
    socket.on('leave-room', (data: LeaveRoomData) => {
      const { meetingId, userName } = data;
      socket.leave(meetingId);
      console.log(`${userName} left room: ${meetingId}`);
      socket.to(meetingId).emit('participant-left', { userName });
    });

    socket.on('send-message', async (data: SendMessageData) => {
      try {
        const { meetingId, senderName, message } = data;

        // FIX: enforce message length server-side
        if (!message || message.trim().length === 0) return;
        if (message.length > MAX_MESSAGE_LENGTH) {
          socket.emit('message-error', { error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` });
          return;
        }

        const chatMessage = await ChatMessage.create({
          meetingId,
          senderName,
          message: message.trim(),
        });

        io.to(meetingId).emit('receive-message', {
          meetingId: chatMessage.meetingId,
          senderName: chatMessage.senderName,
          message: chatMessage.message,
          timestamp: chatMessage.timestamp,
        });
      } catch (error) {
        console.error('Send message error:', error);
      }
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });
};
