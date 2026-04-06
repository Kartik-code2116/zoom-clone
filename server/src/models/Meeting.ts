import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IMeeting extends Document {
  meetingId: string;
  hostId: Types.ObjectId;
  title: string;
  status: 'active' | 'ended' | 'scheduled';
  createdAt: Date;
  endedAt?: Date;
  scheduledDate?: Date;
}

const meetingSchema = new Schema<IMeeting>({
  meetingId: {
    type: String,
    required: true,
    unique: true,
  },
  hostId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  title: {
    type: String,
    default: 'Instant Meeting',
  },
  status: {
    type: String,
    enum: ['active', 'ended', 'scheduled'],
    default: 'active',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  endedAt: {
    type: Date,
  },
  scheduledDate: {
    type: Date,
  },
});

export const Meeting = mongoose.model<IMeeting>('Meeting', meetingSchema);
