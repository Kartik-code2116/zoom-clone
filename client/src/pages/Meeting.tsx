import React, { useState, useCallback, useEffect } from 'react';
import { useParams, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LiveKitRoom, VideoConference } from '@livekit/components-react';
import '@livekit/components-styles';
import MeetingToolbar from '../components/MeetingToolbar';
import ChatPanel from '../components/ChatPanel';
import ParticipantPanel from '../components/ParticipantPanel';
import MeetingTimer from '../components/MeetingTimer';
import DeepfakeMonitor from '../components/DeepfakeMonitor';
import MeetingSettingsModal from '../components/MeetingSettingsModal';
import MeetingHeader from '../components/MeetingHeader';
import ReactionTray from '../components/ReactionTray';
import FloatingReaction from '../components/FloatingReaction';

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deepfakeGuardEnabled, setDeepfakeGuardEnabled] = useState<boolean>(() => {
    const stored = window.localStorage.getItem('deepfakeGuardEnabled');
    return stored !== null ? stored === 'true' : true;
  });
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [activeReaction, setActiveReaction] = useState<string | null>(null);

  useEffect(() => {
    window.localStorage.setItem('deepfakeGuardEnabled', String(deepfakeGuardEnabled));
  }, [deepfakeGuardEnabled]);

  const handleSelectReaction = (emoji: string) => {
    setActiveReaction(emoji);
    setReactionsOpen(false);
    setTimeout(() => setActiveReaction(null), 1200);
  };

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
        {/* Top meeting header with title, id and connection status */}
        <MeetingHeader meetingId={meetingId} title={state?.userName ? `${state.userName}'s meeting` : undefined} />

        {/* Video Conference Area */}
        <div className="h-full pb-24 pt-10 relative">
          <VideoConference />

          {/* Floating reaction animation */}
          {activeReaction && <FloatingReaction emoji={activeReaction} />}

          {/* Quick reaction tray */}
          <ReactionTray open={reactionsOpen} onSelect={handleSelectReaction} />
        </div>

        {/* DeepFake monitoring overlay (local analysis, optional logging) */}
        {deepfakeGuardEnabled && (
          <DeepfakeMonitor
            meetingId={meetingId}
            participantId={participantName}
          />
        )}

        {/* Meeting Timer */}
        <MeetingTimer />

        {/* Custom Toolbar */}
        <MeetingToolbar
          onToggleChat={handleToggleChat}
          onToggleParticipants={handleToggleParticipants}
          chatOpen={chatOpen}
          participantsOpen={participantsOpen}
          isChatUnread={isChatUnread}
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleReactions={() => setReactionsOpen((prev) => !prev)}
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

        {/* Settings modal */}
        <MeetingSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          deepfakeGuardEnabled={deepfakeGuardEnabled}
          onToggleDeepfakeGuard={() => setDeepfakeGuardEnabled((prev) => !prev)}
          onOpenFraudDashboard={() => {
            setSettingsOpen(false);
            navigate(`/meeting/${meetingId}/fraud-dashboard`);
          }}
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
