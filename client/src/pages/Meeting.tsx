import React, { useState, useCallback, useEffect } from 'react';
import { useParams, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LiveKitRoom, VideoConference, useConnectionState, useRoomContext, useLocalParticipant } from '@livekit/components-react';
import '@livekit/components-styles';
import MeetingToolbar from '../components/MeetingToolbar';
import ChatPanel from '../components/ChatPanel';
import ParticipantPanel from '../components/ParticipantPanel';
import MeetingTimer from '../components/MeetingTimer';
import DeepfakeMonitor from '../components/DeepfakeMonitor';
import RemoteParticipantsDeepfakeMonitor from '../components/RemoteParticipantsDeepfakeMonitor';
import MeetingSettingsModal from '../components/MeetingSettingsModal';
import MeetingHeader from '../components/MeetingHeader';
import ReactionTray from '../components/ReactionTray';
import FloatingReaction from '../components/FloatingReaction';
import FraudDashboardPanel from '../components/FraudDashboardPanel';
import LiveCaptions from '../components/LiveCaptions';
import PollsPanel from '../components/PollsPanel';
import WhiteboardPanel from '../components/WhiteboardPanel';
import { showError, showSuccess } from '../utils/toast';
import { ParticipantDeepfakeState } from '../components/RemoteParticipantsDeepfakeMonitor';

interface LocationState {
  token?: string;
  userName?: string;
}

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || 'wss://zoom-clone-2jil3ca0.livekit.cloud';

// ── Connection monitor ────────────────────────────────────────────────
const ConnectionMonitor: React.FC<{ onError: () => void }> = ({ onError }) => {
  const connectionState = useConnectionState();
  useEffect(() => {
    if (connectionState === 'disconnected') {
      const timer = setTimeout(onError, 3000);
      return () => clearTimeout(timer);
    }
  }, [connectionState, onError]);
  return null;
};

// ── Inner component that uses LiveKit hooks ───────────────────────────
const MeetingInner: React.FC<{
  meetingId: string;
  participantName: string;
  locationState: LocationState;
}> = ({ meetingId, participantName, locationState }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { localParticipant } = useLocalParticipant();

  // Panel open states
  const [chatOpen,          setChatOpen]          = useState(false);
  const [participantsOpen,  setParticipantsOpen]  = useState(false);
  const [isChatUnread,      setIsChatUnread]      = useState(false);
  const [settingsOpen,      setSettingsOpen]      = useState(false);
  const [reactionsOpen,     setReactionsOpen]     = useState(false);
  const [fraudDashboardOpen,setFraudDashboardOpen]= useState(false);
  const [pollsOpen,         setPollsOpen]         = useState(false);
  const [whiteboardOpen,    setWhiteboardOpen]    = useState(false);

  // Deepfake
  const [deepfakeGuardEnabled, setDeepfakeGuardEnabled] = useState<boolean>(() => {
    const stored = window.localStorage.getItem('deepfakeGuardEnabled');
    return stored !== null ? stored === 'true' : true;
  });
  const [remoteParticipantStatuses, setRemoteParticipantStatuses] = useState<ParticipantDeepfakeState[]>([]);

  // Panel widths
  const [fraudDashboardWidth,    setFraudDashboardWidth]    = useState(384);
  const [chatPanelWidth,         setChatPanelWidth]         = useState(320);
  const [participantPanelWidth,  setParticipantPanelWidth]  = useState(320);
  const [pollsPanelWidth,        setPollsPanelWidth]        = useState(320);
  const [whiteboardPanelWidth,   setWhiteboardPanelWidth]   = useState(420);

  // New feature states
  const [isHandRaised,    setIsHandRaised]    = useState(false);
  const [raisedHands,     setRaisedHands]     = useState<Set<string>>(new Set());
  const [captionsOn,      setCaptionsOn]      = useState(false);
  const [currentLayout,   setCurrentLayout]   = useState<'grid' | 'spotlight' | 'sidebar'>('grid');
  const [isMeetingLocked, setIsMeetingLocked] = useState(false);
  const [activeReaction,  setActiveReaction]  = useState<string | null>(null);

  // Persist deepfake setting
  useEffect(() => {
    window.localStorage.setItem('deepfakeGuardEnabled', String(deepfakeGuardEnabled));
  }, [deepfakeGuardEnabled]);

  // ── Host check ──────────────────────────────────────────────────────
  const isHost = useCallback(() => {
    try { return !!JSON.parse(localParticipant?.metadata || '{}').isHost; } catch { return false; }
  }, [localParticipant]);

  // ── LiveKit data messages (raise hand + host commands) ─────────────
  // Import room here via hook
  const room = (window as any).__lkRoom; // fallback; real hook is below

  const sendHandSignal = useCallback((raised: boolean) => {
    try {
      const encoder = new TextEncoder();
      const data    = encoder.encode(JSON.stringify({
        type: 'RAISE_HAND',
        raised,
        identity: localParticipant?.identity,
      }));
      localParticipant?.publishData(data, { reliable: true });
    } catch { /* offline or not connected */ }
  }, [localParticipant]);

  const toggleHand = useCallback(() => {
    const next = !isHandRaised;
    setIsHandRaised(next);
    sendHandSignal(next);
    showSuccess(next ? '✋ Hand raised' : 'Hand lowered');
  }, [isHandRaised, sendHandSignal]);

  // Listen for data from others
  useEffect(() => {
    if (!localParticipant) return;
    const handler = (payload: Uint8Array, participant: any) => {
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload));

        if (msg.type === 'RAISE_HAND') {
          setRaisedHands(prev => {
            const next = new Set(prev);
            if (msg.raised) next.add(msg.identity);
            else            next.delete(msg.identity);
            return next;
          });
        }

        if (msg.type === 'HOST_CMD' && isHost()) {
          // Already handled by server in production; client-side only for demo
        }
      } catch { /* ignore malformed */ }
    };

    // Listen via room events — access room from localParticipant
    const room = (localParticipant as any)._room;
    if (room) {
      room.on('dataReceived', handler);
      return () => room.off('dataReceived', handler);
    }
  }, [localParticipant, isHost]);

  // ── Host controls ───────────────────────────────────────────────────
  const handleMuteAll = useCallback(() => {
    try {
      const encoder = new TextEncoder();
      const data    = encoder.encode(JSON.stringify({ type: 'HOST_CMD', command: 'MUTE_ALL' }));
      localParticipant?.publishData(data, { reliable: true });
      showSuccess('Mute All sent to participants');
    } catch { /* silent */ }
  }, [localParticipant]);

  const handleLockMeeting = useCallback(() => {
    setIsMeetingLocked(prev => {
      const next = !prev;
      showSuccess(next ? '🔒 Meeting locked' : '🔓 Meeting unlocked');
      return next;
    });
  }, []);

  // ── Layout cycle ────────────────────────────────────────────────────
  const handleToggleLayout = useCallback(() => {
    setCurrentLayout(l => l === 'grid' ? 'spotlight' : l === 'spotlight' ? 'sidebar' : 'grid');
    showSuccess('Layout changed');
  }, []);

  // ── Panel toggles ───────────────────────────────────────────────────
  const handleToggleChat = useCallback(() => {
    setChatOpen(prev => {
      if (!prev) { setParticipantsOpen(false); setIsChatUnread(false); }
      return !prev;
    });
  }, []);

  const handleToggleParticipants = useCallback(() => {
    setParticipantsOpen(prev => { if (!prev) setChatOpen(false); return !prev; });
  }, []);

  const handleTogglePolls = useCallback(() => {
    setPollsOpen(prev => !prev);
  }, []);

  const handleToggleWhiteboard = useCallback(() => {
    setWhiteboardOpen(prev => !prev);
  }, []);

  const handleSelectReaction = (emoji: string) => {
    setActiveReaction(emoji);
    setReactionsOpen(false);
    setTimeout(() => setActiveReaction(null), 1200);
  };

  // Total right margin for video area
  const rightMargin = (fraudDashboardOpen ? fraudDashboardWidth : 0)
    + (chatOpen             ? chatPanelWidth           : 0)
    + (participantsOpen     ? participantPanelWidth     : 0)
    + (pollsOpen            ? pollsPanelWidth           : 0)
    + (whiteboardOpen       ? whiteboardPanelWidth      : 0);

  return (
    <>
      <ConnectionMonitor onError={() => {
        showError('Failed to connect to video server. LiveKit may not be running.');
      }} />

      <MeetingHeader
        meetingId={meetingId}
        title={locationState?.userName ? `${locationState.userName}'s meeting` : undefined}
      />

      {/* Meeting locked banner */}
      {isMeetingLocked && (
        <div className="absolute top-10 left-0 right-0 z-30 flex justify-center pointer-events-none">
          <div className="bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 text-xs font-semibold
                          px-4 py-1.5 rounded-full flex items-center gap-2">
            🔒 Meeting is locked — new participants cannot join
          </div>
        </div>
      )}

      {/* Video area */}
      <div
        className="h-full pb-24 pt-10 relative transition-all duration-300"
        style={{ marginRight: rightMargin }}
      >
        <VideoConference />
        {activeReaction && <FloatingReaction emoji={activeReaction} />}
        <ReactionTray open={reactionsOpen} onSelect={handleSelectReaction} />
      </div>

      {/* Live Captions */}
      <LiveCaptions
        isEnabled={captionsOn}
        participantName={participantName}
        onClose={() => setCaptionsOn(false)}
      />

      {deepfakeGuardEnabled && (
        <>
          <DeepfakeMonitor meetingId={meetingId} participantId={participantName} />
          <RemoteParticipantsDeepfakeMonitor
            meetingId={meetingId}
            onParticipantStatusChange={setRemoteParticipantStatuses}
          />
        </>
      )}

      <MeetingTimer />

      <MeetingToolbar
        onToggleChat={handleToggleChat}
        onToggleParticipants={handleToggleParticipants}
        chatOpen={chatOpen}
        participantsOpen={participantsOpen}
        isChatUnread={isChatUnread}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleReactions={() => setReactionsOpen(prev => !prev)}
        fraudDashboardOpen={fraudDashboardOpen}
        fraudDashboardWidth={fraudDashboardWidth}
        chatPanelWidth={chatPanelWidth}
        participantPanelWidth={participantPanelWidth}
        onToggleFraudDashboard={() => setFraudDashboardOpen(prev => !prev)}
        // New props
        isHandRaised={isHandRaised}
        onToggleHand={toggleHand}
        captionsOn={captionsOn}
        onToggleCaptions={() => setCaptionsOn(prev => !prev)}
        onToggleLayout={handleToggleLayout}
        currentLayout={currentLayout}
        isHost={isHost()}
        onMuteAll={handleMuteAll}
        onLockMeeting={handleLockMeeting}
        isMeetingLocked={isMeetingLocked}
        pollsOpen={pollsOpen}
        onTogglePolls={handleTogglePolls}
        whiteboardOpen={whiteboardOpen}
        onToggleWhiteboard={handleToggleWhiteboard}
      />

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
        raisedHands={raisedHands}
        isMeetingLocked={isMeetingLocked}
        onLockMeeting={handleLockMeeting}
      />

      <PollsPanel
        isOpen={pollsOpen}
        onClose={() => setPollsOpen(false)}
        isHost={isHost()}
        userName={participantName}
        width={pollsPanelWidth}
        onWidthChange={setPollsPanelWidth}
      />

      <WhiteboardPanel
        isOpen={whiteboardOpen}
        onClose={() => setWhiteboardOpen(false)}
        width={whiteboardPanelWidth}
        onWidthChange={setWhiteboardPanelWidth}
      />

      <MeetingSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        deepfakeGuardEnabled={deepfakeGuardEnabled}
        onToggleDeepfakeGuard={() => setDeepfakeGuardEnabled(prev => !prev)}
        onOpenFraudDashboard={() => { setSettingsOpen(false); setFraudDashboardOpen(true); }}
      />

      <FraudDashboardPanel
        meetingId={meetingId}
        isOpen={fraudDashboardOpen}
        onClose={() => setFraudDashboardOpen(false)}
        onToggle={() => setFraudDashboardOpen(prev => !prev)}
        width={fraudDashboardWidth}
        onWidthChange={setFraudDashboardWidth}
      />

      {(chatOpen || participantsOpen || fraudDashboardOpen) && (
        <div
          className="fixed inset-0 bg-black/40 z-40 sm:hidden"
          onClick={() => { setChatOpen(false); setParticipantsOpen(false); setFraudDashboardOpen(false); }}
        />
      )}
    </>
  );
};

// ── Main Meeting page (wraps LiveKitRoom) ────────────────────────────
const Meeting: React.FC = () => {
  const { meetingId }   = useParams<{ meetingId: string }>();
  const location        = useLocation();
  const navigate        = useNavigate();
  const state           = location.state as LocationState | null;
  const { user }        = useAuth();
  const participantName = state?.userName || user?.name || 'Guest';

  const [connectionError, setConnectionError] = useState<string | null>(null);

  const handleConnectionError = useCallback(() => {
    setConnectionError('Video server is unavailable. Please ensure LiveKit server is running.');
    showError('Failed to connect to video server. LiveKit may not be running.');
  }, []);

  const handleDisconnected = useCallback(() => {
    if (!connectionError) navigate(`/meeting/${meetingId}/summary`);
  }, [navigate, meetingId, connectionError]);

  if (!state?.token || !meetingId) {
    return <Navigate to={`/join/${meetingId || ''}`} replace />;
  }

  if (connectionError) {
    return (
      <div className="h-screen w-screen bg-darker flex items-center justify-center">
        <div className="text-center p-8 max-w-md">
          <div className="text-6xl mb-4">📹❌</div>
          <h2 className="text-2xl font-bold text-white mb-4">Connection Failed</h2>
          <p className="text-white/60 mb-6">{connectionError}</p>
          <div className="space-y-3">
            <button onClick={() => navigate(`/join/${meetingId}`)}
              className="w-full bg-primary hover:bg-primary/90 text-white py-3 rounded-xl font-semibold transition-all">
              Back to Join Page
            </button>
            <button onClick={() => navigate('/dashboard')}
              className="w-full bg-white/10 hover:bg-white/20 text-white py-3 rounded-xl font-semibold transition-all">
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
        <MeetingInner
          meetingId={meetingId}
          participantName={participantName}
          locationState={state}
        />
      </LiveKitRoom>
    </div>
  );
};

export default Meeting;
