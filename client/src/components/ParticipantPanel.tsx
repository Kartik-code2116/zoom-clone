import React, { useState, useEffect, useRef } from 'react';
import {
  useRemoteParticipants,
  useLocalParticipant,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import type { RemoteParticipant } from 'livekit-client';

interface ParticipantPanelProps {
  isOpen: boolean;
  onClose: () => void;
  width?: number;
  onWidthChange?: (width: number) => void;
}

const ParticipantPanel: React.FC<ParticipantPanelProps> = ({ 
  isOpen, 
  onClose,
  width = 320,
  onWidthChange
}) => {
  const remoteParticipants = useRemoteParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const panelRef = useRef<HTMLDivElement>(null);
  
  // Draggable state
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isDefaultPosition, setIsDefaultPosition] = useState(true);

  // Resizable state
  const [panelWidth, setPanelWidth] = useState(width);
  const [panelHeight, setPanelHeight] = useState(500);
  const [isResizingWidth, setIsResizingWidth] = useState(false);
  const [isResizingHeight, setIsResizingHeight] = useState(false);
  const MIN_WIDTH = 280;
  const MAX_WIDTH = 600;
  const MIN_HEIGHT = 300;
  const MAX_HEIGHT = 800;

  // Sync with parent width
  useEffect(() => {
    setPanelWidth(width);
  }, [width]);

  const totalCount = remoteParticipants.length + 1;

  const isParticipantMicEnabled = (participant: any): boolean => {
    const micPub = participant.getTrackPublication(Track.Source.Microphone);
    return !!micPub && !micPub.isMuted;
  };

  const isParticipantCameraEnabled = (participant: any): boolean => {
    const camPub = participant.getTrackPublication(Track.Source.Camera);
    return !!camPub && !camPub.isMuted;
  };

  const isParticipantHost = (participant: any): boolean => {
    try {
      if (!participant.metadata) return false;
      const meta = JSON.parse(participant.metadata);
      return !!meta.isHost;
    } catch {
      return false;
    }
  };

  // Handle drag start
  const handleDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  };

  // Handle resize start (width - from left edge)
  const handleResizeWidthStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizingWidth(true);
  };

  // Handle resize start (height - from bottom edge)
  const handleResizeHeightStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizingHeight(true);
  };

  // Handle resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingWidth && panelRef.current) {
        const newWidth = isDefaultPosition 
          ? window.innerWidth - e.clientX 
          : (panelRef.current.getBoundingClientRect().right - e.clientX);
        const clampedWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
        setPanelWidth(clampedWidth);
        onWidthChange?.(clampedWidth);
      }
      if (isResizingHeight && panelRef.current) {
        const newHeight = e.clientY - panelRef.current.getBoundingClientRect().top;
        const clampedHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, newHeight));
        setPanelHeight(clampedHeight);
      }
      if (!isDragging) return;
      
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      
      const maxX = window.innerWidth - (panelRef.current?.offsetWidth || 320);
      const maxY = window.innerHeight - (panelRef.current?.offsetHeight || 400);
      
      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY))
      });
      setIsDefaultPosition(false);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizingWidth(false);
      setIsResizingHeight(false);
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

  const isLocalHost = isParticipantHost(localParticipant);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className={`bg-darker border border-white/10 z-50 flex flex-col shadow-2xl rounded-2xl overflow-hidden ${
        isDefaultPosition 
          ? 'fixed top-0 right-0 h-full w-80 sm:w-96 border-l border-r-0 border-t-0 border-b-0' 
          : 'fixed'
      } ${isDragging ? 'shadow-primary/20' : ''}`}
      style={isDefaultPosition ? { width: panelWidth } : {
        left: position.x,
        top: position.y,
        right: 'auto',
        bottom: 'auto',
        width: panelWidth,
        height: panelHeight
      }}
    >
      {/* Resize Handle - Left Edge (Width) */}
      <div
        onMouseDown={handleResizeWidthStart}
        className={`absolute left-0 top-0 bottom-0 w-4 cursor-ew-resize z-20 flex items-center justify-center group ${
          isResizingWidth ? 'bg-primary/20' : 'hover:bg-primary/10'
        }`}
        title="Drag to resize width"
      >
        <div className={`w-1 h-8 rounded-full transition-colors ${
          isResizingWidth ? 'bg-primary' : 'bg-slate-600 group-hover:bg-primary'
        }`} />
      </div>

      {/* Resize Handle - Bottom Edge (Height) - only when floating */}
      {!isDefaultPosition && (
        <div
          onMouseDown={handleResizeHeightStart}
          className={`absolute left-0 right-0 bottom-0 h-4 cursor-ns-resize z-20 flex items-center justify-center group ${
            isResizingHeight ? 'bg-primary/20' : 'hover:bg-primary/10'
          }`}
          title="Drag to resize height"
        >
          <div className={`w-8 h-1 rounded-full transition-colors ${
            isResizingHeight ? 'bg-primary' : 'bg-slate-600 group-hover:bg-primary'
          }`} />
        </div>
      )}
      
      {/* Drag Handle - only visible when moved */}
      {!isDefaultPosition && (
        <div
          onMouseDown={handleDragStart}
          className="w-full h-4 cursor-grab active:cursor-grabbing flex items-center justify-center bg-dark border-b border-white/10"
          title="Drag to move"
        >
          <div className="w-8 h-1 bg-slate-600 rounded-full" />
        </div>
      )}
      
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-dark">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
          👥{' '}
          <span>
            Participants{' '}
            <span className="text-white/40 font-normal">({totalCount})</span>
          </span>
        </h3>
        <div className="flex items-center gap-1">
          {/* Pin/Unpin button */}
          {!isDefaultPosition && (
            <button
              onClick={() => {
                setPosition({ x: 0, y: 0 });
                setIsDefaultPosition(true);
              }}
              className="text-white/50 hover:text-white hover:bg-white/10 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200"
              title="Pin to side"
            >
              📌
            </button>
          )}
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white hover:bg-white/10 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Participant List */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {/* Local participant (You) */}
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-primary/5 border border-primary/10">
          <div className="w-9 h-9 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
            <span className="text-primary text-xs font-bold uppercase">
              {localParticipant.name?.charAt(0) || localParticipant.identity?.charAt(0) || 'Y'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">
              {localParticipant.name || localParticipant.identity || 'You'}
              <span className="text-primary/60 text-xs ml-1.5">(You)</span>
            </p>
            {isLocalHost && (
              <span className="inline-block text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-md font-medium mt-0.5">
                Host
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={`text-sm ${isMicrophoneEnabled ? 'opacity-60' : 'text-red-400'}`}
              title={isMicrophoneEnabled ? 'Mic on' : 'Mic off'}
            >
              {isMicrophoneEnabled ? '🎤' : '🔇'}
            </span>
            <span
              className={`text-sm ${isCameraEnabled ? 'opacity-60' : 'text-red-400'}`}
              title={isCameraEnabled ? 'Camera on' : 'Camera off'}
            >
              {isCameraEnabled ? '📹' : '📷'}
            </span>
          </div>
        </div>

        {/* Remote participants */}
        {remoteParticipants.map((participant) => {
          const micOn = isParticipantMicEnabled(participant);
          const camOn = isParticipantCameraEnabled(participant);
          const isHost = isParticipantHost(participant);

          return (
            <div
              key={participant.sid}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors duration-150"
            >
              <div className="w-9 h-9 rounded-full bg-white/10 border border-white/10 flex items-center justify-center shrink-0">
                <span className="text-white/70 text-xs font-bold uppercase">
                  {participant.name?.charAt(0) || participant.identity?.charAt(0) || '?'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white/90 text-sm font-medium truncate">
                  {participant.name || participant.identity || 'Participant'}
                </p>
                {isHost && (
                  <span className="inline-block text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-md font-medium mt-0.5">
                    Host
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className={`text-sm ${micOn ? 'opacity-60' : 'text-red-400'}`}
                  title={micOn ? 'Mic on' : 'Mic off'}
                >
                  {micOn ? '🎤' : '🔇'}
                </span>
                <span
                  className={`text-sm ${camOn ? 'opacity-60' : 'text-red-400'}`}
                  title={camOn ? 'Camera on' : 'Camera off'}
                >
                  {camOn ? '📹' : '📷'}
                </span>
              </div>
            </div>
          );
        })}

        {remoteParticipants.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-white/30">
            <span className="text-3xl mb-2">🫥</span>
            <p className="text-sm">No other participants yet</p>
            <p className="text-xs mt-1">Share the meeting link to invite others</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ParticipantPanel;
