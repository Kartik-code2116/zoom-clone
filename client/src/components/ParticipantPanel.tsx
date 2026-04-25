import React, { useState, useEffect, useRef } from 'react';
import { useRemoteParticipants, useLocalParticipant } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Users, Mic, MicOff, Video, VideoOff, X, Pin, Ghost } from 'lucide-react';

interface ParticipantPanelProps {
  isOpen: boolean;
  onClose: () => void;
  width?: number;
  onWidthChange?: (width: number) => void;
}

const ParticipantPanel: React.FC<ParticipantPanelProps> = ({
  isOpen, onClose, width = 320, onWidthChange,
}) => {
  const remoteParticipants = useRemoteParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const panelRef = useRef<HTMLDivElement>(null);

  const [position, setPosition]               = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging]           = useState(false);
  const [dragStart, setDragStart]             = useState({ x: 0, y: 0 });
  const [isDefaultPosition, setIsDefaultPosition] = useState(true);
  const [panelWidth, setPanelWidth]           = useState(width);
  const [panelHeight, setPanelHeight]         = useState(500);
  const [isResizingWidth, setIsResizingWidth] = useState(false);
  const [isResizingHeight, setIsResizingHeight] = useState(false);

  const MIN_WIDTH = 280; const MAX_WIDTH  = 600;
  const MIN_HEIGHT= 300; const MAX_HEIGHT = 800;

  useEffect(() => { setPanelWidth(width); }, [width]);

  const totalCount = remoteParticipants.length + 1;

  const isMicOn  = (p: any) => { const pub = p.getTrackPublication(Track.Source.Microphone); return !!pub && !pub.isMuted; };
  const isCamOn  = (p: any) => { const pub = p.getTrackPublication(Track.Source.Camera);    return !!pub && !pub.isMuted; };
  const isHost   = (p: any) => { try { return !!JSON.parse(p.metadata || '{}').isHost; } catch { return false; } };

  const handleDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (isResizingWidth && panelRef.current) {
        const w = isDefaultPosition
          ? window.innerWidth - e.clientX
          : panelRef.current.getBoundingClientRect().right - e.clientX;
        const cw = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w));
        setPanelWidth(cw); onWidthChange?.(cw);
      }
      if (isResizingHeight && panelRef.current) {
        setPanelHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT,
          e.clientY - panelRef.current.getBoundingClientRect().top)));
      }
      if (!isDragging) return;
      const maxX = window.innerWidth  - (panelRef.current?.offsetWidth  || 320);
      const maxY = window.innerHeight - (panelRef.current?.offsetHeight || 400);
      setPosition({ x: Math.max(0, Math.min(e.clientX - dragStart.x, maxX)), y: Math.max(0, Math.min(e.clientY - dragStart.y, maxY)) });
      setIsDefaultPosition(false);
    };
    const onUp = () => {
      setIsDragging(false); setIsResizingWidth(false); setIsResizingHeight(false);
      document.body.style.cursor = ''; document.body.style.userSelect = '';
    };
    if (isDragging || isResizingWidth || isResizingHeight) {
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor    = isResizingWidth ? 'ew-resize' : isResizingHeight ? 'ns-resize' : 'grabbing';
      document.body.style.userSelect = 'none';
    }
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [isDragging, isResizingWidth, isResizingHeight, dragStart, isDefaultPosition, onWidthChange]);

  if (!isOpen) return null;

  const isLocalHost = isHost(localParticipant);

  return (
    <div ref={panelRef}
      className={`bg-surface-2 border border-white/10 z-50 flex flex-col shadow-2xl rounded-2xl overflow-hidden
                  ${isDefaultPosition ? 'fixed top-0 right-0 h-full border-l border-r-0 border-t-0 border-b-0' : 'fixed'}`}
      style={isDefaultPosition
        ? { width: panelWidth }
        : { left: position.x, top: position.y, right: 'auto', bottom: 'auto', width: panelWidth, height: panelHeight }}>

      {/* Resize — left edge */}
      <div onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setIsResizingWidth(true); }}
        className={`absolute left-0 top-0 bottom-0 w-4 cursor-ew-resize z-20 flex items-center justify-center group
                    ${isResizingWidth ? 'bg-primary/20' : 'hover:bg-primary/10'}`}>
        <div className={`w-1 h-8 rounded-full transition-colors ${isResizingWidth ? 'bg-primary' : 'bg-slate-600 group-hover:bg-primary'}`} />
      </div>

      {/* Resize — bottom edge (floating only) */}
      {!isDefaultPosition && (
        <div onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setIsResizingHeight(true); }}
          className={`absolute left-0 right-0 bottom-0 h-4 cursor-ns-resize z-20 flex items-center justify-center group
                      ${isResizingHeight ? 'bg-primary/20' : 'hover:bg-primary/10'}`}>
          <div className={`w-8 h-1 rounded-full transition-colors ${isResizingHeight ? 'bg-primary' : 'bg-slate-600 group-hover:bg-primary'}`} />
        </div>
      )}

      {/* Drag handle (floating only) */}
      {!isDefaultPosition && (
        <div onMouseDown={handleDragStart}
          className="w-full h-4 cursor-grab active:cursor-grabbing flex items-center justify-center
                     bg-surface-2 border-b border-white/8">
          <div className="w-8 h-1 bg-slate-600 rounded-full" />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 bg-surface-2">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          Participants
          <span className="text-white/40 font-normal">({totalCount})</span>
        </h3>
        <div className="flex items-center gap-1">
          {!isDefaultPosition && (
            <button onClick={() => { setPosition({ x: 0, y: 0 }); setIsDefaultPosition(true); }}
              className="text-white/50 hover:text-white hover:bg-white/8 w-8 h-8 rounded-lg
                         flex items-center justify-center transition-all" title="Pin to side">
              <Pin className="w-4 h-4" />
            </button>
          )}
          <button onClick={onClose}
            className="text-white/50 hover:text-white hover:bg-white/8 w-8 h-8 rounded-lg
                       flex items-center justify-center transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">

        {/* Local (You) */}
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-primary/5 border border-primary/10">
          <div className="w-9 h-9 rounded-full bg-primary/20 border border-primary/30
                          flex items-center justify-center flex-shrink-0">
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
              <span className="inline-block text-[10px] bg-primary/15 text-primary
                               px-1.5 py-0.5 rounded-md font-medium mt-0.5">Host</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isMicrophoneEnabled
              ? <Mic className="w-4 h-4 text-white/40" />
              : <MicOff className="w-4 h-4 text-red-400" />}
            {isCameraEnabled
              ? <Video className="w-4 h-4 text-white/40" />
              : <VideoOff className="w-4 h-4 text-red-400" />}
          </div>
        </div>

        {/* Remote participants */}
        {remoteParticipants.map((participant) => {
          const micOn = isMicOn(participant);
          const camOn = isCamOn(participant);
          const host  = isHost(participant);
          return (
            <div key={participant.sid}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors">
              <div className="w-9 h-9 rounded-full bg-white/10 border border-white/10
                              flex items-center justify-center flex-shrink-0">
                <span className="text-white/70 text-xs font-bold uppercase">
                  {participant.name?.charAt(0) || participant.identity?.charAt(0) || '?'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white/90 text-sm font-medium truncate">
                  {participant.name || participant.identity || 'Participant'}
                </p>
                {host && (
                  <span className="inline-block text-[10px] bg-primary/15 text-primary
                                   px-1.5 py-0.5 rounded-md font-medium mt-0.5">Host</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {micOn ? <Mic className="w-4 h-4 text-white/40" /> : <MicOff className="w-4 h-4 text-red-400" />}
                {camOn ? <Video className="w-4 h-4 text-white/40" /> : <VideoOff className="w-4 h-4 text-red-400" />}
              </div>
            </div>
          );
        })}

        {remoteParticipants.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-white/30 text-center">
            <Ghost className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm font-medium">No other participants yet</p>
            <p className="text-xs mt-1">Share the meeting link to invite others</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ParticipantPanel;
