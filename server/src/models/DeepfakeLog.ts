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
  mlLabel?: string;
  mlConfidence?: number;
  mlProbabilities?: { real: number; fake: number };
  // FIX: fields now match what ml_service.py actually returns
  mlFeatures?: {
    total_blinks: number;
    blink_rate: number;
    interval_cv: number;
    yaw_variance: number;
    pitch_variance: number;
    roll_variance: number;
    cnn_score: number;
  };
  frameMetrics?: {
    ear: number;
    blink_detected: boolean;
    yaw?: number;
    pitch?: number;
  };
  createdAt: Date;
}

const deepfakeLogSchema = new Schema<IDeepfakeLog>({
  meetingId: { type: String, required: true, index: true },
  participantId: { type: String },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  trustScore: { type: Number, required: true },
  isLikelyFake: { type: Boolean, required: true },
  gazeDirection: {
    type: String,
    enum: ['center', 'left', 'right', 'up', 'down', 'unknown'],
    default: 'unknown',
  },
  blinkRatePerMin: { type: Number, default: 0 },
  microMovementsScore: { type: Number, default: 0 },
  gazeShiftFrequency: { type: Number, default: 0 },
  hfLabel: { type: String },
  hfScore: { type: Number },
  snapshotJpegDataUrl: { type: String },
  mlLabel: { type: String },
  mlConfidence: { type: Number },
  mlProbabilities: {
    type: { real: Number, fake: Number },
  },
  // FIX: aligned with ml_service.py output schema
  mlFeatures: {
    type: {
      total_blinks: Number,
      blink_rate: Number,
      interval_cv: Number,
      yaw_variance: Number,
      pitch_variance: Number,
      roll_variance: Number,
      cnn_score: Number,
    },
  },
  frameMetrics: {
    type: {
      ear: Number,
      blink_detected: Boolean,
      yaw: Number,
      pitch: Number,
    },
  },
  createdAt: { type: Date, default: Date.now, index: true },
});

export const DeepfakeLog = mongoose.model<IDeepfakeLog>('DeepfakeLog', deepfakeLogSchema);
