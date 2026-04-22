import mongoose, { Document, Schema } from 'mongoose';

export interface IChatMessage extends Document {
  meetingId: string;
  senderName: string;
  message: string;
  timestamp: Date;
}

const chatMessageSchema = new Schema<IChatMessage>({
  meetingId: { type: String, required: true, index: true },
  senderName: { type: String, required: true },
  // FIX: enforce max message length at the DB level
  message: { type: String, required: true, maxlength: 4000 },
  timestamp: { type: Date, default: Date.now },
});

export const ChatMessage = mongoose.model<IChatMessage>('ChatMessage', chatMessageSchema);
