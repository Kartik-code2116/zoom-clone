import { Router, Response } from 'express';
import { DeepfakeLog } from '../models/DeepfakeLog';
import { auth, AuthRequest } from '../middleware/auth';
import axios from 'axios';

const PYTHON_ML_SERVICE_URL = process.env.PYTHON_ML_SERVICE_URL || 'http://localhost:5001';

const router = Router();

// POST /api/deepfake/analyze
// FIX: re-enabled auth middleware (was "temporarily public")
router.post('/analyze', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { imageBase64, sessionId, meetingId, participantId } = req.body;

    if (!imageBase64) {
      res.status(400).json({ error: 'imageBase64 is required' });
      return;
    }

    const session_id = sessionId || `${meetingId}_${participantId || req.user?.id || 'unknown'}`;

    const response = await axios.post(`${PYTHON_ML_SERVICE_URL}/analyze-frame`, {
      session_id,
      image_base64: imageBase64,
      meeting_id: meetingId,
      participant_id: participantId || 'unknown',
    }, { timeout: 10000 });

    const mlResult = response.data;

    if (!mlResult.success) {
      res.status(500).json({ error: mlResult.error || 'ML analysis failed' });
      return;
    }

    // FIX: ml_service returns prediction nested; flatten correctly for client.
    // ml_service shape: { success, face_detected, prediction: { label, confidence, probabilities, features, frame_count }, trust_score, is_likely_fake, frame_metrics }
    const prediction = mlResult.prediction;

    const result = {
      // Top-level fields the client reads directly
      label: prediction?.label || 'unknown',
      score: prediction?.confidence || 0,
      trustScore: mlResult.trust_score ?? 50,
      isLikelyFake: mlResult.is_likely_fake ?? false,
      deepfakeCount: mlResult.deepfake_count ?? 0,
      faceDetected: mlResult.face_detected ?? false,
      frameMetrics: mlResult.frame_metrics || null,
      probabilities: prediction?.probabilities || { real: 0.5, fake: 0.5 },
      // Nested prediction object so client can also read data.prediction.*
      prediction: prediction
        ? {
            label: prediction.label,
            confidence: prediction.confidence,
            probabilities: prediction.probabilities,
            features: prediction.features,
            frame_count: prediction.frame_count ?? 0,
          }
        : null,
      // mlModel block for frame count + features
      mlModel: {
        type: 'custom_zppm',
        features: prediction?.features || null,
        frameCount: prediction?.frame_count ?? 0,
      },
      allResults: prediction
        ? [{ label: prediction.label, score: prediction.confidence }]
        : [],
    };

    res.json(result);
  } catch (error: any) {
    console.error('Python ML Service error:', error.message);
    if (error.code === 'ECONNREFUSED') {
      res.status(503).json({
        error: 'ML Service unavailable. Please ensure the Python ML service is running on port 5001.',
      });
    } else {
      res.status(500).json({ error: 'AI model inference failed: ' + error.message });
    }
  }
});

// POST /api/deepfake/log — auth re-enabled
router.post('/log', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      meetingId,
      participantId,
      trustScore,
      isLikelyFake,
      gazeDirection,
      blinkRatePerMin,
      microMovementsScore,
      gazeShiftFrequency,
      snapshotJpegDataUrl,
      hfLabel,
      hfScore,
      mlLabel,
      mlConfidence,
      mlProbabilities,
      mlFeatures,
      frameMetrics,
    } = req.body;

    if (!meetingId || typeof trustScore !== 'number') {
      res.status(400).json({ error: 'meetingId and numeric trustScore are required' });
      return;
    }

    const log = await DeepfakeLog.create({
      meetingId,
      participantId,
      userId: req.user?.id,
      trustScore,
      isLikelyFake: Boolean(isLikelyFake),
      gazeDirection,
      blinkRatePerMin,
      microMovementsScore,
      gazeShiftFrequency,
      snapshotJpegDataUrl,
      hfLabel,
      hfScore,
      mlLabel,
      mlConfidence,
      mlProbabilities,
      mlFeatures,
      frameMetrics,
    });

    res.status(201).json({ log });
  } catch (error) {
    console.error('Deepfake log error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/deepfake/logs/:meetingId
router.get('/logs/:meetingId', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { meetingId } = req.params;
    const logs = await DeepfakeLog.find({ meetingId }).sort({ createdAt: 1 }).limit(2000);
    res.json({ logs });
  } catch (error) {
    console.error('Deepfake logs fetch error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/deepfake/reset-session
router.post('/reset-session', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId, meetingId, participantId } = req.body;
    const session_id = sessionId || `${meetingId}_${participantId || req.user?.id || 'unknown'}`;

    await axios.post(`${PYTHON_ML_SERVICE_URL}/reset-session`, { session_id });
    res.json({ success: true, message: 'Session reset successfully' });
  } catch (error: any) {
    console.error('Reset session error:', error.message);
    res.status(500).json({ error: 'Failed to reset session' });
  }
});

// GET /api/deepfake/health
router.get('/health', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const response = await axios.get(`${PYTHON_ML_SERVICE_URL}/health`, { timeout: 5000 });
    res.json({ nodeService: 'healthy', pythonMlService: response.data });
  } catch (error: any) {
    res.status(503).json({
      nodeService: 'healthy',
      pythonMlService: { status: 'unavailable', error: error.message },
    });
  }
});

export default router;
