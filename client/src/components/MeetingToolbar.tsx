import React, { useEffect, useCallback, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { showSuccess } from '../utils/toast';

interface MeetingToolbarProps {
  onToggleChat: () => void;
  onToggleParticipants: () => void;
  chatOpen: boolean;
  participantsOpen: boolean;
  isChatUnread: boolean;
  onOpenSettings: () => void;
  onToggleReactions?: () => void;
  fraudDashboardOpen?: boolean;
  fraudDashboardWidth?: number;
  chatPanelWidth?: number;
  participantPanelWidth?: number;
}

const MeetingToolbar: React.FC<MeetingToolbarProps> = ({
  onToggleChat,
  onToggleParticipants,
  chatOpen,
  participantsOpen,
  isChatUnread,
  onOpenSettings,
  onToggleReactions,
  fraudDashboardOpen = false,
  fraudDashboardWidth = 384,
  chatPanelWidth = 320,
  participantPanelWidth = 320,
}) => {
  const navigate = useNavigate();
  const { meetingId } = useParams<{ meetingId: string }>();
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  
  // Draggable state
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isDefaultPosition, setIsDefaultPosition] = useState(true);

  // Calculate right margin based on open panels
  const getRightMargin = () => {
    let margin = 0;
    if (fraudDashboardOpen) margin += fraudDashboardWidth;
    if (chatOpen) margin += chatPanelWidth;
    if (participantsOpen) margin += participantPanelWidth;
    return margin;
  };

  const panelMargin = getRightMargin();
  const handleDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return; // Don't drag when clicking buttons
    e.preventDefault();
    setIsDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  };

  // Handle drag
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      
      // Constrain to viewport
      const maxX = window.innerWidth - (toolbarRef.current?.offsetWidth || 400);
      const maxY = window.innerHeight - (toolbarRef.current?.offsetHeight || 100);
      
      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY))
      });
      setIsDefaultPosition(false);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'grabbing';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
    };
  }, [isDragging, dragStart]);

  const toggleMic = useCallback(async () => {
    await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  }, [localParticipant, isMicrophoneEnabled]);

  const toggleCamera = useCallback(async () => {
    await localParticipant.setCameraEnabled(!isCameraEnabled);
  }, [localParticipant, isCameraEnabled]);

  const toggleScreenShare = useCallback(async () => {
    const isScreenSharing = localParticipant.isScreenShareEnabled;
    await localParticipant.setScreenShareEnabled(!isScreenSharing);
  }, [localParticipant]);

  const copyLink = useCallback(() => {
    const link = `${window.location.origin}/join/${meetingId}`;
    navigator.clipboard.writeText(link);
    showSuccess('Meeting link copied to clipboard!');
  }, [meetingId]);

  const handleLeave = useCallback(() => {
    room.disconnect();
    navigate(`/meeting/${meetingId}/summary`);
  }, [room, navigate, meetingId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'm':
          toggleMic();
          break;
        case 'v':
          toggleCamera();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleMic, toggleCamera]);

  return (
    <div 
      ref={toolbarRef}
      className={`z-50 bg-darker/95 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl transition-shadow duration-200 ${
        isDragging ? 'shadow-primary/20 cursor-grabbing' : 'hover:shadow-xl'
      } ${isDefaultPosition ? 'absolute bottom-0 left-0 right-0' : 'fixed'}`}
      style={isDefaultPosition ? { 
        right: panelMargin,
        transition: 'right 0.3s ease-out'
      } : {
        left: position.x,
        top: position.y,
        right: 'auto',
        bottom: 'auto'
      }}
    >
      {/* Drag Handle */}
      <div
        onMouseDown={handleDragStart}
        className={`w-full h-3 cursor-grab active:cursor-grabbing flex items-center justify-center ${
          isDefaultPosition ? 'hidden' : ''
        }`}
        title="Drag to move toolbar"
      >
        <div className="w-8 h-1 bg-slate-600 rounded-full" />
      </div>
      
      <div className="flex items-center justify-center gap-2 sm:gap-3 px-4 py-3">
        {/* Mic Toggle */}
        <button
          onClick={toggleMic}
          className={`relative group flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl transition-all duration-200 ${
            isMicrophoneEnabled
              ? 'bg-white/10 hover:bg-white/15 text-white'
              : 'bg-red-500/20 hover:bg-red-500/30 text-red-400'
          }`}
          title="Toggle Microphone (M)"
        >
          <span className="text-lg">{isMicrophoneEnabled ? '🎤' : '🔇'}</span>
          <span className="text-[10px] font-medium opacity-70">
            {isMicrophoneEnabled ? 'Mic' : 'Muted'}
          </span>
        </button>

        {/* Camera Toggle */}
        <button
          onClick={toggleCamera}
          className={`relative group flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl transition-all duration-200 ${
            isCameraEnabled
              ? 'bg-white/10 hover:bg-white/15 text-white'
              : 'bg-red-500/20 hover:bg-red-500/30 text-red-400'
          }`}
          title="Toggle Camera (V)"
        >
          <span className="text-lg">{isCameraEnabled ? '📹' : '📷'}</span>
          <span className="text-[10px] font-medium opacity-70">
            {isCameraEnabled ? 'Video' : 'No Video'}
          </span>
        </button>

        {/* Screen Share */}
        <button
          onClick={toggleScreenShare}
          className="relative group flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white transition-all duration-200"
          title="Share Screen"
        >
          <span className="text-lg">🖥️</span>
          <span className="text-[10px] font-medium opacity-70">Share</span>
        </button>

        <div className="w-px h-10 bg-white/10 mx-1" />

        {/* Chat */}
        <button
          onClick={onToggleChat}
          className={`relative group flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl transition-all duration-200 ${
            chatOpen
              ? 'bg-primary/20 text-primary'
              : 'bg-white/10 hover:bg-white/15 text-white'
          }`}
          title="Chat"
        >
          <span className="text-lg">💬</span>
          <span className="text-[10px] font-medium opacity-70">Chat</span>
          {isChatUnread && !chatOpen && (
            <span className="absolute top-1.5 right-3 w-2.5 h-2.5 bg-primary rounded-full animate-pulse ring-2 ring-darker" />
          )}
        </button>

        {/* Participants */}
        <button
          onClick={onToggleParticipants}
          className={`relative group flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl transition-all duration-200 ${
            participantsOpen
              ? 'bg-primary/20 text-primary'
              : 'bg-white/10 hover:bg-white/15 text-white'
          }`}
          title="Participants"
        >
          <span className="text-lg">👥</span>
          <span className="text-[10px] font-medium opacity-70">People</span>
        </button>

        {/* Reactions */}
        <button
          onClick={onToggleReactions}
          className="relative group flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white transition-all duration-200"
          title="Reactions"
        >
          <span className="text-lg">😊</span>
          <span className="text-[10px] font-medium opacity-70">Reactions</span>
        </button>

        {/* Copy Link */}
        <button
          onClick={copyLink}
          className="relative group flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white transition-all duration-200"
          title="Copy Invite Link"
        >
          <span className="text-lg">🔗</span>
          <span className="text-[10px] font-medium opacity-70">Invite</span>
        </button>

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          className="relative group flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white transition-all duration-200"
          title="Meeting settings"
        >
          <span className="text-lg">⚙️</span>
          <span className="text-[10px] font-medium opacity-70">Settings</span>
        </button>

        <div className="w-px h-10 bg-white/10 mx-1" />

        {/* Leave */}
        <button
          onClick={handleLeave}
          className="relative group flex flex-col items-center gap-1 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white transition-all duration-200 shadow-lg shadow-red-600/20 hover:shadow-red-500/30"
          title="Leave Meeting"
        >
          <span className="text-lg">📞</span>
          <span className="text-[10px] font-bold">Leave</span>
        </button>

        {/* Reset Position - only show when moved */}
        {!isDefaultPosition && (
          <button
            onClick={() => {
              setPosition({ x: 0, y: 0 });
              setIsDefaultPosition(true);
            }}
            className="absolute -top-8 right-2 px-3 py-1 bg-primary/90 hover:bg-primary text-white text-xs rounded-lg shadow-lg transition-all duration-200"
            title="Reset position"
          >
            ↺ Reset
          </button>
        )}
      </div>
    </div>
  );
};

export default MeetingToolbar;
