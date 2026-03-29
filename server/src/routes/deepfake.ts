import { Router, Response } from 'express';
import { DeepfakeLog } from '../models/DeepfakeLog';
import { auth, AuthRequest } from '../middleware/auth';
import { InferenceClient } from '@huggingface/inference';

const hf = new InferenceClient(process.env.HF_TOKEN);
const modelId = "prithivMLmods/Deep-Fake-Detector-v2-Model";

const router = Router();

// POST /api/deepfake/analyze - call HuggingFace model
router.post('/analyze', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      res.status(400).json({ error: 'imageBase64 is required' });
      return;
    }

    // Extract base64 and convert to buffer
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    const result = await hf.imageClassification({
      model: modelId,
      data: arrayBuffer,
    });

    // The model typically returns a list of labels with scores
    // Find the one with highest score or map 'Fake'/'Real'
    const topResult = result[0]; // Assuming the most confident result is first
    
    res.json({
      label: topResult.label,
      score: topResult.score,
      allResults: result
    });
  } catch (error: any) {
    console.error('HF Inference error:', error.message);
    res.status(500).json({ error: 'AI model inference failed' });
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

export default router;

