import React, { useEffect, useRef, useState, useCallback } from 'react';
import api from '../services/api';
import { FaceMesh, Results } from '@mediapipe/face_mesh';
import { useRemoteParticipants, useLocalParticipant } from '@livekit/components-react';
import { Activity, Shield, Eye, Timer, Zap, Users, AlertTriangle } from 'lucide-react';

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
  // Custom ML Model results
  mlResult?: {
    label: string;
    score: number;
    probabilities: {
      real: number;
      fake: number;
    };
    features?: {
      total_blinks: number;
      blink_rate: number;
      avg_ear: number;
      ear_variance: number;
      yaw_variance: number;
      pitch_variance: number;
    };
    frameCount: number;
  };
  frameMetrics?: {
    ear: number;
    blink_detected: boolean;
    yaw?: number;
    pitch?: number;
  };
  // Deprecated: keep for backward compatibility
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const faceMeshRef = useRef<FaceMesh | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Add remote participant tracking
  const remoteParticipants = useRemoteParticipants();
  const { localParticipant } = useLocalParticipant();
  const totalParticipants = remoteParticipants.length + 1;
  
  // Real-time metrics history for sparkline charts
  const [trustHistory, setTrustHistory] = useState<number[]>([100]);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date>(new Date());
  const [fps, setFps] = useState(0);
  const [position, setPosition] = useState({ x: window.innerWidth - 280, y: 16 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Resizable state
  const [panelWidth, setPanelWidth] = useState(256);
  const [panelHeight, setPanelHeight] = useState(420);
  const [isResizingWidth, setIsResizingWidth] = useState(false);
  const [isResizingHeight, setIsResizingHeight] = useState(false);
  const MIN_WIDTH = 200;
  const MAX_WIDTH = 400;
  const MIN_HEIGHT = 300;
  const MAX_HEIGHT = 600;

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
    mlResult: undefined,
    frameMetrics: undefined,
  });

  // Track ML data separately
  const mlDataRef = useRef<DeepfakeStatus['mlResult']>(undefined);
  const frameMetricsRef = useRef<DeepfakeStatus['frameMetrics']>(undefined);
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

  const findLocalVideoElement = useCallback(() => {
    // Try multiple selectors to find the local video
    const selectors = [
      '[data-lk-local-participant="true"] video',
      '.lk-local-participant video',
      '[data-source-id="camera"] video',
      'video[data-lk-video-source="true"]',
      '.lk-participant-tile video'
    ];
    
    for (const selector of selectors) {
      const videos = document.querySelectorAll(selector);
      for (const video of videos) {
        if (video instanceof HTMLVideoElement && video.videoWidth > 0) {
          return video;
        }
      }
    }
    
    // Fallback: find any visible video with a stream
    const allVideos = document.querySelectorAll('video');
    for (const video of allVideos) {
      if (video.videoWidth > 0 && video.readyState >= 2) {
        return video;
      }
    }
    
    return null;
  }, []);

  useEffect(() => {
    // Initialize FaceMesh
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

    // Start frame capture loop
    let frameCount = 0;
    const processFrame = async () => {
      const video = findLocalVideoElement();
      
      if (video && faceMeshRef.current && canvasRef.current) {
        // Draw video to canvas
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          canvasRef.current.width = video.videoWidth || 640;
          canvasRef.current.height = video.videoHeight || 360;
          ctx.drawImage(video, 0, 0, canvasRef.current.width, canvasRef.current.height);
          
          // Process with FaceMesh every 3rd frame (10fps at 30fps video)
          frameCount++;
          if (frameCount % 3 === 0) {
            await faceMeshRef.current.send({ image: canvasRef.current });
          }
        }
      }
      
      animationFrameRef.current = requestAnimationFrame(processFrame);
    };
    
    // Wait a bit for LiveKit to initialize video
    const timeout = setTimeout(() => {
      processFrame();
    }, 2000);

    return () => {
      clearTimeout(timeout);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (faceMeshRef.current) {
        faceMeshRef.current.close();
      }
    };
  }, [findLocalVideoElement, meetingId, participantId]);

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

    // --- CUSTOM ML MODEL INTEGRATION ---
    // Every 5 seconds, if we have a frame, send it to the backend for ML analysis
    if (now - lastAnalyzedAtRef.current > 5000 && canvasRef.current) {
        lastAnalyzedAtRef.current = now;
        analyzeFrameWithML(canvasRef.current, meetingId, participantId).then(res => {
            if (res) {
                mlDataRef.current = res.mlResult;
                frameMetricsRef.current = res.frameMetrics;
            }
        });
    }

    // Use ML model trust score directly (0-100)
    let trustScore = behavioralTrustScore;
    if (mlDataRef.current) {
        // Use the ML model's real probability as trust score
        const mlTrust = mlDataRef.current.probabilities.real * 100;
        // Fuse: 30% behavioral, 70% ML model (ML is more reliable)
        trustScore = (behavioralTrustScore * 0.3) + (mlTrust * 0.7);
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
      mlResult: mlDataRef.current,
      frameMetrics: frameMetricsRef.current,
    };

    setStatus((prev) => {
      // Only fire expensive updates if something significant changed
      if (Math.abs(prev.trustScore - nextStatus.trustScore) > 2 || nextStatus.isLikelyFake !== prev.isLikelyFake) {
        if (onStatusChange) onStatusChange(nextStatus);
      }
      return nextStatus;
    });

    maybeLogStatus(meetingId, participantId, nextStatus, nextStatus.isLikelyFake ? canvasRef.current : undefined);
  };

  // Update FPS counter and trust history every second
  useEffect(() => {
    const interval = setInterval(() => {
      setLastUpdateTime(new Date());
      setTrustHistory(prev => {
        const newHistory = [...prev, status.trustScore].slice(-20); // Keep last 20 values
        return newHistory;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [status.trustScore]);
  const handleDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('.resize-handle')) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  };

  // Handle resize start (width)
  const handleResizeWidthStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizingWidth(true);
  };

  // Handle resize start (height)
  const handleResizeHeightStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizingHeight(true);
  };

  // Store initial values for resize calculations
  const resizeStartRef = useRef({ rightEdge: 0, bottomEdge: 0 });

  // Handle resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingWidth && panelRef.current) {
        // Store right edge on first move
        if (resizeStartRef.current.rightEdge === 0) {
          resizeStartRef.current.rightEdge = panelRef.current.getBoundingClientRect().right;
        }
        const newWidth = resizeStartRef.current.rightEdge - e.clientX;
        const clampedWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
        // Calculate new left position to keep right edge fixed
        const newLeft = resizeStartRef.current.rightEdge - clampedWidth;
        setPanelWidth(clampedWidth);
        setPosition(prev => ({ ...prev, x: newLeft }));
      }
      if (isResizingHeight && panelRef.current) {
        // Store bottom edge on first move
        if (resizeStartRef.current.bottomEdge === 0) {
          resizeStartRef.current.bottomEdge = panelRef.current.getBoundingClientRect().bottom;
        }
        const newHeight = e.clientY - panelRef.current.getBoundingClientRect().top;
        const clampedHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, newHeight));
        setPanelHeight(clampedHeight);
      }
      if (!isDragging) return;
      
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      
      const maxX = window.innerWidth - (panelRef.current?.offsetWidth || 256);
      const maxY = window.innerHeight - (panelRef.current?.offsetHeight || 420);
      
      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY))
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizingWidth(false);
      setIsResizingHeight(false);
      // Reset resize refs
      resizeStartRef.current = { rightEdge: 0, bottomEdge: 0 };
    };

    if (isDragging || isResizingWidth || isResizingHeight) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      if (isResizingWidth) document.body.style.cursor = 'ew-resize';
      else if (isResizingHeight) document.body.style.cursor = 'ns-resize';
      else document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, isResizingWidth, isResizingHeight, dragStart]);

  const riskColor =
    status.trustScore > 75 ? 'emerald' : status.trustScore > 50 ? 'yellow' : 'red';
  
  const riskBgClass = {
    emerald: 'bg-emerald-500',
    yellow: 'bg-yellow-400',
    red: 'bg-red-500'
  }[riskColor];
  
  const riskTextClass = {
    emerald: 'text-emerald-400',
    yellow: 'text-yellow-400',
    red: 'text-red-400'
  }[riskColor];
  
  const riskBorderClass = {
    emerald: 'border-emerald-500/30',
    yellow: 'border-yellow-500/30',
    red: 'border-red-500/30'
  }[riskColor];

  return (
    <div 
      ref={panelRef}
      className={`fixed z-40 rounded-lg bg-slate-900/80 text-white shadow-lg border border-slate-700 backdrop-blur-sm ${
        isDragging ? 'shadow-primary/20' : ''
      }`}
      style={{
        left: position.x,
        top: position.y,
        width: panelWidth,
        height: panelHeight
      }}
    >
      {/* Drag Handle Header */}
      <div 
        onMouseDown={handleDragStart}
        className="px-4 py-3 border-b border-slate-700 flex items-center justify-between cursor-grab active:cursor-grabbing"
      >
        <div className="text-sm font-semibold">DeepFake Guard</div>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            status.isLikelyFake ? 'bg-red-600/80 text-white' : 'bg-emerald-600/80 text-white'
          }`}
        >
          {status.isLikelyFake ? 'RISK' : 'STABLE'}
        </span>
      </div>

      {/* Resize Handle - Left Edge (Width) */}
      <div
        onMouseDown={handleResizeWidthStart}
        className={`resize-handle absolute left-0 top-14 bottom-0 w-3 cursor-ew-resize z-20 flex items-center justify-center group ${
          isResizingWidth ? 'bg-primary/20' : 'hover:bg-primary/10'
        }`}
        title="Drag to resize width"
      >
        <div className={`w-0.5 h-6 rounded-full transition-colors ${
          isResizingWidth ? 'bg-primary' : 'bg-slate-600 group-hover:bg-primary'
        }`} />
      </div>

      {/* Resize Handle - Bottom Edge (Height) */}
      <div
        onMouseDown={handleResizeHeightStart}
        className={`resize-handle absolute left-0 right-0 bottom-0 h-3 cursor-ns-resize z-20 flex items-center justify-center group ${
          isResizingHeight ? 'bg-primary/20' : 'hover:bg-primary/10'
        }`}
        title="Drag to resize height"
      >
        <div className={`w-6 h-0.5 rounded-full transition-colors ${
          isResizingHeight ? 'bg-primary' : 'bg-slate-600 group-hover:bg-primary'
        }`} />
      </div>

      {/* Scrollable Content */}
      <div className="px-4 py-3 space-y-3 overflow-y-auto" style={{ height: 'calc(100% - 60px)' }}>
        
        {/* Live Status Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className={`w-4 h-4 ${riskTextClass} animate-pulse`} />
            <span className="text-xs text-slate-400">Live Analysis</span>
          </div>
          <span className="text-[10px] text-slate-500">{lastUpdateTime.toLocaleTimeString()}</span>
        </div>

        {/* Participant Count */}
        <div className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-3 py-2">
          <Users className="w-4 h-4 text-slate-400" />
          <span className="text-xs text-slate-300">Participants:</span>
          <span className="text-sm font-semibold text-white">{totalParticipants}</span>
          <span className="text-[10px] text-slate-500">(You + {remoteParticipants.length} remote)</span>
        </div>

        {/* Trust Score with Sparkline */}
        <div className={`p-3 rounded-lg border ${riskBorderClass} bg-slate-800/30`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Shield className={`w-4 h-4 ${riskTextClass}`} />
              <span className="text-xs text-slate-300">Trust Score</span>
            </div>
            <span className={`text-lg font-bold ${riskTextClass}`}>{Math.round(status.trustScore)}%</span>
          </div>
          
          {/* Sparkline chart */}
          <div className="flex items-end gap-0.5 h-8 mb-2">
            {trustHistory.map((val, i) => (
              <div
                key={i}
                className={`flex-1 ${riskBgClass} rounded-t-sm transition-all duration-300`}
                style={{ height: `${val}%`, opacity: 0.3 + (i / trustHistory.length) * 0.7 }}
              />
            ))}
          </div>
          
          <div className="h-2 w-full rounded-full bg-slate-700 overflow-hidden">
            <div
              className={`h-full ${riskBgClass} transition-all duration-500`}
              style={{ width: `${Math.max(0, Math.min(100, status.trustScore))}%` }}
            />
          </div>
        </div>

        {/* AI Model Status */}
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
              <span className="text-xs text-slate-400">
                {(status.mlResult.score * 100).toFixed(0)}% confidence
              </span>
            </div>
            <div className="flex gap-2 mt-2 text-[10px]">
              <span className="text-emerald-400">
                Real: {(status.mlResult.probabilities.real * 100).toFixed(0)}%
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-red-400">
                Fake: {(status.mlResult.probabilities.fake * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-slate-500">
            <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-xs">Initializing AI model...</span>
          </div>
        )}

        {/* Real-time Metrics Grid */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-slate-800/50 rounded-lg p-2">
            <div className="flex items-center gap-1.5 mb-1">
              <Eye className="w-3 h-3 text-slate-400" />
              <span className="text-[10px] text-slate-400">Gaze</span>
            </div>
            <div className="text-sm font-medium text-white capitalize">{status.gazeDirection}</div>
          </div>
          
          <div className="bg-slate-800/50 rounded-lg p-2">
            <div className="flex items-center gap-1.5 mb-1">
              <Timer className="w-3 h-3 text-slate-400" />
              <span className="text-[10px] text-slate-400">Blink Rate</span>
            </div>
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

        {/* Micro Movements Indicator */}
        <div className="bg-slate-800/50 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-300">Micro Movements</span>
            <span className={`text-xs font-medium ${status.behavioralSignals.microMovementsScore > 0.7 ? 'text-emerald-400' : status.behavioralSignals.microMovementsScore > 0.3 ? 'text-yellow-400' : 'text-red-400'}`}>
              {(status.behavioralSignals.microMovementsScore * 100).toFixed(0)}%
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-700 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${status.behavioralSignals.microMovementsScore > 0.7 ? 'bg-emerald-500' : status.behavioralSignals.microMovementsScore > 0.3 ? 'bg-yellow-400' : 'bg-red-500'}`}
              style={{ width: `${status.behavioralSignals.microMovementsScore * 100}%` }}
            />
          </div>
        </div>

        {/* Alert for fake detection */}
        {status.isLikelyFake && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-medium text-red-400">DeepFake Detected</div>
              <div className="text-[10px] text-red-300/80 mt-0.5">
                Suspicious patterns detected in video feed
              </div>
            </div>
          </div>
        )}

        {/* ML Features Detail */}
        {status.mlResult?.features && (
          <div className="border-t border-slate-700/50 pt-2">
            <div className="text-[10px] text-slate-400 font-mono uppercase mb-2">ML Features</div>
            <div className="grid grid-cols-2 gap-1 text-[10px]">
              <div className="flex justify-between">
                <span className="text-slate-500">Blinks:</span>
                <span className="text-slate-300">{status.mlResult.features.total_blinks}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Rate:</span>
                <span className="text-slate-300">{status.mlResult.features.blink_rate.toFixed(1)}/min</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">EAR Var:</span>
                <span className="text-slate-300">{status.mlResult.features.ear_variance.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Yaw Var:</span>
                <span className="text-slate-300">{status.mlResult.features.yaw_variance.toFixed(2)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Hidden canvas used for analysis */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export async function analyzeFrameWithML(
    canvas: HTMLCanvasElement,
    meetingId?: string,
    participantId?: string
): Promise<{ mlResult: DeepfakeStatus['mlResult']; frameMetrics: DeepfakeStatus['frameMetrics'] } | undefined> {
    try {
        const imageBase64 = canvas.toDataURL('image/jpeg', 0.8);
        const { data } = await api.post('/deepfake/analyze', {
            imageBase64,
            meetingId,
            participantId
        });

        if (!data.faceDetected) {
            return undefined;
        }

        return {
            mlResult: data.prediction ? {
                label: data.prediction.label,
                score: data.prediction.confidence,
                probabilities: data.prediction.probabilities,
                features: data.mlModel?.features,
                frameCount: data.mlModel?.frameCount || 0
            } : undefined,
            frameMetrics: data.frameMetrics
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
      // Custom ML Model fields
      mlLabel: status.mlResult?.label,
      mlConfidence: status.mlResult?.score,
      mlProbabilities: status.mlResult?.probabilities,
      mlFeatures: status.mlResult?.features,
      frameMetrics: status.frameMetrics,
      // Deprecated HF fields (keep for backward compatibility)
      hfLabel: undefined,
      hfScore: undefined,
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

