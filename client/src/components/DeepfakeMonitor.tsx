import React, { useEffect, useRef, useState, useCallback } from 'react';
import api from '../services/api';
import { FaceMesh, Results } from '@mediapipe/face_mesh';
import { useRemoteParticipants } from '@livekit/components-react';
import { Activity, Shield, Eye, Timer, Zap, Users, AlertTriangle, X, ChevronUp } from 'lucide-react';

type GazeDirection = 'center' | 'left' | 'right' | 'up' | 'down' | 'unknown';

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
    // FIX: updated to match what ml_service.py actually returns
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

const LEFT_EYE_POINTS = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE_POINTS = [33, 160, 158, 133, 153, 144];

function getDistance(p1: { x: number; y: number }, p2: { x: number; y: number }) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function calculateEAR(landmarks: any[], indices: number[]) {
  const [p1, p2, p3, p4, p5, p6] = indices.map((i) => landmarks[i]);
  const vert1 = getDistance(p2, p6);
  const vert2 = getDistance(p3, p5);
  const horiz = getDistance(p1, p4);
  if (horiz === 0) return 0;
  return (vert1 + vert2) / (2.0 * horiz);
}

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
  if (blinkRatePerMin === 0) score -= 30;
  else if (blinkRatePerMin < 5) score -= 15;
  else if (blinkRatePerMin > 45) score -= 20;

  if (microMovementsScore < 0.2) score -= 25;
  else if (microMovementsScore < 0.5) score -= 10;

  if (gazeShiftFrequency < 0.1) score -= 15;
  else if (gazeShiftFrequency > 3.0) score -= 20;

  return Math.max(0, Math.min(100, score));
}

const DeepfakeMonitor: React.FC<DeepfakeMonitorProps> = ({
  onStatusChange,
  meetingId,
  participantId,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const faceMeshRef = useRef<FaceMesh | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const remoteParticipants = useRemoteParticipants();
  const totalParticipants = remoteParticipants.length + 1;

  const [trustHistory, setTrustHistory] = useState<number[]>([100]);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date>(new Date());
  // FIX: removed unused fps state

  // FIX: initialise position safely using a lazy function to avoid stale window.innerWidth
  const [position, setPosition] = useState(() => ({
    x: Math.max(0, (typeof window !== 'undefined' ? window.innerWidth : 1280) - 280),
    y: 16,
  }));
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const [panelWidth, setPanelWidth] = useState(256);
  const [panelHeight, setPanelHeight] = useState(420);
  const [isVisible, setIsVisible] = useState(true);
  const [isResizingWidth, setIsResizingWidth] = useState(false);
  const [isResizingHeight, setIsResizingHeight] = useState(false);
  const MIN_WIDTH = 200;
  const MAX_WIDTH = 400;
  const MIN_HEIGHT = 300;
  const MAX_HEIGHT = 600;

  // FIX: clamp position on resize so panel never goes off-screen
  useEffect(() => {
    const onResize = () => {
      setPosition((prev) => ({
        x: Math.min(prev.x, window.innerWidth - panelWidth),
        y: Math.min(prev.y, window.innerHeight - panelHeight),
      }));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [panelWidth, panelHeight]);

  const [status, setStatus] = useState<DeepfakeStatus>({
    trustScore: 100,
    isLikelyFake: false,
    gazeDirection: 'unknown',
    blinkStats: { blinkRatePerMin: 0, lastBlinkAt: null },
    behavioralSignals: { microMovementsScore: 1, gazeShiftFrequency: 0 },
    mlResult: undefined,
    frameMetrics: undefined,
  });

  const mlDataRef = useRef<DeepfakeStatus['mlResult']>(undefined);
  const frameMetricsRef = useRef<DeepfakeStatus['frameMetrics']>(undefined);
  const lastAnalyzedAtRef = useRef<number>(0);

  const historyRef = useRef<{
    blinks: number[];
    gazeShifts: number;
    lastGaze: GazeDirection;
    lastEAR: number;
    lastLandmarks: any[] | null;
  }>({
    blinks: [],
    gazeShifts: 0,
    lastGaze: 'unknown',
    lastEAR: 0.3,
    lastLandmarks: null,
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
    for (const selector of selectors) {
      const videos = document.querySelectorAll(selector);
      for (const video of videos) {
        if (video instanceof HTMLVideoElement && video.videoWidth > 0) return video;
      }
    }
    const allVideos = document.querySelectorAll('video');
    for (const video of allVideos) {
      if (video.videoWidth > 0 && video.readyState >= 2) return video;
    }
    return null;
  }, []);

  useEffect(() => {
    faceMeshRef.current = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });
    faceMeshRef.current.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    faceMeshRef.current.onResults((results: Results) => {
      onMediaPipeResults(results);
    });

    let frameCount = 0;
    const processFrame = async () => {
      const video = findLocalVideoElement();
      if (video && faceMeshRef.current && canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          canvasRef.current.width = video.videoWidth || 640;
          canvasRef.current.height = video.videoHeight || 360;
          ctx.drawImage(video, 0, 0, canvasRef.current.width, canvasRef.current.height);
          frameCount++;
          if (frameCount % 3 === 0) {
            await faceMeshRef.current.send({ image: canvasRef.current });
          }
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
  }, [findLocalVideoElement, meetingId, participantId]);

  const onMediaPipeResults = (results: Results) => {
    const now = performance.now();
    const state = historyRef.current;
    let microMovementsScore = 1.0;
    let gazeDirection: GazeDirection = state.lastGaze;

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      const landmarks = results.multiFaceLandmarks[0];
      const leftEAR = calculateEAR(landmarks, LEFT_EYE_POINTS);
      const rightEAR = calculateEAR(landmarks, RIGHT_EYE_POINTS);
      const ear = (leftEAR + rightEAR) / 2.0;

      if (ear < BLINK_THRESHOLD && state.lastEAR >= BLINK_THRESHOLD) {
        state.blinks.push(now);
      }
      state.lastEAR = ear;

      const nose = landmarks[1];
      const leftCheek = landmarks[234];
      const rightCheek = landmarks[454];
      const faceWidth = getDistance(leftCheek, rightCheek);
      if (faceWidth > 0) {
        const ratio = getDistance(nose, leftCheek) / faceWidth;
        if (ratio < 0.35) gazeDirection = 'left';
        else if (ratio > 0.65) gazeDirection = 'right';
        else gazeDirection = 'center';
      }

      if (state.lastLandmarks) {
        const jitter = getDistance(nose, state.lastLandmarks[1]);
        if (jitter < 0.0001) microMovementsScore = 0.1;
        else if (jitter > 0.05) microMovementsScore = 0.3;
        else microMovementsScore = 0.9;
      }
      state.lastLandmarks = landmarks;
    } else {
      microMovementsScore = 0.0;
    }

    if (gazeDirection !== state.lastGaze && gazeDirection !== 'unknown') {
      state.gazeShifts += 1;
      state.lastGaze = gazeDirection;
    }

    state.blinks = state.blinks.filter((t) => now - t < 60000);
    const windowDurationSec = (now - statsWindowStartRef.current) / 1000;
    if (windowDurationSec > 30) {
      statsWindowStartRef.current = now;
      state.gazeShifts = 0;
    }

    const blinkRatePerMin = state.blinks.length;
    const gazeShiftFrequency = windowDurationSec > 0 ? state.gazeShifts / Math.max(windowDurationSec, 1) : 0;
    const behavioralTrustScore = computeTrustScore({ blinkRatePerMin, microMovementsScore, gazeShiftFrequency });

    if (now - lastAnalyzedAtRef.current > 5000 && canvasRef.current) {
      lastAnalyzedAtRef.current = now;
      analyzeFrameWithML(canvasRef.current, meetingId, participantId).then((res) => {
        if (res) {
          mlDataRef.current = res.mlResult;
          frameMetricsRef.current = res.frameMetrics;
        }
      });
    }

    let trustScore = behavioralTrustScore;
    if (mlDataRef.current) {
      const mlTrust = mlDataRef.current.probabilities.real * 100;
      trustScore = behavioralTrustScore * 0.3 + mlTrust * 0.7;
    }

    const nextStatus: DeepfakeStatus = {
      trustScore,
      isLikelyFake: trustScore < 40,
      gazeDirection,
      blinkStats: {
        blinkRatePerMin,
        lastBlinkAt: state.blinks.length > 0 ? state.blinks[state.blinks.length - 1] : null,
      },
      behavioralSignals: { microMovementsScore, gazeShiftFrequency },
      mlResult: mlDataRef.current,
      frameMetrics: frameMetricsRef.current,
    };

    setStatus((prev) => {
      if (Math.abs(prev.trustScore - nextStatus.trustScore) > 2 || nextStatus.isLikelyFake !== prev.isLikelyFake) {
        if (onStatusChange) onStatusChange(nextStatus);
      }
      return nextStatus;
    });

    maybeLogStatus(meetingId, participantId, nextStatus, nextStatus.isLikelyFake ? canvasRef.current : undefined);
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setLastUpdateTime(new Date());
      setTrustHistory((prev) => [...prev, status.trustScore].slice(-20));
    }, 1000);
    return () => clearInterval(interval);
  }, [status.trustScore]);

  const handleDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('.resize-handle')) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleResizeWidthStart = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setIsResizingWidth(true); };
  const handleResizeHeightStart = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setIsResizingHeight(true); };

  const resizeStartRef = useRef({ rightEdge: 0, bottomEdge: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingWidth && panelRef.current) {
        if (resizeStartRef.current.rightEdge === 0)
          resizeStartRef.current.rightEdge = panelRef.current.getBoundingClientRect().right;
        const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, resizeStartRef.current.rightEdge - e.clientX));
        setPanelWidth(newWidth);
        setPosition((prev) => ({ ...prev, x: resizeStartRef.current.rightEdge - newWidth }));
      }
      if (isResizingHeight && panelRef.current) {
        const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, e.clientY - panelRef.current.getBoundingClientRect().top));
        setPanelHeight(newHeight);
      }
      if (!isDragging) return;
      const maxX = window.innerWidth - (panelRef.current?.offsetWidth || 256);
      const maxY = window.innerHeight - (panelRef.current?.offsetHeight || 420);
      setPosition({
        x: Math.max(0, Math.min(e.clientX - dragStart.x, maxX)),
        y: Math.max(0, Math.min(e.clientY - dragStart.y, maxY)),
      });
    };
    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizingWidth(false);
      setIsResizingHeight(false);
      resizeStartRef.current = { rightEdge: 0, bottomEdge: 0 };
    };
    if (isDragging || isResizingWidth || isResizingHeight) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = isResizingWidth ? 'ew-resize' : isResizingHeight ? 'ns-resize' : 'grabbing';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, isResizingWidth, isResizingHeight, dragStart]);

  const riskColor = status.trustScore > 75 ? 'emerald' : status.trustScore > 50 ? 'yellow' : 'red';
  const riskBgClass = { emerald: 'bg-emerald-500', yellow: 'bg-yellow-400', red: 'bg-red-500' }[riskColor];
  const riskTextClass = { emerald: 'text-emerald-400', yellow: 'text-yellow-400', red: 'text-red-400' }[riskColor];
  const riskBorderClass = { emerald: 'border-emerald-500/30', yellow: 'border-yellow-500/30', red: 'border-red-500/30' }[riskColor];

  return (
    <>
      {!isVisible && (
        <button
          onClick={() => setIsVisible(true)}
          className="fixed z-40 right-4 top-20 bg-slate-900/90 text-white p-2 rounded-lg shadow-lg border border-slate-700 hover:bg-slate-800 transition-colors"
          title="Show DeepFake Guard"
        >
          <ChevronUp className="w-5 h-5" />
        </button>
      )}

      {isVisible && (
        <div
          ref={panelRef}
          className={`fixed z-40 rounded-lg bg-slate-900/80 text-white shadow-lg border border-slate-700 backdrop-blur-sm ${isDragging ? 'shadow-primary/20' : ''}`}
          style={{ left: position.x, top: position.y, width: panelWidth, height: panelHeight }}
        >
          <div onMouseDown={handleDragStart} className="px-4 py-3 border-b border-slate-700 flex items-center justify-between cursor-grab active:cursor-grabbing">
            <div className="text-sm font-semibold">DeepFake Guard</div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${status.isLikelyFake ? 'bg-red-600/80 text-white' : 'bg-emerald-600/80 text-white'}`}>
                {status.isLikelyFake ? 'RISK' : 'STABLE'}
              </span>
              <button onClick={(e) => { e.stopPropagation(); setIsVisible(false); }} className="p-1 hover:bg-slate-700 rounded transition-colors" title="Hide panel">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
          </div>

          <div onMouseDown={handleResizeWidthStart} className={`resize-handle absolute left-0 top-14 bottom-0 w-3 cursor-ew-resize z-20 flex items-center justify-center group ${isResizingWidth ? 'bg-primary/20' : 'hover:bg-primary/10'}`} title="Drag to resize width">
            <div className={`w-0.5 h-6 rounded-full transition-colors ${isResizingWidth ? 'bg-primary' : 'bg-slate-600 group-hover:bg-primary'}`} />
          </div>

          <div onMouseDown={handleResizeHeightStart} className={`resize-handle absolute left-0 right-0 bottom-0 h-3 cursor-ns-resize z-20 flex items-center justify-center group ${isResizingHeight ? 'bg-primary/20' : 'hover:bg-primary/10'}`} title="Drag to resize height">
            <div className={`w-6 h-0.5 rounded-full transition-colors ${isResizingHeight ? 'bg-primary' : 'bg-slate-600 group-hover:bg-primary'}`} />
          </div>

          <div className="px-4 py-3 space-y-3 overflow-y-auto" style={{ height: 'calc(100% - 60px)' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className={`w-4 h-4 ${riskTextClass} animate-pulse`} />
                <span className="text-xs text-slate-400">Live Analysis</span>
              </div>
              <span className="text-[10px] text-slate-500">{lastUpdateTime.toLocaleTimeString()}</span>
            </div>

            <div className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-3 py-2">
              <Users className="w-4 h-4 text-slate-400" />
              <span className="text-xs text-slate-300">Participants:</span>
              <span className="text-sm font-semibold text-white">{totalParticipants}</span>
              <span className="text-[10px] text-slate-500">(You + {remoteParticipants.length} remote)</span>
            </div>

            <div className={`p-3 rounded-lg border ${riskBorderClass} bg-slate-800/30`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Shield className={`w-4 h-4 ${riskTextClass}`} />
                  <span className="text-xs text-slate-300">Trust Score</span>
                </div>
                <span className={`text-lg font-bold ${riskTextClass}`}>{Math.round(status.trustScore)}%</span>
              </div>
              <div className="flex items-end gap-0.5 h-8 mb-2">
                {trustHistory.map((val, i) => (
                  <div key={i} className={`flex-1 ${riskBgClass} rounded-t-sm transition-all duration-300`} style={{ height: `${val}%`, opacity: 0.3 + (i / trustHistory.length) * 0.7 }} />
                ))}
              </div>
              <div className="h-2 w-full rounded-full bg-slate-700 overflow-hidden">
                <div className={`h-full ${riskBgClass} transition-all duration-500`} style={{ width: `${Math.max(0, Math.min(100, status.trustScore))}%` }} />
              </div>
            </div>

            {status.mlResult ? (
              <div className="p-3 rounded-lg border border-primary/30 bg-primary/5">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-primary" />
                  <span className="text-[10px] text-slate-400 font-mono uppercase">ZPPM AI MODEL</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-bold ${status.mlResult.label.toLowerCase() === 'real' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {status.mlResult.label.toUpperCase()}
                  </span>
                  <span className="text-xs text-slate-400">{(status.mlResult.score * 100).toFixed(0)}% confidence</span>
                </div>
                <div className="flex gap-2 mt-2 text-[10px]">
                  <span className="text-emerald-400">Real: {(status.mlResult.probabilities.real * 100).toFixed(0)}%</span>
                  <span className="text-slate-600">|</span>
                  <span className="text-red-400">Fake: {(status.mlResult.probabilities.fake * 100).toFixed(0)}%</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-slate-500">
                <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <span className="text-xs">Initializing AI model...</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-slate-800/50 rounded-lg p-2">
                <div className="flex items-center gap-1.5 mb-1"><Eye className="w-3 h-3 text-slate-400" /><span className="text-[10px] text-slate-400">Gaze</span></div>
                <div className="text-sm font-medium text-white capitalize">{status.gazeDirection}</div>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-2">
                <div className="flex items-center gap-1.5 mb-1"><Timer className="w-3 h-3 text-slate-400" /><span className="text-[10px] text-slate-400">Blink Rate</span></div>
                <div className="text-sm font-medium text-white">{status.blinkStats.blinkRatePerMin} <span className="text-[10px] text-slate-500">/min</span></div>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-2">
                <div className="text-[10px] text-slate-400 mb-1">EAR Ratio</div>
                <div className="text-sm font-medium text-white">{status.frameMetrics?.ear?.toFixed(3) || '---'}</div>
              </div>
              <div className="bg-slate-800/50 rounded-lg p-2">
                <div className="text-[10px] text-slate-400 mb-1">ML Frames</div>
                <div className="text-sm font-medium text-white">{status.mlResult?.frameCount || 0}</div>
              </div>
            </div>

            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-300">Micro Movements</span>
                <span className={`text-xs font-medium ${status.behavioralSignals.microMovementsScore > 0.7 ? 'text-emerald-400' : status.behavioralSignals.microMovementsScore > 0.3 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {(status.behavioralSignals.microMovementsScore * 100).toFixed(0)}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-700 overflow-hidden">
                <div className={`h-full transition-all duration-500 ${status.behavioralSignals.microMovementsScore > 0.7 ? 'bg-emerald-500' : status.behavioralSignals.microMovementsScore > 0.3 ? 'bg-yellow-400' : 'bg-red-500'}`} style={{ width: `${status.behavioralSignals.microMovementsScore * 100}%` }} />
              </div>
            </div>

            {status.isLikelyFake && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-medium text-red-400">DeepFake Detected</div>
                  <div className="text-[10px] text-red-300/80 mt-0.5">Suspicious patterns detected in video feed</div>
                </div>
              </div>
            )}

            {/* FIX: display actual fields ml_service.py returns */}
            {status.mlResult?.features && (
              <div className="border-t border-slate-700/50 pt-2">
                <div className="text-[10px] text-slate-400 font-mono uppercase mb-2">ML Features</div>
                <div className="grid grid-cols-2 gap-1 text-[10px]">
                  <div className="flex justify-between"><span className="text-slate-500">Blinks:</span><span className="text-slate-300">{status.mlResult.features.total_blinks}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Rate:</span><span className="text-slate-300">{status.mlResult.features.blink_rate.toFixed(1)}/min</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Yaw Var:</span><span className="text-slate-300">{status.mlResult.features.yaw_variance.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">CNN Score:</span><span className="text-slate-300">{(status.mlResult.features.cnn_score * 100).toFixed(0)}%</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Interval CV:</span><span className="text-slate-300">{status.mlResult.features.interval_cv.toFixed(3)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Roll Var:</span><span className="text-slate-300">{status.mlResult.features.roll_variance.toFixed(2)}</span></div>
                </div>
              </div>
            )}
          </div>

          <canvas ref={canvasRef} className="hidden" />
        </div>
      )}
    </>
  );
};

// FIX: reads correct fields from server response — data.label, data.probabilities (top-level)
// server now also sends data.prediction for nested access
export async function analyzeFrameWithML(
  canvas: HTMLCanvasElement,
  meetingId?: string,
  participantId?: string
): Promise<{ mlResult: DeepfakeStatus['mlResult']; frameMetrics: DeepfakeStatus['frameMetrics'] } | undefined> {
  try {
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.8);
    const { data } = await api.post('/deepfake/analyze', { imageBase64, meetingId, participantId });

    if (!data.faceDetected) return undefined;

    // Use top-level fields (server guarantees these are always present)
    return {
      mlResult: data.label
        ? {
            label: data.label,
            score: data.score ?? 0,
            probabilities: data.probabilities ?? { real: 0.5, fake: 0.5 },
            features: data.mlModel?.features ?? undefined,
            frameCount: data.mlModel?.frameCount ?? 0,
          }
        : undefined,
      frameMetrics: data.frameMetrics ?? undefined,
    };
  } catch (err) {
    console.warn('ML Analysis error', err);
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
  if ((window as any).__deepfake_lastSentLogAt && now - (window as any).__deepfake_lastSentLogAt < 5000) return;
  (window as any).__deepfake_lastSentLogAt = now;

  const snapshotJpegDataUrl = status.isLikelyFake && evidenceCanvas ? maybeCaptureEvidenceSnapshot(evidenceCanvas) : undefined;

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
      mlLabel: status.mlResult?.label,
      mlConfidence: status.mlResult?.score,
      mlProbabilities: status.mlResult?.probabilities,
      mlFeatures: status.mlResult?.features,
      frameMetrics: status.frameMetrics,
    });
  } catch (err) {
    console.warn('Deepfake log error', err);
  }
}

function maybeCaptureEvidenceSnapshot(canvas: HTMLCanvasElement): string | undefined {
  const targetW = 320;
  const scale = canvas.width ? targetW / canvas.width : 1;
  if (!Number.isFinite(scale) || scale <= 0) return undefined;
  const targetH = Math.max(1, Math.round(canvas.height * scale));
  const tmp = document.createElement('canvas');
  tmp.width = targetW;
  tmp.height = targetH;
  const ctx = tmp.getContext('2d');
  if (!ctx) return undefined;
  ctx.drawImage(canvas, 0, 0, tmp.width, tmp.height);
  try { return tmp.toDataURL('image/jpeg', 0.6); } catch { return undefined; }
}

export default DeepfakeMonitor;
