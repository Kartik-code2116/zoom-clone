import React, { useEffect, useRef, useState } from 'react';
import api from '../services/api';

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
}

interface DeepfakeMonitorProps {
  onStatusChange?: (status: DeepfakeStatus) => void;
  meetingId?: string;
  participantId?: string;
}

const FRAME_RATE = 30; // FPS
const ANALYSIS_INTERVAL_MS = 1000 / FRAME_RATE;

const DeepfakeMonitor: React.FC<DeepfakeMonitorProps> = ({
  onStatusChange,
  meetingId,
  participantId,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastAnalysisRef = useRef<number>(performance.now());
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
  });

  // Internal counters for simple behavioral statistics
  const blinkCountRef = useRef<number>(0);
  const gazeShiftCountRef = useRef<number>(0);
  const lastGazeDirectionRef = useRef<GazeDirection>('unknown');
  const statsWindowStartRef = useRef<number>(performance.now());
  // (logging throttling is handled globally inside maybeLogStatus)

  useEffect(() => {
    async function setupStream() {
      try {
        // Capture webcam video locally for analysis (audio not required)
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { frameRate: FRAME_RATE },
          audio: false,
        });

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        startAnalysisLoop();
      } catch (err) {
        console.error('DeepfakeMonitor: camera access error', err);
      }
    }

    setupStream();

    return () => {
      // Cleanup
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
    // We intentionally run this only once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startAnalysisLoop = () => {
    const analyze = () => {
      const now = performance.now();
      if (now - lastAnalysisRef.current >= ANALYSIS_INTERVAL_MS) {
        lastAnalysisRef.current = now;
        analyzeFrame();
      }
      requestAnimationFrame(analyze);
    };

    requestAnimationFrame(analyze);
  };

  const analyzeFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    if (video.readyState < 2) return; // HAVE_CURRENT_DATA

    const width = video.videoWidth || 640;
    const height = video.videoHeight || 360;
    if (!width || !height) return;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);

    // --- Simple heuristic analysis placeholders ---
    // These are intentionally lightweight and can be replaced with
    // MediaPipe Face Mesh, gaze estimation, or a trained model later.

    const { avgLuma, lumaVariance } = computeLumaStats(imageData);
    const gazeDirection = estimateGazeDirection(imageData, width, height);
    const blinkDetected = detectBlink(avgLuma, lumaVariance);

    updateBehavioralStats(gazeDirection, blinkDetected);

    const windowDurationSec = (performance.now() - statsWindowStartRef.current) / 1000;
    const blinkRatePerMin =
      windowDurationSec > 0 ? (blinkCountRef.current / windowDurationSec) * 60 : 0;
    const gazeShiftFrequency =
      windowDurationSec > 0 ? gazeShiftCountRef.current / Math.max(windowDurationSec, 1) : 0;

    const behavioralSignals: BehavioralSignals = {
      microMovementsScore: clamp(1 - lumaVariance / 5000, 0, 1),
      gazeShiftFrequency,
    };

    const blinkStats: BlinkStats = {
      blinkRatePerMin,
      lastBlinkAt: blinkDetected ? performance.now() : status.blinkStats.lastBlinkAt,
    };

    const trustScore = computeTrustScore({
      blinkRatePerMin,
      microMovementsScore: behavioralSignals.microMovementsScore,
      gazeShiftFrequency,
    });

    const nextStatus: DeepfakeStatus = {
      trustScore,
      isLikelyFake: trustScore < 40,
      gazeDirection,
      blinkStats,
      behavioralSignals,
    };

    setStatus(nextStatus);
    if (onStatusChange) {
      onStatusChange(nextStatus);
    }

    // Optionally log snapshots to backend every ~5 seconds for auditing.
    // If risk is detected, we attach a small evidence snapshot (JPEG).
    maybeLogStatus(meetingId, participantId, nextStatus, nextStatus.isLikelyFake ? canvas : undefined);
  };

  const updateBehavioralStats = (gazeDirection: GazeDirection, blinkDetected: boolean) => {
    const now = performance.now();

    if (blinkDetected) {
      blinkCountRef.current += 1;
    }

    if (lastGazeDirectionRef.current !== 'unknown' && gazeDirection !== lastGazeDirectionRef.current) {
      gazeShiftCountRef.current += 1;
    }
    lastGazeDirectionRef.current = gazeDirection;

    // Reset statistics window every 30 seconds
    const windowDurationSec = (now - statsWindowStartRef.current) / 1000;
    if (windowDurationSec > 30) {
      statsWindowStartRef.current = now;
      blinkCountRef.current = 0;
      gazeShiftCountRef.current = 0;
    }
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
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-300">Trust score</span>
          <span className="text-sm font-semibold">{Math.round(status.trustScore)}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
          <div
            className={`h-full ${riskColor} transition-all duration-300`}
            style={{ width: `${clamp(status.trustScore, 0, 100)}%` }}
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
              {status.blinkStats.blinkRatePerMin ? status.blinkStats.blinkRatePerMin.toFixed(1) : '--'}{' '}
              /min
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

async function maybeLogStatus(
  meetingId: string | undefined,
  participantId: string | undefined,
  status: DeepfakeStatus,
  evidenceCanvas?: HTMLCanvasElement
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
      participantId,
      trustScore: status.trustScore,
      isLikelyFake: status.isLikelyFake,
      gazeDirection: status.gazeDirection,
      blinkRatePerMin: status.blinkStats.blinkRatePerMin,
      microMovementsScore: status.behavioralSignals.microMovementsScore,
      gazeShiftFrequency: status.behavioralSignals.gazeShiftFrequency,
      snapshotJpegDataUrl,
    });
  } catch (err) {
    // Intentionally ignore logging errors in UI
    console.warn('Deepfake log error', err);
  }
}

function maybeCaptureEvidenceSnapshot(canvas: HTMLCanvasElement): string | undefined {
  // Keep it small to fit request size limits.
  // 320px wide is usually enough as evidence preview.
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function computeLumaStats(imageData: ImageData): { avgLuma: number; lumaVariance: number } {
  const data = imageData.data;
  const len = data.length;
  let sum = 0;
  let sumSq = 0;
  const step = 4 * 4; // sample every 4th pixel to reduce work

  for (let i = 0; i < len; i += step) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    sum += luma;
    sumSq += luma * luma;
  }

  const n = len / step;
  if (!n) {
    return { avgLuma: 0, lumaVariance: 0 };
  }

  const avgLuma = sum / n;
  const variance = sumSq / n - avgLuma * avgLuma;
  return { avgLuma, lumaVariance: variance };
}

function estimateGazeDirection(
  imageData: ImageData,
  width: number,
  height: number
): GazeDirection {
  // This is a very rough placeholder based on brightness distribution
  const data = imageData.data;
  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);

  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;

  const step = 4 * 8;
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;

      if (x < midX) left += luma;
      else right += luma;
      if (y < midY) top += luma;
      else bottom += luma;
    }
  }

  const horizDiff = left - right;
  const vertDiff = top - bottom;
  const horizThresh = (left + right) * 0.05;
  const vertThresh = (top + bottom) * 0.05;

  if (Math.abs(horizDiff) < horizThresh && Math.abs(vertDiff) < vertThresh) {
    return 'center';
  }
  if (Math.abs(horizDiff) > Math.abs(vertDiff)) {
    return horizDiff > 0 ? 'left' : 'right';
  }
  return vertDiff > 0 ? 'up' : 'down';
}

function detectBlink(avgLuma: number, lumaVariance: number): boolean {
  // Another rough heuristic:
  // sudden global darkening + reduced variance may indicate a blink.
  // This should be replaced with eyelid landmarks from a face mesh model.
  if (avgLuma < 40 && lumaVariance < 800) {
    return true;
  }
  return false;
}

export default DeepfakeMonitor;

