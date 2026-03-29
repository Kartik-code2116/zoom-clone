import { Router, Response } from 'express';
import { DeepfakeLog } from '../models/DeepfakeLog';
import { auth, AuthRequest } from '../middleware/auth';
import axios from 'axios';

// Python ML Service configuration
const PYTHON_ML_SERVICE_URL = process.env.PYTHON_ML_SERVICE_URL || 'http://localhost:5001';

const router = Router();

// POST /api/deepfake/analyze - call Python ML model for real-time frame analysis
router.post('/analyze', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { imageBase64, sessionId, meetingId, participantId } = req.body;
    
    if (!imageBase64) {
      res.status(400).json({ error: 'imageBase64 is required' });
      return;
    }

    // Generate session ID if not provided
    const session_id = sessionId || `${meetingId}_${participantId || req.user?.id || 'unknown'}`;

    // Call Python ML Service
    const response = await axios.post(`${PYTHON_ML_SERVICE_URL}/analyze-frame`, {
      session_id: session_id,
      image_base64: imageBase64,
      meeting_id: meetingId,
      participant_id: participantId || req.user?.id
    }, {
      timeout: 10000 // 10 second timeout
    });

    const mlResult = response.data;

    if (!mlResult.success) {
      res.status(500).json({ error: mlResult.error || 'ML analysis failed' });
      return;
    }

    // Transform response to match existing frontend expectations
    // while adding custom ML model results
    const result = {
      label: mlResult.prediction?.label || 'unknown',
      score: mlResult.prediction?.confidence || 0,
      trustScore: mlResult.trust_score || 50,
      isLikelyFake: mlResult.is_likely_fake || false,
      faceDetected: mlResult.face_detected,
      frameMetrics: mlResult.frame_metrics,
      probabilities: mlResult.prediction?.probabilities,
      // Keep backward compatibility with existing HF format
      allResults: mlResult.prediction ? [{
        label: mlResult.prediction.label,
        score: mlResult.prediction.confidence
      }] : [],
      // Custom ML model info
      mlModel: {
        type: 'custom_zppm',
        features: mlResult.prediction?.features,
        frameCount: mlResult.frame_count
      }
    };
    
    res.json(result);
  } catch (error: any) {
    console.error('Python ML Service error:', error.message);
    if (error.code === 'ECONNREFUSED') {
      res.status(503).json({ 
        error: 'ML Service unavailable. Please ensure the Python ML service is running on port 5001.' 
      });
    } else {
      res.status(500).json({ error: 'AI model inference failed: ' + error.message });
    }
  }
});

// POST /api/deepfake/log - store a single trust score snapshot
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
      // New fields for custom ML model
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
      // Store custom ML model results
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

// GET /api/deepfake/logs/:meetingId - list logs for a meeting (host only in future)
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

// POST /api/deepfake/reset-session - reset an analysis session
router.post('/reset-session', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId, meetingId, participantId } = req.body;
    
    const session_id = sessionId || `${meetingId}_${participantId || req.user?.id || 'unknown'}`;

    await axios.post(`${PYTHON_ML_SERVICE_URL}/reset-session`, {
      session_id: session_id
    });

    res.json({ success: true, message: 'Session reset successfully' });
  } catch (error: any) {
    console.error('Reset session error:', error.message);
    res.status(500).json({ error: 'Failed to reset session' });
  }
});

// GET /api/deepfake/health - check ML service health
router.get('/health', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const response = await axios.get(`${PYTHON_ML_SERVICE_URL}/health`, {
      timeout: 5000
    });
    res.json({
      nodeService: 'healthy',
      pythonMlService: response.data
    });
  } catch (error: any) {
    res.status(503).json({
      nodeService: 'healthy',
      pythonMlService: { status: 'unavailable', error: error.message }
    });
  }
});

export default router;

