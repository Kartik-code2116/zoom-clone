import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useRemoteParticipants, useRoomContext } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { analyzeFrameWithML, DeepfakeStatus } from './DeepfakeMonitor';
import { UserX, Shield, ShieldAlert, Eye, Activity, Brain } from 'lucide-react';

interface ParticipantDeepfakeState {
  identity: string;
  name: string;
  trustScore: number;
  isLikelyFake: boolean;
  mlResult?: DeepfakeStatus['mlResult'];
  lastUpdated: number;
  status: 'checking' | 'real' | 'suspicious' | 'fake' | 'no-video';
}

interface RemoteParticipantsDeepfakeMonitorProps {
  meetingId?: string;
  onParticipantStatusChange?: (status: ParticipantDeepfakeState[]) => void;
}

const RemoteParticipantsDeepfakeMonitor: React.FC<RemoteParticipantsDeepfakeMonitorProps> = ({
  meetingId,
  onParticipantStatusChange,
}) => {
  const remoteParticipants = useRemoteParticipants();
  const room = useRoomContext();
  const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [participantStates, setParticipantStates] = useState<ParticipantDeepfakeState[]>([]);
  const statesRef = useRef<ParticipantDeepfakeState[]>([]);

  // Get video element for a specific participant
  const findParticipantVideoElement = useCallback((identity: string): HTMLVideoElement | null => {
    // Look for video elements associated with this participant identity
    const selectors = [
      `[data-lk-participant-id="${identity}"] video`,
      `[data-lk-participant-name="${identity}"] video`,
      `.lk-participant-tile[data-identity="${identity}"] video`,
      `[data-track-source-participant-id="${identity}"] video`,
    ];
    
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el instanceof HTMLVideoElement && el.videoWidth > 0 && el.readyState >= 2) {
        return el;
      }
    }

    // Fallback: search all video elements and check if they have the participant's track
    const allVideos = document.querySelectorAll('video');
    for (const video of allVideos) {
      // Check if this video element is displaying the participant
      const parent = video.closest('[data-lk-participant-id], [data-participant-identity]');
      if (parent) {
        const pid = parent.getAttribute('data-lk-participant-id') || 
                    parent.getAttribute('data-participant-identity');
        if (pid === identity && video.videoWidth > 0 && video.readyState >= 2) {
          return video;
        }
      }
    }
    
    return null;
  }, []);

  // Analyze a single participant's video
  const analyzeParticipant = useCallback(async (participant: any): Promise<ParticipantDeepfakeState | null> => {
    const identity = participant.identity;
    const name = participant.name || identity;
    
    const video = findParticipantVideoElement(identity);
    if (!video || !canvasRef.current) {
      return {
        identity,
        name,
        trustScore: 0,
        isLikelyFake: false,
        lastUpdated: Date.now(),
        status: 'no-video',
      };
    }

    // Draw video frame to canvas
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Analyze with ML service
    try {
      const result = await analyzeFrameWithML(canvas, meetingId, identity);
      
      if (!result) {
        return {
          identity,
          name,
          trustScore: 50,
          isLikelyFake: false,
          lastUpdated: Date.now(),
          status: 'checking',
        };
      }

      const mlTrust = result.mlResult ? result.mlResult.probabilities.real * 100 : 50;
      const trustScore = Math.round(mlTrust);
      const isLikelyFake = trustScore < 40;

      return {
        identity,
        name,
        trustScore,
        isLikelyFake,
        mlResult: result.mlResult,
        lastUpdated: Date.now(),
        status: isLikelyFake ? 'fake' : trustScore < 60 ? 'suspicious' : 'real',
      };
    } catch (error) {
      console.error(`[Deepfake] Analysis failed for ${identity}:`, error);
      return {
        identity,
        name,
        trustScore: 50,
        isLikelyFake: false,
        lastUpdated: Date.now(),
        status: 'checking',
      };
    }
  }, [findParticipantVideoElement, meetingId]);

  // Run analysis on all participants
  const runAnalysis = useCallback(async () => {
    if (remoteParticipants.length === 0) return;

    const newStates: ParticipantDeepfakeState[] = [];
    
    for (const participant of remoteParticipants) {
      const state = await analyzeParticipant(participant);
      if (state) {
        newStates.push(state);
      }
    }

    // Merge with existing states to preserve data for participants that weren't analyzed this round
    setParticipantStates(prev => {
      const merged = [...newStates];
      const analyzedIds = new Set(newStates.map(s => s.identity));
      
      // Keep old states for participants not currently visible but were previously analyzed
      for (const oldState of prev) {
        if (!analyzedIds.has(oldState.identity)) {
          // Only keep if less than 30 seconds old
          if (Date.now() - oldState.lastUpdated < 30000) {
            merged.push(oldState);
          }
        }
      }
      
      statesRef.current = merged;
      onParticipantStatusChange?.(merged);
      return merged;
    });
  }, [remoteParticipants, analyzeParticipant, onParticipantStatusChange]);

  // Setup periodic analysis
  useEffect(() => {
    // Create hidden canvas for analysis
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }

    // Initial analysis
    runAnalysis();

    // Set up interval for continuous analysis (every 5 seconds)
    analysisIntervalRef.current = setInterval(runAnalysis, 5000);

    return () => {
      if (analysisIntervalRef.current) {
        clearInterval(analysisIntervalRef.current);
      }
    };
  }, [runAnalysis]);

  // Helper to get status color
  const getStatusColor = (status: ParticipantDeepfakeState['status']) => {
    switch (status) {
      case 'real': return '#10b981';
      case 'suspicious': return '#f59e0b';
      case 'fake': return '#ef4444';
      case 'no-video': return '#64748b';
      default: return '#64748b';
    }
  };

  const getStatusLabel = (status: ParticipantDeepfakeState['status']) => {
    switch (status) {
      case 'real': return 'Verified';
      case 'suspicious': return 'Suspicious';
      case 'fake': return 'Deepfake Detected';
      case 'no-video': return 'No Video';
      case 'checking': return 'Analyzing...';
      default: return 'Unknown';
    }
  };

  const getStatusIcon = (status: ParticipantDeepfakeState['status']) => {
    switch (status) {
      case 'real': return Shield;
      case 'suspicious': return Eye;
      case 'fake': return ShieldAlert;
      case 'no-video': return UserX;
      default: return Activity;
    }
  };

  if (participantStates.length === 0) {
    return <canvas ref={canvasRef} className="hidden" />;
  }

  return (
    <>
      {/* Hidden canvas for analysis */}
      <canvas ref={canvasRef} className="hidden" />
      
      {/* Compact participant status overlay */}
      <div className="fixed top-20 left-4 z-30 flex flex-col gap-2 pointer-events-none">
        {participantStates.map((state) => {
          const Icon = getStatusIcon(state.status);
          const color = getStatusColor(state.status);
          
          return (
            <div
              key={state.identity}
              className="bg-slate-900/90 backdrop-blur-sm border border-white/10 rounded-lg px-3 py-2 shadow-lg pointer-events-auto"
              style={{ borderLeft: `3px solid ${color}` }}
            >
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4" style={{ color }} />
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-white truncate max-w-[120px]">
                    {state.name}
                  </span>
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    <span 
                      className="w-1.5 h-1.5 rounded-full animate-pulse"
                      style={{ backgroundColor: color }}
                    />
                    {getStatusLabel(state.status)}
                    {state.trustScore > 0 && (
                      <span className="text-slate-500">({state.trustScore}%)</span>
                    )}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Alert banner for detected deepfakes */}
      {participantStates.some(s => s.status === 'fake') && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-500/90 text-white px-6 py-3 rounded-xl shadow-2xl animate-pulse flex items-center gap-3">
          <ShieldAlert className="w-6 h-6" />
          <div>
            <p className="font-semibold text-sm">Deepfake Alert</p>
            <p className="text-xs opacity-90">
              {participantStates.filter(s => s.status === 'fake').length} participant(s) flagged as suspicious
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default RemoteParticipantsDeepfakeMonitor;
export type { ParticipantDeepfakeState };
