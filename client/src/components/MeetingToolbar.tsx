import React, { useEffect, useCallback, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { LocalVideoTrack } from 'livekit-client';
import { showSuccess } from '../utils/toast';
import {
  Mic, MicOff,
  Video, VideoOff,
  Monitor,
  MessageSquare,
  Users,
  Smile,
  Link2,
  Shield,
  Settings,
  PhoneOff,
  ChevronDown,
  ChevronUp,
  Camera,
  Theater,
  MoreHorizontal,
} from 'lucide-react';

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
  onToggleFraudDashboard?: () => void;
  deepfakeAlert?: boolean;   // NEW — shows red badge on Guard button
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
  onToggleFraudDashboard,
  deepfakeAlert = false,
}) => {
  const navigate      = useNavigate();
  const { meetingId } = useParams<{ meetingId: string }>();
  const room          = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();

  // Camera device state
  const [videoDevices,     setVideoDevices]     = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [isDeviceMenuOpen, setIsDeviceMenuOpen] = useState(false);
  const [moreMenuOpen,     setMoreMenuOpen]     = useState(false);
  const deviceMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef   = useRef<HTMLDivElement>(null);

  // Draggable state
  const toolbarRef        = useRef<HTMLDivElement>(null);
  const [position,        setPosition]        = useState({ x: 0, y: 0 });
  const [isDragging,      setIsDragging]      = useState(false);
  const [dragStart,       setDragStart]       = useState({ x: 0, y: 0 });
  const [isDefaultPosition, setIsDefaultPosition] = useState(true);

  // ── Device enumeration ─────────────────────────────────────────────
  const getVideoDevices = useCallback(async () => {
    try {
      const devices    = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter(d => d.kind === 'videoinput');
      setVideoDevices(videoInputs);
      const videoTrack = localParticipant.videoTrackPublications.values().next().value?.track;
      if (videoTrack) {
        const mst = (videoTrack as LocalVideoTrack).mediaStreamTrack;
        if (mst) {
          const cur = videoInputs.find(d => d.label === mst.label);
          if (cur) setSelectedDeviceId(cur.deviceId);
        }
      }
    } catch { /* silent */ }
  }, [localParticipant]);

  useEffect(() => { getVideoDevices(); }, [getVideoDevices, isCameraEnabled]);

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (deviceMenuRef.current && !deviceMenuRef.current.contains(e.target as Node))
        setIsDeviceMenuOpen(false);
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node))
        setMoreMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Camera switch ──────────────────────────────────────────────────
  const switchCamera = useCallback(async (deviceId: string) => {
    try {
      setSelectedDeviceId(deviceId);
      setIsDeviceMenuOpen(false);
      const videoPubs = Array.from(localParticipant.videoTrackPublications.values());
      const videoPub  = videoPubs[0];
      if (!videoPub?.track) {
        await localParticipant.setCameraEnabled(true, { deviceId });
        return;
      }
      const videoTrack = videoPub.track as any;
      if      (videoTrack?.switchDevice)   { await videoTrack.switchDevice(deviceId); }
      else if (videoTrack?.restartTrack)   { await videoTrack.restartTrack({ deviceId }); }
      else {
        await localParticipant.setCameraEnabled(false);
        await new Promise(r => setTimeout(r, 500));
        await localParticipant.setCameraEnabled(true, { deviceId });
      }
      showSuccess('Camera switched');
    } catch {
      showSuccess('Camera busy — stop face swap first');
    }
  }, [localParticipant]);

  // ── Dragging ───────────────────────────────────────────────────────
  const getRightMargin = () => {
    let m = 0;
    if (fraudDashboardOpen) m += fraudDashboardWidth;
    if (chatOpen)           m += chatPanelWidth;
    if (participantsOpen)   m += participantPanelWidth;
    return m;
  };

  const handleDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const maxX = window.innerWidth  - (toolbarRef.current?.offsetWidth  || 500);
      const maxY = window.innerHeight - (toolbarRef.current?.offsetHeight || 80);
      setPosition({
        x: Math.max(0, Math.min(e.clientX - dragStart.x, maxX)),
        y: Math.max(0, Math.min(e.clientY - dragStart.y, maxY)),
      });
      setIsDefaultPosition(false);
    };
    const onUp = () => { setIsDragging(false); document.body.style.cursor = ''; };
    if (isDragging) {
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'grabbing';
    }
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, dragStart]);

  // ── Media controls ─────────────────────────────────────────────────
  const toggleMic = useCallback(async () => {
    await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  }, [localParticipant, isMicrophoneEnabled]);

  const toggleCamera = useCallback(async () => {
    await localParticipant.setCameraEnabled(!isCameraEnabled);
  }, [localParticipant, isCameraEnabled]);

  const toggleScreenShare = useCallback(async () => {
    await localParticipant.setScreenShareEnabled(!localParticipant.isScreenShareEnabled);
  }, [localParticipant]);

  const shareFaceSwap = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'window' }, audio: false });
      const screenTrack = stream.getVideoTracks()[0];
      if (screenTrack) {
        await localParticipant.setCameraEnabled(false);
        const { LocalVideoTrack: LVT } = await import('livekit-client');
        const lkTrack = new LVT(screenTrack);
        await localParticipant.publishTrack(lkTrack);
        showSuccess('Face Swap window shared!');
        screenTrack.onended = () => {
          localParticipant.unpublishTrack(lkTrack);
          localParticipant.setCameraEnabled(true);
        };
      }
    } catch { showSuccess('Could not share window — use Screen Share instead'); }
  }, [localParticipant]);

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(`${window.location.origin}/join/${meetingId}`);
    showSuccess('Meeting link copied!');
  }, [meetingId]);

  const handleLeave = useCallback(() => {
    room.disconnect();
    navigate(`/meeting/${meetingId}/summary`);
  }, [room, navigate, meetingId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key.toLowerCase() === 'm') toggleMic();
      if (e.key.toLowerCase() === 'v') toggleCamera();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleMic, toggleCamera]);

  // ── Button helpers ─────────────────────────────────────────────────
  const mediaBtn = (active: boolean) =>
    `relative flex flex-col items-center gap-1 px-3.5 py-2.5 rounded-xl
     transition-all duration-200 select-none cursor-pointer
     ${active
       ? 'bg-surface-3/80 hover:bg-surface-3 text-white'
       : 'bg-danger hover:bg-danger/90 text-white shadow-md shadow-danger/25'}`;

  const panelBtn = (active: boolean) =>
    `relative flex flex-col items-center gap-1 px-3.5 py-2.5 rounded-xl
     transition-all duration-200 select-none cursor-pointer
     ${active
       ? 'bg-primary/20 text-primary ring-1 ring-primary/30'
       : 'bg-white/8 hover:bg-white/12 text-white/80 hover:text-white'}`;

  const actionBtn =
    `flex flex-col items-center gap-1 px-3.5 py-2.5 rounded-xl
     bg-white/8 hover:bg-white/12 text-white/80 hover:text-white
     transition-all duration-200 select-none cursor-pointer`;

  const label = (text: string) => (
    <span className="text-[10px] font-medium leading-none">{text}</span>
  );

  return (
    <div
      ref={toolbarRef}
      className={`z-50 bg-surface/95 backdrop-blur-xl border border-white/10
                  rounded-2xl shadow-2xl transition-shadow duration-200
                  ${isDragging ? 'shadow-primary/20 cursor-grabbing' : 'hover:shadow-xl cursor-grab'}
                  ${isDefaultPosition ? 'absolute bottom-0 left-0 right-0' : 'fixed'}`}
      style={isDefaultPosition
        ? { right: getRightMargin(), transition: 'right 0.3s ease-out' }
        : { left: position.x, top: position.y, right: 'auto', bottom: 'auto' }}
    >
      {/* Drag handle (only when floating) */}
      {!isDefaultPosition && (
        <div onMouseDown={handleDragStart}
          className="w-full h-3 flex items-center justify-center cursor-grab active:cursor-grabbing">
          <div className="w-8 h-1 bg-white/20 rounded-full" />
        </div>
      )}

      <div onMouseDown={isDefaultPosition ? handleDragStart : undefined}
        className="flex items-center justify-center gap-1 sm:gap-1.5 px-4 py-3 flex-wrap">

        {/* ── Mic ─────────────────────────────────────────────── */}
        <button onClick={toggleMic} className={mediaBtn(isMicrophoneEnabled)} title="Toggle Mic (M)">
          {isMicrophoneEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          {label(isMicrophoneEnabled ? 'Mute' : 'Unmuted')}
        </button>

        {/* ── Camera + device picker ─────────────────────────── */}
        <div className="relative flex items-center" ref={deviceMenuRef}>
          <button onClick={toggleCamera}
            className={`${mediaBtn(isCameraEnabled)} ${videoDevices.length > 1 ? 'rounded-r-none border-r border-white/10' : ''}`}
            title="Toggle Camera (V)">
            {isCameraEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
            {label(isCameraEnabled ? 'Stop' : 'Start')}
          </button>
          {videoDevices.length > 1 && (
            <button
              onClick={() => setIsDeviceMenuOpen(!isDeviceMenuOpen)}
              className={`px-2 py-2.5 rounded-r-xl border-l-0 transition-all duration-200 self-stretch flex items-center
                          ${isCameraEnabled ? 'bg-surface-3/80 hover:bg-surface-3 text-white' : 'bg-danger hover:bg-danger/90 text-white'}`}
              title="Switch camera">
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isDeviceMenuOpen ? 'rotate-180' : ''}`} />
            </button>
          )}
          {isDeviceMenuOpen && videoDevices.length > 1 && (
            <div className="absolute bottom-full left-0 mb-2 bg-surface-2 border border-white/10
                            rounded-xl overflow-hidden shadow-2xl min-w-52 z-50 animate-in">
              <div className="px-3 py-2 text-xs text-text-muted border-b border-white/8 bg-white/4">
                Select Camera
              </div>
              {videoDevices.map((device) => (
                <button key={device.deviceId}
                  onClick={() => switchCamera(device.deviceId)}
                  className={`w-full px-3 py-2.5 text-left text-sm flex items-center gap-2
                              hover:bg-white/6 transition-colors
                              ${selectedDeviceId === device.deviceId ? 'bg-primary/15 text-primary' : 'text-white/80'}`}>
                  <Camera className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{device.label || `Camera ${videoDevices.indexOf(device) + 1}`}</span>
                  {device.label.toLowerCase().includes('obs') && (
                    <span className="ml-auto text-xs text-primary/80 flex-shrink-0">OBS</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Screen share ─────────────────────────────────────── */}
        <button onClick={toggleScreenShare} className={actionBtn} title="Share Screen">
          <Monitor className="w-5 h-5" />
          {label('Share')}
        </button>

        <div className="w-px h-9 bg-white/10 mx-0.5" />

        {/* ── Chat ─────────────────────────────────────────────── */}
        <button onClick={onToggleChat} className={panelBtn(chatOpen)} title="Chat">
          <MessageSquare className="w-5 h-5" />
          {label('Chat')}
          {isChatUnread && !chatOpen && (
            <span className="absolute top-1.5 right-2.5 w-2 h-2 bg-primary rounded-full animate-pulse
                             ring-2 ring-surface" />
          )}
        </button>

        {/* ── Participants ─────────────────────────────────────── */}
        <button onClick={onToggleParticipants} className={panelBtn(participantsOpen)} title="Participants">
          <Users className="w-5 h-5" />
          {label('People')}
        </button>

        {/* ── Reactions ────────────────────────────────────────── */}
        <button onClick={onToggleReactions} className={actionBtn} title="Reactions">
          <Smile className="w-5 h-5" />
          {label('React')}
        </button>

        {/* ── Invite link ──────────────────────────────────────── */}
        <button onClick={copyLink} className={actionBtn} title="Copy invite link">
          <Link2 className="w-5 h-5" />
          {label('Invite')}
        </button>

        {/* ── AI Guard ─────────────────────────────────────────── */}
        <button onClick={onToggleFraudDashboard}
          className={`${panelBtn(fraudDashboardOpen ?? false)}`} title="AI Deepfake Guard">
          <Shield className="w-5 h-5" />
          {label('Guard')}
          {deepfakeAlert && (
            <span className="absolute top-1.5 right-2 w-2 h-2 bg-danger rounded-full
                             animate-pulse ring-2 ring-surface" />
          )}
        </button>

        {/* ── More (advanced) ──────────────────────────────────── */}
        <div className="relative" ref={moreMenuRef}>
          <button onClick={() => setMoreMenuOpen(!moreMenuOpen)}
            className={panelBtn(moreMenuOpen)} title="More options">
            <MoreHorizontal className="w-5 h-5" />
            {label('More')}
          </button>
          {moreMenuOpen && (
            <div className="absolute bottom-full right-0 mb-2 bg-surface-2 border border-white/10
                            rounded-xl overflow-hidden shadow-2xl min-w-48 z-50 animate-in">
              <div className="px-3 py-2 text-xs text-text-muted border-b border-white/8 bg-white/4">
                Advanced Options
              </div>
              <button onClick={() => { shareFaceSwap(); setMoreMenuOpen(false); }}
                className="w-full px-4 py-3 text-left text-sm flex items-center gap-3
                           hover:bg-white/6 text-white/80 hover:text-white transition-colors">
                <Theater className="w-4 h-4 text-primary" />
                <div>
                  <div className="font-medium">Share Face Swap</div>
                  <div className="text-xs text-text-muted">Share OBS virtual camera window</div>
                </div>
              </button>
              <button onClick={() => { onOpenSettings(); setMoreMenuOpen(false); }}
                className="w-full px-4 py-3 text-left text-sm flex items-center gap-3
                           hover:bg-white/6 text-white/80 hover:text-white transition-colors">
                <Settings className="w-4 h-4 text-text-muted" />
                <div>
                  <div className="font-medium">Settings</div>
                  <div className="text-xs text-text-muted">Audio, video & meeting options</div>
                </div>
              </button>
            </div>
          )}
        </div>

        <div className="w-px h-9 bg-white/10 mx-0.5" />

        {/* ── Leave ────────────────────────────────────────────── */}
        <button onClick={handleLeave}
          className="flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl
                     bg-danger hover:bg-danger/90 text-white
                     shadow-lg shadow-danger/25 hover:shadow-danger/40
                     transition-all duration-200"
          title="Leave meeting">
          <PhoneOff className="w-5 h-5" />
          {label('Leave')}
        </button>

        {/* Reset position */}
        {!isDefaultPosition && (
          <button onClick={() => { setPosition({ x: 0, y: 0 }); setIsDefaultPosition(true); }}
            className="absolute -top-8 right-2 px-3 py-1 bg-primary/90 hover:bg-primary
                       text-white text-xs rounded-lg shadow-lg transition-all">
            ↺ Reset
          </button>
        )}
      </div>
    </div>
  );
};

export default MeetingToolbar;
