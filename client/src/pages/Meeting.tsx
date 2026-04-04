import React, { useState, useCallback, useEffect } from 'react';
import { useParams, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LiveKitRoom, VideoConference, useConnectionState } from '@livekit/components-react';
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
import FraudDashboardPanel from '../components/FraudDashboardPanel';
import { showError } from '../utils/toast';

interface LocationState {
  token?: string;
  userName?: string;
}

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880';

// Connection state monitor component
const ConnectionMonitor: React.FC<{ onError: () => void }> = ({ onError }) => {
  const connectionState = useConnectionState();
  
  useEffect(() => {
    if (connectionState === 'disconnected') {
      // Give it a moment to try connecting before showing error
      const timer = setTimeout(() => {
        onError();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [connectionState, onError]);
  
  return null;
};

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
  const [fraudDashboardOpen, setFraudDashboardOpen] = useState(false);
  const [fraudDashboardWidth, setFraudDashboardWidth] = useState(384); // Default width
  const [chatPanelWidth, setChatPanelWidth] = useState(320); // Default width
  const [participantPanelWidth, setParticipantPanelWidth] = useState(320); // Default width

  const [connectionError, setConnectionError] = useState<string | null>(null);

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
    // Only navigate to summary if we were actually connected (not a connection error)
    if (!connectionError) {
      navigate(`/meeting/${meetingId}/summary`);
    }
  }, [navigate, meetingId, connectionError]);

  const handleConnectionError = useCallback(() => {
    setConnectionError('Video server is unavailable. Please ensure LiveKit server is running.');
    showError('Failed to connect to video server. LiveKit may not be running.');
  }, []);

  // Redirect to join page if no token (after all hooks)
  if (!state?.token || !meetingId) {
    return <Navigate to={`/join/${meetingId || ''}`} replace />;
  }

  // Show connection error UI
  if (connectionError) {
    return (
      <div className="h-screen w-screen bg-darker flex items-center justify-center">
        <div className="text-center p-8 max-w-md">
          <div className="text-6xl mb-4">📹❌</div>
          <h2 className="text-2xl font-bold text-white mb-4">Connection Failed</h2>
          <p className="text-white/60 mb-6">{connectionError}</p>
          <div className="space-y-3">
            <button
              onClick={() => navigate(`/join/${meetingId}`)}
              className="w-full bg-primary hover:bg-primary/90 text-white py-3 rounded-xl font-semibold transition-all"
            >
              Back to Join Page
            </button>
            <button
              onClick={() => navigate('/dashboard')}
              className="w-full bg-white/10 hover:bg-white/20 text-white py-3 rounded-xl font-semibold transition-all"
            >
              Go to Dashboard
            </button>
          </div>
          <p className="text-white/40 text-sm mt-6">
            Tip: Start LiveKit server with <code className="bg-white/10 px-2 py-1 rounded">docker compose up -d</code>
          </p>
        </div>
      </div>
    );
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
        <ConnectionMonitor onError={handleConnectionError} />
        {/* Top meeting header with title, id and connection status */}
        <MeetingHeader meetingId={meetingId} title={state?.userName ? `${state.userName}'s meeting` : undefined} />

        {/* Video Conference Area */}
        <div 
          className="h-full pb-24 pt-10 relative transition-all duration-300"
          style={{ 
            marginRight: (fraudDashboardOpen ? fraudDashboardWidth : 0) + 
                         (chatOpen ? chatPanelWidth : 0) + 
                         (participantsOpen ? participantPanelWidth : 0)
          }}
        >
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
          width={chatPanelWidth}
          onWidthChange={setChatPanelWidth}
        />
        <ParticipantPanel
          isOpen={participantsOpen}
          onClose={() => setParticipantsOpen(false)}
          width={participantPanelWidth}
          onWidthChange={setParticipantPanelWidth}
        />

        {/* Settings modal */}
        <MeetingSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          deepfakeGuardEnabled={deepfakeGuardEnabled}
          onToggleDeepfakeGuard={() => setDeepfakeGuardEnabled((prev) => !prev)}
          onOpenFraudDashboard={() => {
            setSettingsOpen(false);
            setFraudDashboardOpen(true);
          }}
        />

        {/* Fraud Dashboard Side Panel */}
        <FraudDashboardPanel
          meetingId={meetingId}
          isOpen={fraudDashboardOpen}
          onClose={() => setFraudDashboardOpen(false)}
          onToggle={() => setFraudDashboardOpen(prev => !prev)}
          width={fraudDashboardWidth}
          onWidthChange={setFraudDashboardWidth}
        />
      </LiveKitRoom>

      {/* Overlay when panel is open (mobile) */}
      {(chatOpen || participantsOpen || fraudDashboardOpen) && (
        <div
          className="fixed inset-0 bg-black/40 z-40 sm:hidden"
          onClick={() => {
            setChatOpen(false);
            setParticipantsOpen(false);
            setFraudDashboardOpen(false);
          }}
        />
      )}
    </div>
  );
};

export default Meeting;
