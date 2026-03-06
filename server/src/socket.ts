import { Server, Socket } from 'socket.io';
import { ChatMessage } from './models/ChatMessage';

interface JoinRoomData {
  meetingId: string;
  userName: string;
}

interface SendMessageData {
  meetingId: string;
  senderName: string;
  message: string;
}

export const setupSocket = (io: Server): void => {
  io.on('connection', (socket: Socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('join-room', (data: JoinRoomData) => {
      const { meetingId, userName } = data;
      socket.join(meetingId);
      console.log(`${userName} joined room: ${meetingId}`);
    });

    socket.on('send-message', async (data: SendMessageData) => {
      try {
        const { meetingId, senderName, message } = data;

        const chatMessage = await ChatMessage.create({
          meetingId,
          senderName,
          message,
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
