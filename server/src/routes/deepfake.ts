import { Router, Response } from 'express';
import { DeepfakeLog } from '../models/DeepfakeLog';
import { auth, AuthRequest } from '../middleware/auth';

const router = Router();

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

