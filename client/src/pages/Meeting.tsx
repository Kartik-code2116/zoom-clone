import React, { useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LiveKitRoom, VideoConference } from '@livekit/components-react';
import '@livekit/components-styles';
import MeetingToolbar from '../components/MeetingToolbar';
import ChatPanel from '../components/ChatPanel';
import ParticipantPanel from '../components/ParticipantPanel';
import MeetingTimer from '../components/MeetingTimer';

interface LocationState {
  token?: string;
  userName?: string;
}

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880';

const Meeting: React.FC = () => {
  const { meetingId } = useParams<{ meetingId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as LocationState | null;
  const { user } = useAuth();
  const participantName = state?.userName || user?.name || 'Guest';

  const [chatOpen, setChatOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [isChatUnread, setIsChatUnread] = useState(false);

  const handleToggleChat = useCallback(() => {
    setChatOpen((prev) => {
      if (!prev) {
        setParticipantsOpen(false);
        setIsChatUnread(false);
      }
      return !prev;
    });
  }, []);

  const handleToggleParticipants = useCallback(() => {
    setParticipantsOpen((prev) => {
      if (!prev) {
        setChatOpen(false);
      }
      return !prev;
    });
  }, []);

  const handleDisconnected = useCallback(() => {
    navigate(`/meeting/${meetingId}/summary`);
  }, [navigate, meetingId]);

  // Redirect to join page if no token (after all hooks)
  if (!state?.token || !meetingId) {
    return <Navigate to={`/join/${meetingId || ''}`} replace />;
  }

  return (
    <div className="h-screen w-screen bg-darker overflow-hidden relative">
      <LiveKitRoom
        serverUrl={LIVEKIT_URL}
        token={state.token}
        connect={true}
        onDisconnected={handleDisconnected}
        data-lk-theme="default"
        style={{ height: '100%' }}
      >
        {/* Video Conference Area */}
        <div className="h-full pb-20">
          <VideoConference />
        </div>

        {/* Meeting Timer */}
        <MeetingTimer />

        {/* Custom Toolbar */}
        <MeetingToolbar
          onToggleChat={handleToggleChat}
          onToggleParticipants={handleToggleParticipants}
          chatOpen={chatOpen}
          participantsOpen={participantsOpen}
          isChatUnread={isChatUnread}
        />

        {/* Side Panels */}
        <ChatPanel
          meetingId={meetingId}
          userName={participantName}
          isOpen={chatOpen}
          onClose={() => setChatOpen(false)}
          onNewMessage={() => { if (!chatOpen) setIsChatUnread(true); }}
        />
        <ParticipantPanel
          isOpen={participantsOpen}
          onClose={() => setParticipantsOpen(false)}
        />
      </LiveKitRoom>

      {/* Overlay when panel is open (mobile) */}
      {(chatOpen || participantsOpen) && (
        <div
          className="fixed inset-0 bg-black/40 z-40 sm:hidden"
          onClick={() => {
            setChatOpen(false);
            setParticipantsOpen(false);
          }}
        />
      )}
    </div>
  );
};

export default Meeting;
