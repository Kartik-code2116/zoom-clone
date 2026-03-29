import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IDeepfakeLog extends Document {
  meetingId: string;
  participantId?: string;
  userId?: Types.ObjectId;
  trustScore: number;
  isLikelyFake: boolean;
  gazeDirection: 'center' | 'left' | 'right' | 'up' | 'down' | 'unknown';
  blinkRatePerMin: number;
  microMovementsScore: number;
  gazeShiftFrequency: number;
  snapshotJpegDataUrl?: string;
  hfLabel?: string;
  hfScore?: number;
  createdAt: Date;
}

const deepfakeLogSchema = new Schema<IDeepfakeLog>({
  meetingId: {
    type: String,
    required: true,
    index: true,
  },
  participantId: {
    type: String,
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
  trustScore: {
    type: Number,
    required: true,
  },
  isLikelyFake: {
    type: Boolean,
    required: true,
  },
  gazeDirection: {
    type: String,
    enum: ['center', 'left', 'right', 'up', 'down', 'unknown'],
    default: 'unknown',
  },
  blinkRatePerMin: {
    type: Number,
    default: 0,
  },
  microMovementsScore: {
    type: Number,
    default: 0,
  },
  gazeShiftFrequency: {
    type: Number,
    default: 0,
  },
  hfLabel: {
    type: String,
  },
  hfScore: {
    type: Number,
  },
  snapshotJpegDataUrl: {
    type: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

export const DeepfakeLog = mongoose.model<IDeepfakeLog>('DeepfakeLog', deepfakeLogSchema);

