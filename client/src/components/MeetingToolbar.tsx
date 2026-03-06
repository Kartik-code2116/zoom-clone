import React, { useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { showSuccess } from '../utils/toast';

interface MeetingToolbarProps {
  onToggleChat: () => void;
  onToggleParticipants: () => void;
  chatOpen: boolean;
  participantsOpen: boolean;
  isChatUnread: boolean;
}

const MeetingToolbar: React.FC<MeetingToolbarProps> = ({
  onToggleChat,
  onToggleParticipants,
  chatOpen,
  participantsOpen,
  isChatUnread,
}) => {
  const navigate = useNavigate();
  const { meetingId } = useParams<{ meetingId: string }>();
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();

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
    <div className="absolute bottom-0 left-0 right-0 z-40 bg-darker/95 backdrop-blur-md border-t border-white/5">
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

        {/* Copy Link */}
        <button
          onClick={copyLink}
          className="relative group flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white transition-all duration-200"
          title="Copy Invite Link"
        >
          <span className="text-lg">🔗</span>
          <span className="text-[10px] font-medium opacity-70">Invite</span>
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
      </div>
    </div>
  );
};

export default MeetingToolbar;
