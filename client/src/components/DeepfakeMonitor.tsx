import React, { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { FaceMesh, Results } from '@mediapipe/face_mesh';
import { Camera } from '@mediapipe/camera_utils';

type GazeDirection = 'center' | 'left' | 'right' | 'up' | 'down' | 'unknown';

interface BlinkStats {
  blinkRatePerMin: number;
  lastBlinkAt: number | null;
}

interface BehavioralSignals {
  microMovementsScore: number; // 0–1
  gazeShiftFrequency: number; // per 10s
}

export interface DeepfakeStatus {
  trustScore: number;
  isLikelyFake: boolean;
  gazeDirection: GazeDirection;
  blinkStats: BlinkStats;
  behavioralSignals: BehavioralSignals;
  hfResult?: {
    label: string;
    score: number;
  };
}

interface DeepfakeMonitorProps {
  onStatusChange?: (status: DeepfakeStatus) => void;
  meetingId?: string;
  participantId?: string;
}

// Calculate the 'Eye Aspect Ratio' (EAR) to detect blinks
// Points based on standard 468 facial landmarks from MediaPipe
const LEFT_EYE_POINTS = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE_POINTS = [33, 160, 158, 133, 153, 144];

function getDistance(p1: { x: number; y: number }, p2: { x: number; y: number }) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function calculateEAR(landmarks: any[], indices: number[]) {
  const p1 = landmarks[indices[0]];
  const p2 = landmarks[indices[1]];
  const p3 = landmarks[indices[2]];
  const p4 = landmarks[indices[3]];
  const p5 = landmarks[indices[4]];
  const p6 = landmarks[indices[5]];

  const vert1 = getDistance(p2, p6);
  const vert2 = getDistance(p3, p5);
  const horiz = getDistance(p1, p4);

  if (horiz === 0) return 0;
  return (vert1 + vert2) / (2.0 * horiz);
}

// Compute an overall trust score based on behavioral factors
function computeTrustScore({
  blinkRatePerMin,
  microMovementsScore,
  gazeShiftFrequency,
}: {
  blinkRatePerMin: number;
  microMovementsScore: number;
  gazeShiftFrequency: number;
}): number {
  let score = 100;

  // 1. Blinks: Humans average 10-20 blinks per minute (0.15 - 0.33 per second)
  // Non-blinking or hyper-blinking reduces trust
  if (blinkRatePerMin === 0) {
    score -= 30; // Deepfakes often don't blink
  } else if (blinkRatePerMin < 5) {
    score -= 15; 
  } else if (blinkRatePerMin > 45) {
    score -= 20; // Hyper-blinking (glitching)
  }

  // 2. Micro movements: Natural human jitter 
  // 1.0 = perfectly natural (score 100%), 0.0 = completely rigid
  if (microMovementsScore < 0.2) {
    score -= 25; // Too rigid, likely an image
  } else if (microMovementsScore < 0.5) {
    score -= 10;
  }

  // 3. Gaze shifts: Completely fixed gaze is suspicious
  if (gazeShiftFrequency < 0.1) {
    score -= 15;
  } else if (gazeShiftFrequency > 3.0) {
    // Erratic gaze (tracker losing bounds)
    score -= 20; 
  }

  return Math.max(0, Math.min(100, score));
}

const DeepfakeMonitor: React.FC<DeepfakeMonitorProps> = ({
  onStatusChange,
  meetingId,
  participantId,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [status, setStatus] = useState<DeepfakeStatus>({
    trustScore: 100,
    isLikelyFake: false,
    gazeDirection: 'unknown',
    blinkStats: {
      blinkRatePerMin: 0,
      lastBlinkAt: null,
    },
    behavioralSignals: {
      microMovementsScore: 1,
      gazeShiftFrequency: 0,
    },
    hfResult: undefined,
  });

  // Track HF data separately
  const hfDataRef = useRef<{ label: string; score: number } | undefined>();
  const lastAnalyzedAtRef = useRef<number>(0);

  // Internal counters
  const historyRef = useRef<{
    blinks: number[]; // timestamps of blinks
    gazeShifts: number;
    lastGaze: GazeDirection;
    lastEAR: number; // for transition detection
    lastLandmarks: any[] | null;
  }>({
    blinks: [],
    gazeShifts: 0,
    lastGaze: 'unknown',
    lastEAR: 0.3,
    lastLandmarks: null,
  });

  const statsWindowStartRef = useRef<number>(performance.now());
  const BLINK_THRESHOLD = 0.2; // EAR dropped below 0.2 means eyes are closed

  useEffect(() => {
    let camera: Camera | null = null;
    let faceMesh: FaceMesh | null = null;
    
    // We only initialize if the video ref exists
    if (!videoRef.current) return;

    faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    faceMesh.onResults((results: Results) => {
      onMediaPipeResults(results);
    });

    camera = new Camera(videoRef.current, {
      onFrame: async () => {
        if (videoRef.current && faceMesh) {
          await faceMesh.send({ image: videoRef.current });
        }
      },
      width: 640,
      height: 360,
    });

    camera.start();

    return () => {
      if (camera) camera.stop();
      if (faceMesh) faceMesh.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMediaPipeResults = (results: Results) => {
    const now = performance.now();
    const state = historyRef.current;

    let microMovementsScore = 1.0;
    let gazeDirection: GazeDirection = state.lastGaze;
    let blinkDetected = false;

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      const landmarks = results.multiFaceLandmarks[0];

      // EAR Calculation for both eyes
      const leftEAR = calculateEAR(landmarks, LEFT_EYE_POINTS);
      const rightEAR = calculateEAR(landmarks, RIGHT_EYE_POINTS);
      const ear = (leftEAR + rightEAR) / 2.0;

      // Blink detection logic
      if (ear < BLINK_THRESHOLD && state.lastEAR >= BLINK_THRESHOLD) {
        // Just closed eyes - count as blink
        blinkDetected = true;
        state.blinks.push(now);
      }
      state.lastEAR = ear;

      // Simple Gaze Estimation using Iris points (468, 473 are iris centers roughly)
      // For a true implementation, we compare geometric ratios
      // Here we approximate based on nose tip vs head bounding box
      const nose = landmarks[1];
      const leftCheek = landmarks[234];
      const rightCheek = landmarks[454];

      const faceWidth = getDistance(leftCheek, rightCheek);
      const noseToLeft = getDistance(nose, leftCheek);
      const noseToRight = getDistance(nose, rightCheek);
      
      if (faceWidth > 0) {
        const ratio = noseToLeft / faceWidth;
        if (ratio < 0.35) gazeDirection = 'left';
        else if (ratio > 0.65) gazeDirection = 'right';
        else gazeDirection = 'center';
      }

      // Micro movements (compute jitter vs last frame)
      if (state.lastLandmarks) {
        const prevNose = state.lastLandmarks[1];
        const jitter = getDistance(nose, prevNose);
        
        // Jitter should exist (human) but not be erratic (glitching)
        if (jitter < 0.0001) microMovementsScore = 0.1; // Total freeze
        else if (jitter > 0.05) microMovementsScore = 0.3; // Erratic glitch
        else microMovementsScore = 0.9;
      }
      
      state.lastLandmarks = landmarks;
    } else {
      // No face detected - tank the trust score slightly or assume low score
      microMovementsScore = 0.0;
    }

    if (gazeDirection !== state.lastGaze && gazeDirection !== 'unknown') {
      state.gazeShifts += 1;
      state.lastGaze = gazeDirection;
    }

    // Purge old blinks > 60 seconds
    state.blinks = state.blinks.filter((t) => now - t < 60000);

    const windowDurationSec = (now - statsWindowStartRef.current) / 1000;
    if (windowDurationSec > 30) {
      // Reset generic stats window
      statsWindowStartRef.current = now;
      state.gazeShifts = 0; 
    }

    const blinkRatePerMin = state.blinks.length; // because we keep exactly 60s
    const gazeShiftFrequency = windowDurationSec > 0 ? state.gazeShifts / Math.max(windowDurationSec, 1) : 0;

    let behavioralTrustScore = computeTrustScore({
      blinkRatePerMin,
      microMovementsScore,
      gazeShiftFrequency,
    });

    // --- HF AI MODEL INTEGRATION ---
    // Every 8 seconds, if we have a frame, send it to the backend for HF analysis
    if (now - lastAnalyzedAtRef.current > 8000 && canvasRef.current) {
        lastAnalyzedAtRef.current = now;
        analyzeFrameWithHF(canvasRef.current).then(res => {
            if (res) hfDataRef.current = res;
        });
    }

    // Fuse scores: 40% behavioral, 60% HF AI (if available)
    let trustScore = behavioralTrustScore;
    if (hfDataRef.current) {
        // Map HF Label to a "trust" value: 
        // If label is "Real", trust = score * 100
        // If label is "Fake", trust = (1 - score) * 100
        const hfConfidence = hfDataRef.current.label.toLowerCase() === 'real' 
            ? hfDataRef.current.score 
            : 1 - hfDataRef.current.score;
        
        const hfTrust = hfConfidence * 100;
        trustScore = (behavioralTrustScore * 0.4) + (hfTrust * 0.6);
    }

    const nextStatus: DeepfakeStatus = {
      trustScore,
      isLikelyFake: trustScore < 40,
      gazeDirection,
      blinkStats: {
        blinkRatePerMin,
        lastBlinkAt: state.blinks.length > 0 ? state.blinks[state.blinks.length - 1] : null,
      },
      behavioralSignals: {
        microMovementsScore,
        gazeShiftFrequency,
      },
      hfResult: hfDataRef.current,
    };

    setStatus((prev) => {
      // Only fire expensive updates if something significant changed
      if (Math.abs(prev.trustScore - nextStatus.trustScore) > 2 || nextStatus.isLikelyFake !== prev.isLikelyFake) {
        if (onStatusChange) onStatusChange(nextStatus);
      }
      return nextStatus;
    });

    if (canvasRef.current && videoRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        canvasRef.current.width = videoRef.current.videoWidth || 640;
        canvasRef.current.height = videoRef.current.videoHeight || 360;
        ctx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }

    maybeLogStatus(meetingId, participantId, nextStatus, nextStatus.isLikelyFake ? canvasRef.current : undefined);
  };

  const riskColor =
    status.trustScore > 75 ? 'bg-emerald-500' : status.trustScore > 50 ? 'bg-yellow-400' : 'bg-red-500';

  return (
    <div className="fixed top-4 right-4 z-40 w-64 rounded-lg bg-slate-900/80 text-white shadow-lg border border-slate-700 backdrop-blur-sm">
      <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <div className="text-sm font-semibold">DeepFake Guard</div>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            status.isLikelyFake ? 'bg-red-600/80 text-white' : 'bg-emerald-600/80 text-white'
          }`}
        >
          {status.isLikelyFake ? 'RISK' : 'STABLE'}
        </span>
      </div>

      <div className="px-4 py-3 space-y-2">
        {status.hfResult ? (
           <div className="pb-1 border-b border-slate-700/50 mb-1 flex items-center justify-between">
             <span className="text-[10px] text-slate-400 font-mono uppercase">HF AI MODEL</span>
             <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
               status.hfResult.label.toLowerCase() === 'real' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
             }`}>
               {status.hfResult.label} {(status.hfResult.score * 100).toFixed(0)}%
             </span>
           </div>
        ) : (
          <div className="pb-1 border-b border-slate-700/50 mb-1 flex items-center justify-between">
            <span className="text-[10px] text-slate-400 font-mono uppercase">HF AI MODEL</span>
            <span className="text-[9px] text-slate-500 italic">Waiting/Token Missing...</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-300">Trust score</span>
          <span className="text-sm font-semibold">{Math.round(status.trustScore)}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
          <div
            className={`h-full ${riskColor} transition-all duration-300`}
            style={{ width: `${Math.max(0, Math.min(100, status.trustScore))}%` }}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
          <div>
            <div className="text-slate-400">Gaze</div>
            <div className="font-medium capitalize">{status.gazeDirection}</div>
          </div>
          <div>
            <div className="text-slate-400">Blink rate</div>
            <div className="font-medium">
              {status.blinkStats.blinkRatePerMin} /min
            </div>
          </div>
          <div>
            <div className="text-slate-400">Micro-movements</div>
            <div className="font-medium">
              {(status.behavioralSignals.microMovementsScore * 100).toFixed(0)}%
            </div>
          </div>
          <div>
            <div className="text-slate-400">Gaze shifts</div>
            <div className="font-medium">
              {status.behavioralSignals.gazeShiftFrequency.toFixed(2)} /s
            </div>
          </div>
        </div>

        {status.isLikelyFake && (
          <div className="mt-1 rounded-md bg-red-900/60 border border-red-700 px-2 py-1 text-[11px] text-red-100">
            DeepFake patterns detected – participant may be fake.
          </div>
        )}
      </div>

      {/* Hidden elements used only for analysis */}
      <video
        ref={videoRef}
        className="hidden"
        autoPlay
        playsInline
        muted
      />
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export async function analyzeFrameWithHF(canvas: HTMLCanvasElement): Promise<{ label: string; score: number } | undefined> {
    try {
        const imageBase64 = canvas.toDataURL('image/jpeg', 0.8);
        const { data } = await api.post('/deepfake/analyze', { imageBase64 });
        return { label: data.label, score: data.score };
    } catch (err) {
        console.warn('HF Analysis error', err);
        return undefined;
    }
}

async function maybeLogStatus(
  meetingId: string | undefined,
  participantId: string | undefined,
  status: DeepfakeStatus,
  evidenceCanvas?: HTMLCanvasElement | null
) {
  if (!meetingId) return;

  const now = performance.now();
  // Throttle to once every 5 seconds
  if ((window as any).__deepfake_lastSentLogAt && now - (window as any).__deepfake_lastSentLogAt < 5000) {
    return;
  }
  (window as any).__deepfake_lastSentLogAt = now;

  const snapshotJpegDataUrl =
    status.isLikelyFake && evidenceCanvas ? maybeCaptureEvidenceSnapshot(evidenceCanvas) : undefined;

  try {
    await api.post('/deepfake/log', {
      meetingId,
      participantId: participantId || 'unknown',
      trustScore: status.trustScore,
      isLikelyFake: status.isLikelyFake,
      gazeDirection: status.gazeDirection,
      blinkRatePerMin: status.blinkStats.blinkRatePerMin,
      microMovementsScore: status.behavioralSignals.microMovementsScore,
      gazeShiftFrequency: status.behavioralSignals.gazeShiftFrequency,
      snapshotJpegDataUrl,
      hfLabel: status.hfResult?.label,
      hfScore: status.hfResult?.score,
    });
  } catch (err) {
    console.warn('Deepfake log error', err);
  }
}

function maybeCaptureEvidenceSnapshot(canvas: HTMLCanvasElement): string | undefined {
  const targetW = 320;
  const scale = canvas.width ? targetW / canvas.width : 1;
  const targetH = Math.max(1, Math.round(canvas.height * scale));

  if (!Number.isFinite(scale) || scale <= 0) return undefined;

  const tmp = document.createElement('canvas');
  tmp.width = targetW;
  tmp.height = targetH;
  const ctx = tmp.getContext('2d');
  if (!ctx) return undefined;

  ctx.drawImage(canvas, 0, 0, tmp.width, tmp.height);
  try {
    return tmp.toDataURL('image/jpeg', 0.6);
  } catch {
    return undefined;
  }
}

export default DeepfakeMonitor;

