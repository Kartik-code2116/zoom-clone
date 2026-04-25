import React, { useEffect, useRef, useState, useCallback } from 'react';
import api from '../services/api';
import { FaceMesh, Results } from '@mediapipe/face_mesh';
import { useRemoteParticipants } from '@livekit/components-react';
import {
  Activity, Shield, Eye, Timer, Zap, Users, AlertTriangle,
  X, ChevronUp, ChevronDown, Wifi, WifiOff, Brain,
} from 'lucide-react';

type GazeDirection = 'center' | 'left' | 'right' | 'up' | 'down' | 'unknown';
type MLServiceStatus = 'initializing' | 'active' | 'offline' | 'no-face';

interface BlinkStats {
  blinkRatePerMin: number;
  lastBlinkAt: number | null;
}

interface BehavioralSignals {
  microMovementsScore: number;
  gazeShiftFrequency: number;
}

export interface DeepfakeStatus {
  trustScore: number;
  isLikelyFake: boolean;
  gazeDirection: GazeDirection;
  blinkStats: BlinkStats;
  behavioralSignals: BehavioralSignals;
  mlResult?: {
    label: string;
    score: number;
    probabilities: { real: number; fake: number };
    features?: {
      total_blinks: number;
      blink_rate: number;
      interval_cv: number;
      yaw_variance: number;
      pitch_variance: number;
      roll_variance: number;
      cnn_score: number;
    };
    frameCount: number;
  };
  frameMetrics?: {
    ear: number;
    blink_detected: boolean;
    yaw?: number;
    pitch?: number;
  };
}

interface DeepfakeMonitorProps {
  onStatusChange?: (status: DeepfakeStatus) => void;
  meetingId?: string;
  participantId?: string;
}

const LEFT_EYE_POINTS  = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE_POINTS = [33,  160, 158, 133, 153, 144];

function getDistance(p1: { x: number; y: number }, p2: { x: number; y: number }) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function calculateEAR(landmarks: any[], indices: number[]) {
  const [p1, p2, p3, p4, p5, p6] = indices.map(i => landmarks[i]);
  const vert1 = getDistance(p2, p6);
  const vert2 = getDistance(p3, p5);
  const horiz = getDistance(p1, p4);
  if (horiz === 0) return 0;
  return (vert1 + vert2) / (2.0 * horiz);
}

function computeTrustScore({ blinkRatePerMin, microMovementsScore, gazeShiftFrequency }: {
  blinkRatePerMin: number; microMovementsScore: number; gazeShiftFrequency: number;
}): number {
  let score = 100;
  if (blinkRatePerMin === 0)       score -= 30;
  else if (blinkRatePerMin < 5)    score -= 15;
  else if (blinkRatePerMin > 45)   score -= 20;
  if (microMovementsScore < 0.2)   score -= 25;
  else if (microMovementsScore < 0.5) score -= 10;
  if (gazeShiftFrequency < 0.1)    score -= 15;
  else if (gazeShiftFrequency > 3) score -= 20;
  return Math.max(0, Math.min(100, score));
}

/** Returns a hex colour for a 0-100 trust score — avoids Tailwind purging dynamic classes. */
function trustColor(score: number): string {
  if (score > 75) return '#10b981'; // emerald-500
  if (score > 50) return '#f59e0b'; // amber-400
  return '#ef4444';                 // red-500
}

const DeepfakeMonitor: React.FC<DeepfakeMonitorProps> = ({
  onStatusChange,
  meetingId,
  participantId,
}) => {
  const canvasRef          = useRef<HTMLCanvasElement | null>(null);
  const faceMeshRef        = useRef<FaceMesh | null>(null);
  const animationFrameRef  = useRef<number | null>(null);
  const panelRef           = useRef<HTMLDivElement>(null);

  const remoteParticipants = useRemoteParticipants();
  const totalParticipants  = remoteParticipants.length + 1;

  const [trustHistory,   setTrustHistory]   = useState<number[]>([100]);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date>(new Date());
  const [mlStatus, setMlStatus]             = useState<MLServiceStatus>('initializing');
  const [showTechDetails, setShowTechDetails] = useState(false);
  const [isVisible, setIsVisible]           = useState(true);

  const [position, setPosition] = useState(() => ({
    x: Math.max(0, (typeof window !== 'undefined' ? window.innerWidth : 1280) - 280),
    y: 16,
  }));
  const [isDragging,      setIsDragging]      = useState(false);
  const [dragStart,       setDragStart]       = useState({ x: 0, y: 0 });
  const [panelWidth,      setPanelWidth]      = useState(260);
  const [panelHeight,     setPanelHeight]     = useState(440);
  const [isResizingWidth, setIsResizingWidth] = useState(false);
  const [isResizingHeight,setIsResizingHeight]= useState(false);
  const MIN_WIDTH = 220; const MAX_WIDTH  = 420;
  const MIN_HEIGHT= 320; const MAX_HEIGHT = 600;

  // Clamp on window resize
  useEffect(() => {
    const onResize = () => setPosition(prev => ({
      x: Math.min(prev.x, window.innerWidth  - panelWidth),
      y: Math.min(prev.y, window.innerHeight - panelHeight),
    }));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [panelWidth, panelHeight]);

  const [status, setStatus] = useState<DeepfakeStatus>({
    trustScore: 100,
    isLikelyFake: false,
    gazeDirection: 'unknown',
    blinkStats: { blinkRatePerMin: 0, lastBlinkAt: null },
    behavioralSignals: { microMovementsScore: 1, gazeShiftFrequency: 0 },
  });

  const mlDataRef        = useRef<DeepfakeStatus['mlResult']>(undefined);
  const frameMetricsRef  = useRef<DeepfakeStatus['frameMetrics']>(undefined);
  const lastAnalyzedAtRef= useRef<number>(0);
  const historyRef       = useRef({
    blinks: [] as number[],
    gazeShifts: 0,
    lastGaze: 'unknown' as GazeDirection,
    lastEAR: 0.3,
    lastLandmarks: null as any[] | null,
  });
  const statsWindowStartRef = useRef<number>(performance.now());
  const BLINK_THRESHOLD = 0.2;

  const findLocalVideoElement = useCallback(() => {
    const selectors = [
      '[data-lk-local-participant="true"] video',
      '.lk-local-participant video',
      '[data-source-id="camera"] video',
      'video[data-lk-video-source="true"]',
      '.lk-participant-tile video',
    ];
    for (const sel of selectors) {
      for (const v of document.querySelectorAll(sel)) {
        if (v instanceof HTMLVideoElement && v.videoWidth > 0) return v;
      }
    }
    for (const v of document.querySelectorAll('video')) {
      if (v instanceof HTMLVideoElement && v.videoWidth > 0 && v.readyState >= 2) return v;
    }
    return null;
  }, []);

  // ── MediaPipe setup ────────────────────────────────────────────────
  useEffect(() => {
    faceMeshRef.current = new FaceMesh({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
    });
    faceMeshRef.current.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    faceMeshRef.current.onResults((r: Results) => onMediaPipeResults(r));

    let frameCount = 0;
    const processFrame = async () => {
      const video = findLocalVideoElement();
      if (video && faceMeshRef.current && canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          canvasRef.current.width  = video.videoWidth  || 640;
          canvasRef.current.height = video.videoHeight || 360;
          ctx.drawImage(video, 0, 0, canvasRef.current.width, canvasRef.current.height);
          frameCount++;
          if (frameCount % 3 === 0) await faceMeshRef.current.send({ image: canvasRef.current });
        }
      }
      animationFrameRef.current = requestAnimationFrame(processFrame);
    };

    const timeout = setTimeout(() => processFrame(), 2000);
    return () => {
      clearTimeout(timeout);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (faceMeshRef.current) faceMeshRef.current.close();
    };
  }, [findLocalVideoElement]);

  // ── MediaPipe result handler ───────────────────────────────────────
  const onMediaPipeResults = (results: Results) => {
    const now   = performance.now();
    const state = historyRef.current;
    let microMovementsScore: number = 1.0;
    let gazeDirection: GazeDirection = state.lastGaze;

    if (results.multiFaceLandmarks?.length > 0) {
      const landmarks = results.multiFaceLandmarks[0];
      const leftEAR   = calculateEAR(landmarks, LEFT_EYE_POINTS);
      const rightEAR  = calculateEAR(landmarks, RIGHT_EYE_POINTS);
      const ear       = (leftEAR + rightEAR) / 2.0;

      if (ear < BLINK_THRESHOLD && state.lastEAR >= BLINK_THRESHOLD) state.blinks.push(now);
      state.lastEAR = ear;

      const nose       = landmarks[1];
      const leftCheek  = landmarks[234];
      const rightCheek = landmarks[454];
      const faceWidth  = getDistance(leftCheek, rightCheek);
      if (faceWidth > 0) {
        const ratio = getDistance(nose, leftCheek) / faceWidth;
        gazeDirection = ratio < 0.35 ? 'left' : ratio > 0.65 ? 'right' : 'center';
      }

      if (state.lastLandmarks) {
        const jitter = getDistance(nose, state.lastLandmarks[1]);
        microMovementsScore = jitter < 0.0001 ? 0.1 : jitter > 0.05 ? 0.3 : 0.9;
      }
      state.lastLandmarks = landmarks;
    } else {
      microMovementsScore = 0.0;
    }

    if (gazeDirection !== state.lastGaze && gazeDirection !== 'unknown') {
      state.gazeShifts++;
      state.lastGaze = gazeDirection;
    }

    state.blinks = state.blinks.filter(t => now - t < 60000);
    const windowSec = (now - statsWindowStartRef.current) / 1000;
    if (windowSec > 30) { statsWindowStartRef.current = now; state.gazeShifts = 0; }

    const blinkRatePerMin    = state.blinks.length;
    const gazeShiftFrequency = windowSec > 0 ? state.gazeShifts / Math.max(windowSec, 1) : 0;
    const behavioralScore    = computeTrustScore({ blinkRatePerMin, microMovementsScore, gazeShiftFrequency });

    // Trigger ML analysis every 5 s
    if (now - lastAnalyzedAtRef.current > 5000 && canvasRef.current) {
      lastAnalyzedAtRef.current = now;
      analyzeFrameWithML(canvasRef.current, meetingId, participantId).then(res => {
        if (res) {
          mlDataRef.current       = res.mlResult;
          frameMetricsRef.current = res.frameMetrics;
          setMlStatus(res.mlResult ? 'active' : 'no-face');
        } else {
          setMlStatus('no-face');
        }
      }).catch(() => setMlStatus('offline'));
    }

    let trustScore = behavioralScore;
    if (mlDataRef.current) {
      const mlTrust = mlDataRef.current.probabilities.real * 100;
      trustScore    = behavioralScore * 0.3 + mlTrust * 0.7;
    }

    const nextStatus: DeepfakeStatus = {
      trustScore,
      isLikelyFake: trustScore < 40,
      gazeDirection,
      blinkStats: { blinkRatePerMin, lastBlinkAt: state.blinks.at(-1) ?? null },
      behavioralSignals: { microMovementsScore, gazeShiftFrequency },
      mlResult: mlDataRef.current,
      frameMetrics: frameMetricsRef.current,
    };

    setStatus(prev => {
      if (Math.abs(prev.trustScore - nextStatus.trustScore) > 2 || nextStatus.isLikelyFake !== prev.isLikelyFake)
        onStatusChange?.(nextStatus);
      return nextStatus;
    });

    maybeLogStatus(meetingId, participantId, nextStatus, nextStatus.isLikelyFake ? canvasRef.current : undefined);
  };

  // History ticker
  useEffect(() => {
    const id = setInterval(() => {
      setLastUpdateTime(new Date());
      setTrustHistory(prev => [...prev, status.trustScore].slice(-20));
    }, 1000);
    return () => clearInterval(id);
  }, [status.trustScore]);

  // ── Drag handlers ──────────────────────────────────────────────────
  const handleDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, .resize-handle')) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const resizeStartRef = useRef({ rightEdge: 0 });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (isResizingWidth && panelRef.current) {
        if (!resizeStartRef.current.rightEdge)
          resizeStartRef.current.rightEdge = panelRef.current.getBoundingClientRect().right;
        const w = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, resizeStartRef.current.rightEdge - e.clientX));
        setPanelWidth(w);
        setPosition(prev => ({ ...prev, x: resizeStartRef.current.rightEdge - w }));
      }
      if (isResizingHeight && panelRef.current) {
        setPanelHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT,
          e.clientY - panelRef.current.getBoundingClientRect().top)));
      }
      if (!isDragging) return;
      const maxX = window.innerWidth  - (panelRef.current?.offsetWidth  || 260);
      const maxY = window.innerHeight - (panelRef.current?.offsetHeight || 440);
      setPosition({
        x: Math.max(0, Math.min(e.clientX - dragStart.x, maxX)),
        y: Math.max(0, Math.min(e.clientY - dragStart.y, maxY)),
      });
    };
    const onUp = () => {
      setIsDragging(false); setIsResizingWidth(false); setIsResizingHeight(false);
      resizeStartRef.current.rightEdge = 0;
      document.body.style.cursor = ''; document.body.style.userSelect = '';
    };
    if (isDragging || isResizingWidth || isResizingHeight) {
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor    = isResizingWidth ? 'ew-resize' : isResizingHeight ? 'ns-resize' : 'grabbing';
      document.body.style.userSelect = 'none';
    }
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [isDragging, isResizingWidth, isResizingHeight, dragStart]);

  // ── Derived colours (inline styles — never purged by Tailwind) ─────
  const tc          = trustColor(status.trustScore);
  const isFake      = status.isLikelyFake;
  const moveColor   = status.behavioralSignals.microMovementsScore > 0.7 ? '#10b981'
                    : status.behavioralSignals.microMovementsScore > 0.3 ? '#f59e0b' : '#ef4444';

  const mlStatusConfig = {
    initializing: { color: '#f59e0b', label: 'Connecting…', Icon: Activity },
    active:        { color: '#10b981', label: 'AI Active',   Icon: Wifi     },
    offline:       { color: '#ef4444', label: 'ML Offline',  Icon: WifiOff  },
    'no-face':     { color: '#64748b', label: 'No face',     Icon: Eye      },
  }[mlStatus];

  return (
    <>
      {/* Collapsed show button */}
      {!isVisible && (
        <button onClick={() => setIsVisible(true)}
          className="fixed z-40 right-4 top-20 bg-surface-2/90 text-white p-2 rounded-xl
                     shadow-lg border border-white/10 hover:bg-surface-3 transition-all">
          <ChevronUp className="w-5 h-5" />
        </button>
      )}

      {isVisible && (
        <div ref={panelRef}
          className={`fixed z-40 rounded-xl text-white shadow-2xl backdrop-blur-sm
                      transition-all duration-300
                      ${isFake
                        ? 'border-2 border-red-500/60 bg-slate-900/90'
                        : 'border border-slate-700/80 bg-slate-900/85'}`}
          style={{
            left: position.x, top: position.y,
            width: panelWidth, height: panelHeight,
            boxShadow: isFake ? '0 0 24px rgba(239,68,68,0.2)' : undefined,
          }}>

          {/* ── Header ───────────────────────────────────────── */}
          <div onMouseDown={handleDragStart}
            className="px-4 py-3 border-b border-white/8 flex items-center justify-between
                       cursor-grab active:cursor-grabbing select-none">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">AI Guard</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold
                                ${isFake ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                                         : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'}`}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ backgroundColor: isFake ? '#ef4444' : '#10b981' }} />
                {isFake ? 'ALERT' : 'STABLE'}
              </span>
              <button onClick={e => { e.stopPropagation(); setIsVisible(false); }}
                className="p-1 hover:bg-white/8 rounded-lg transition-colors">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
          </div>

          {/* ── Resize handles ───────────────────────────────── */}
          <div onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setIsResizingWidth(true); }}
            className="resize-handle absolute left-0 top-14 bottom-0 w-3 cursor-ew-resize z-20
                       flex items-center justify-center group hover:bg-primary/10">
            <div className="w-0.5 h-5 rounded-full bg-slate-600 group-hover:bg-primary transition-colors" />
          </div>
          <div onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setIsResizingHeight(true); }}
            className="resize-handle absolute left-0 right-0 bottom-0 h-3 cursor-ns-resize z-20
                       flex items-center justify-center group hover:bg-primary/10">
            <div className="w-5 h-0.5 rounded-full bg-slate-600 group-hover:bg-primary transition-colors" />
          </div>

          {/* ── Body ─────────────────────────────────────────── */}
          <div className="px-4 py-3 space-y-3 overflow-y-auto" style={{ height: 'calc(100% - 56px)' }}>

            {/* Timestamp + participants */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-xs text-slate-400">{totalParticipants} participant{totalParticipants !== 1 ? 's' : ''}</span>
              </div>
              <span className="text-[10px] text-slate-500">{lastUpdateTime.toLocaleTimeString()}</span>
            </div>

            {/* ── Trust score ──────────────────────────────── */}
            <div className="p-3 rounded-xl border bg-slate-800/40"
              style={{ borderColor: tc + '40' }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4" style={{ color: tc }} />
                  <span className="text-xs text-slate-300">Trust Score</span>
                </div>
                <span className="text-xl font-bold" style={{ color: tc }}>
                  {Math.round(status.trustScore)}%
                </span>
              </div>
              {/* Mini bar chart */}
              <div className="flex items-end gap-0.5 h-7 mb-2">
                {trustHistory.map((val, i) => (
                  <div key={i} className="flex-1 rounded-t-sm transition-all duration-300"
                    style={{
                      height: `${val}%`,
                      backgroundColor: trustColor(val),
                      opacity: 0.25 + (i / trustHistory.length) * 0.75,
                    }} />
                ))}
              </div>
              {/* Progress bar */}
              <div className="h-2 w-full rounded-full bg-slate-700 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(0, Math.min(100, status.trustScore))}%`, backgroundColor: tc }} />
              </div>
            </div>

            {/* ── ML service status ─────────────────────────── */}
            <div className="p-3 rounded-xl border border-primary/20 bg-primary/5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" />
                  <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wide">
                    SecureMeet AI Model
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: mlStatusConfig.color,
                             animation: mlStatus !== 'offline' ? 'pulse 2s infinite' : 'none' }} />
                  <span className="text-[10px] font-medium" style={{ color: mlStatusConfig.color }}>
                    {mlStatusConfig.label}
                  </span>
                </div>
              </div>

              {status.mlResult ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-bold ${
                      status.mlResult.label.toLowerCase() === 'real' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {status.mlResult.label.toUpperCase()}
                    </span>
                    <span className="text-xs text-slate-400">
                      {(status.mlResult.score * 100).toFixed(0)}% confidence
                    </span>
                  </div>
                  {/* Real / Fake probability bars */}
                  <div className="mt-2 space-y-1">
                    {[
                      { label: 'Real', val: status.mlResult.probabilities.real, color: '#10b981' },
                      { label: 'Fake', val: status.mlResult.probabilities.fake, color: '#ef4444' },
                    ].map(({ label, val, color }) => (
                      <div key={label} className="flex items-center gap-2">
                        <span className="text-[10px] w-6 text-slate-500">{label}</span>
                        <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${val * 100}%`, backgroundColor: color }} />
                        </div>
                        <span className="text-[10px] w-6 text-right" style={{ color }}>
                          {(val * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1.5">
                    {status.mlResult.frameCount} frames analyzed
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 mt-1">
                  {mlStatus === 'initializing' && (
                    <span className="w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin flex-shrink-0" />
                  )}
                  <span className="text-xs text-slate-500">
                    {mlStatus === 'offline'  ? 'ML service offline — behavioral analysis only'
                     : mlStatus === 'no-face' ? 'No face detected in frame'
                     : 'Collecting frames for analysis…'}
                  </span>
                </div>
              )}
            </div>

            {/* ── Behavioral metrics ────────────────────────── */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { Icon: Eye,      label: 'Gaze',       value: status.gazeDirection,                             unit: '' },
                { Icon: Timer,    label: 'Blink Rate',  value: status.blinkStats.blinkRatePerMin.toString(),    unit: '/min' },
                { Icon: Activity, label: 'EAR',         value: status.frameMetrics?.ear?.toFixed(3) ?? '—',    unit: '' },
                { Icon: Zap,      label: 'ML Frames',   value: (status.mlResult?.frameCount ?? 0).toString(),  unit: '' },
              ].map(({ Icon, label, value, unit }) => (
                <div key={label} className="bg-slate-800/50 rounded-lg p-2">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Icon className="w-3 h-3 text-slate-400" />
                    <span className="text-[10px] text-slate-400">{label}</span>
                  </div>
                  <span className="text-sm font-semibold text-white capitalize">{value}</span>
                  {unit && <span className="text-[10px] text-slate-500 ml-0.5">{unit}</span>}
                </div>
              ))}
            </div>

            {/* Micro movements bar */}
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-300">Micro-movements</span>
                <span className="text-xs font-semibold" style={{ color: moveColor }}>
                  {(status.behavioralSignals.microMovementsScore * 100).toFixed(0)}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-700 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${status.behavioralSignals.microMovementsScore * 100}%`, backgroundColor: moveColor }} />
              </div>
            </div>

            {/* ── Deepfake alert ────────────────────────────── */}
            {isFake && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30
                              animate-pulse-ring">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-semibold text-red-400">Deepfake Detected</div>
                  <div className="text-[10px] text-red-300/70 mt-0.5">
                    Suspicious patterns in video feed. Trust score below 40%.
                  </div>
                </div>
              </div>
            )}

            {/* ── Technical details (collapsed by default) ─── */}
            {status.mlResult?.features && (
              <div>
                <button onClick={() => setShowTechDetails(!showTechDetails)}
                  className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-300
                             transition-colors w-full mt-1">
                  <ChevronDown className={`w-3 h-3 transition-transform ${showTechDetails ? 'rotate-180' : ''}`} />
                  {showTechDetails ? 'Hide' : 'Show'} technical details
                </button>
                {showTechDetails && (
                  <div className="mt-2 border-t border-slate-700/50 pt-2 animate-in">
                    <div className="text-[10px] text-slate-400 font-mono uppercase mb-2">ML Feature Vector</div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                      {[
                        ['Blinks', status.mlResult.features.total_blinks],
                        ['Rate',   status.mlResult.features.blink_rate.toFixed(1) + '/min'],
                        ['Yaw Var',status.mlResult.features.yaw_variance.toFixed(2)],
                        ['CNN Score',(status.mlResult.features.cnn_score * 100).toFixed(0) + '%'],
                        ['Interval CV',status.mlResult.features.interval_cv.toFixed(3)],
                        ['Roll Var',status.mlResult.features.roll_variance.toFixed(2)],
                      ].map(([k, v]) => (
                        <div key={k as string} className="flex justify-between">
                          <span className="text-slate-500">{k}:</span>
                          <span className="text-slate-300 font-mono">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <canvas ref={canvasRef} className="hidden" />
        </div>
      )}
    </>
  );
};

// ── ML API call ────────────────────────────────────────────────────────
export async function analyzeFrameWithML(
  canvas: HTMLCanvasElement,
  meetingId?: string,
  participantId?: string,
): Promise<{ mlResult: DeepfakeStatus['mlResult']; frameMetrics: DeepfakeStatus['frameMetrics'] } | undefined> {
  try {
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.8);
    const { data }    = await api.post('/deepfake/analyze', { imageBase64, meetingId, participantId });
    if (!data.faceDetected) return undefined;
    return {
      mlResult: data.label ? {
        label:         data.label,
        score:         data.score ?? 0,
        probabilities: data.probabilities ?? { real: 0.5, fake: 0.5 },
        features:      data.mlModel?.features ?? undefined,
        frameCount:    data.mlModel?.frameCount ?? 0,
      } : undefined,
      frameMetrics: data.frameMetrics ?? undefined,
    };
  } catch {
    return undefined;
  }
}

async function maybeLogStatus(
  meetingId: string | undefined,
  participantId: string | undefined,
  status: DeepfakeStatus,
  evidenceCanvas?: HTMLCanvasElement | null,
) {
  if (!meetingId) return;
  const now = performance.now();
  if ((window as any).__deepfake_lastSentLogAt && now - (window as any).__deepfake_lastSentLogAt < 5000) return;
  (window as any).__deepfake_lastSentLogAt = now;
  const snapshotJpegDataUrl = status.isLikelyFake && evidenceCanvas
    ? maybeCaptureEvidenceSnapshot(evidenceCanvas) : undefined;
  try {
    await api.post('/deepfake/log', {
      meetingId,
      participantId:      participantId || 'unknown',
      trustScore:         status.trustScore,
      isLikelyFake:       status.isLikelyFake,
      gazeDirection:      status.gazeDirection,
      blinkRatePerMin:    status.blinkStats.blinkRatePerMin,
      microMovementsScore:status.behavioralSignals.microMovementsScore,
      gazeShiftFrequency: status.behavioralSignals.gazeShiftFrequency,
      snapshotJpegDataUrl,
      mlLabel:         status.mlResult?.label,
      mlConfidence:    status.mlResult?.score,
      mlProbabilities: status.mlResult?.probabilities,
      mlFeatures:      status.mlResult?.features,
      frameMetrics:    status.frameMetrics,
    });
  } catch { /* silent */ }
}

function maybeCaptureEvidenceSnapshot(canvas: HTMLCanvasElement): string | undefined {
  const targetW = 320;
  const scale   = canvas.width ? targetW / canvas.width : 1;
  if (!Number.isFinite(scale) || scale <= 0) return undefined;
  const tmp = document.createElement('canvas');
  tmp.width  = targetW;
  tmp.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx  = tmp.getContext('2d');
  if (!ctx) return undefined;
  ctx.drawImage(canvas, 0, 0, tmp.width, tmp.height);
  try { return tmp.toDataURL('image/jpeg', 0.6); } catch { return undefined; }
}

export default DeepfakeMonitor;
