import { Router, Request, Response } from 'express';
import { nanoid } from 'nanoid';
import { Meeting } from '../models/Meeting';
import { auth, AuthRequest } from '../middleware/auth';
import { createLivekitToken } from '../utils/livekit';

const router = Router();

// POST / - Create meeting (auth required)
router.post('/', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title } = req.body;

    const meeting = await Meeting.create({
      meetingId: nanoid(),
      hostId: req.user!.id,
      title: title || 'Instant Meeting',
    });

    res.status(201).json({ meeting });
  } catch (error) {
    console.error('Create meeting error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET / - List user's meetings (auth required)
router.get('/', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const meetings = await Meeting.find({ hostId: req.user!.id }).sort({ createdAt: -1 });

    res.json({ meetings });
  } catch (error) {
    console.error('List meetings error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /:meetingId - Get meeting by meetingId (public)
router.get('/:meetingId', async (req: Request, res: Response): Promise<void> => {
  try {
    const meeting = await Meeting.findOne({ meetingId: req.params.meetingId });

    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    res.json({ meeting });
  } catch (error) {
    console.error('Get meeting error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /:meetingId/token - Generate LiveKit token (public)
router.post('/:meetingId/token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { identity, name } = req.body;

    if (!identity || !name) {
      res.status(400).json({ error: 'Identity and name are required' });
      return;
    }

    const meeting = await Meeting.findOne({ meetingId: req.params.meetingId });

    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    if (meeting.status === 'ended') {
      res.status(404).json({ error: 'Meeting has ended' });
      return;
    }

    // Determine metadata (e.g. if the user is the host)
    let metadata = '';
    if (meeting.hostId.toString() === identity) {
      metadata = JSON.stringify({ isHost: true });
    }

    const token = await createLivekitToken(meeting.meetingId, identity, name, metadata);

    res.json({ token });
  } catch (error) {
    console.error('Generate token error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /:meetingId/end - End meeting (auth required, host only)
router.post('/:meetingId/end', auth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const meeting = await Meeting.findOne({ meetingId: req.params.meetingId });

    if (!meeting) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    if (meeting.hostId.toString() !== req.user!.id) {
      res.status(403).json({ error: 'Only the host can end the meeting' });
      return;
    }

    meeting.status = 'ended';
    meeting.endedAt = new Date();
    await meeting.save();

    res.json({ meeting });
  } catch (error) {
    console.error('End meeting error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
