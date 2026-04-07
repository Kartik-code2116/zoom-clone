import React, { useEffect, useCallback, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { LocalVideoTrack } from 'livekit-client';
import { showSuccess } from '../utils/toast';
import { Shield, Camera, ChevronDown } from 'lucide-react';

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
}) => {
  const navigate = useNavigate();
  const { meetingId } = useParams<{ meetingId: string }>();
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  
  // Camera device state
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [isDeviceMenuOpen, setIsDeviceMenuOpen] = useState(false);
  const deviceMenuRef = useRef<HTMLDivElement>(null);

  // Get available video devices
  const getVideoDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter(d => d.kind === 'videoinput');
      setVideoDevices(videoInputs);
      
      // Try to find current device from active track
      const videoTrack = localParticipant.videoTrackPublications.values().next().value?.track;
      if (videoTrack) {
        const mediaStreamTrack = (videoTrack as LocalVideoTrack).mediaStreamTrack;
        if (mediaStreamTrack) {
          const currentLabel = mediaStreamTrack.label;
          const currentDevice = videoInputs.find(d => d.label === currentLabel);
          if (currentDevice) {
            setSelectedDeviceId(currentDevice.deviceId);
          }
        }
      }
    } catch (err) {
      console.error('Failed to enumerate devices:', err);
    }
  }, [localParticipant]);

  // Enumerate devices on mount and when camera is enabled
  useEffect(() => {
    getVideoDevices();
  }, [getVideoDevices, isCameraEnabled]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (deviceMenuRef.current && !deviceMenuRef.current.contains(e.target as Node)) {
        setIsDeviceMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Switch camera device using LiveKit native method
  const switchCamera = useCallback(async (deviceId: string) => {
    console.log('🎥 Switching camera to:', deviceId);
    try {
      setSelectedDeviceId(deviceId);
      setIsDeviceMenuOpen(false);

      // Find the video track publication
      const videoPubs = Array.from(localParticipant.videoTrackPublications.values());
      console.log('📹 Current video publications:', videoPubs.length);
      const videoPub = videoPubs[0];

      if (!videoPub?.track) {
        console.log('📷 No existing track, enabling camera with device:', deviceId);
        await localParticipant.setCameraEnabled(true, { deviceId });
        console.log('✅ Camera enabled with device');
        return;
      }

      // Use LiveKit's native switchDevice if available
      const videoTrack = videoPub.track as any;
      console.log('🔧 Video track methods:', Object.keys(videoTrack));
      
      if (videoTrack?.switchDevice) {
        console.log('🔄 Using switchDevice method');
        await videoTrack.switchDevice(deviceId);
        console.log('✅ Camera switched via switchDevice');
        showSuccess('Camera switched');
      } else if (videoTrack?.restartTrack) {
        console.log('🔄 Using restartTrack method');
        await videoTrack.restartTrack({ deviceId });
        console.log('✅ Camera switched via restartTrack');
        showSuccess('Camera switched');
      } else {
        console.log('⚠️ No native method, falling back to disable/enable');
        await localParticipant.setCameraEnabled(false);
        await new Promise(r => setTimeout(r, 500));
        await localParticipant.setCameraEnabled(true, { deviceId });
        console.log('✅ Camera switched via fallback');
        showSuccess('Camera switched');
      }
    } catch (err) {
      console.error('❌ Failed to switch camera:', err);
      showSuccess('Camera busy - stop face swap first');
    }
  }, [localParticipant]);
  
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

  // Share face swap window specifically
  const shareFaceSwap = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'window'
        },
        audio: false
      });
      
      // Replace video track with screen share
      const screenTrack = stream.getVideoTracks()[0];
      if (screenTrack) {
        // Stop existing camera first
        await localParticipant.setCameraEnabled(false);
        
        // Publish screen track as video
        const { LocalVideoTrack } = await import('livekit-client');
        const lkTrack = new LocalVideoTrack(screenTrack);
        await localParticipant.publishTrack(lkTrack);
        
        showSuccess('Face Swap window shared!');
        
        // Handle when user stops sharing
        screenTrack.onended = () => {
          localParticipant.unpublishTrack(lkTrack);
          localParticipant.setCameraEnabled(true);
        };
      }
    } catch (err) {
      console.error('Failed to share face swap:', err);
      showSuccess('Could not share window - use Screen Share button instead');
    }
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

        {/* Camera Toggle with Device Selector */}
        <div className="relative" ref={deviceMenuRef}>
          <div className="flex items-center">
            <button
              onClick={toggleCamera}
              className={`relative group flex flex-col items-center gap-1 px-4 py-2.5 rounded-l-xl transition-all duration-200 ${
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
            
            {/* Camera dropdown button */}
            {videoDevices.length > 1 && (
              <button
                onClick={() => setIsDeviceMenuOpen(!isDeviceMenuOpen)}
                className={`px-2 py-2.5 rounded-r-xl border-l border-white/10 transition-all duration-200 ${
                  isCameraEnabled
                    ? 'bg-white/10 hover:bg-white/15 text-white'
                    : 'bg-red-500/20 hover:bg-red-500/30 text-red-400'
                }`}
                title="Switch Camera"
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${isDeviceMenuOpen ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>

          {/* Camera device dropdown */}
          {isDeviceMenuOpen && videoDevices.length > 1 && (
            <div className="absolute bottom-full left-0 mb-2 bg-darker border border-white/10 rounded-lg overflow-hidden shadow-xl min-w-[200px] z-50">
              <div className="px-3 py-2 text-xs text-white/50 border-b border-white/10 bg-white/5">
                Select Camera
              </div>
              {videoDevices.map((device) => (
                <button
                  key={device.deviceId}
                  onClick={() => {
                    switchCamera(device.deviceId);
                    setIsDeviceMenuOpen(false);
                  }}
                  className={`w-full px-3 py-2.5 text-left text-sm hover:bg-white/5 transition-colors flex items-center gap-2 ${
                    selectedDeviceId === device.deviceId ? 'bg-primary/20 text-primary' : 'text-white/80'
                  }`}
                >
                  <Camera className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">
                    {device.label || `Camera ${videoDevices.indexOf(device) + 1}`}
                  </span>
                  {device.label.toLowerCase().includes('obs') && (
                    <span className="ml-auto text-xs text-primary flex-shrink-0">Face Swap</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Screen Share */}
        <button
          onClick={toggleScreenShare}
          className="relative group flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white transition-all duration-200"
          title="Share Screen"
        >
          <span className="text-lg">🖥️</span>
          <span className="text-[10px] font-medium opacity-70">Share</span>
        </button>

        {/* Face Swap Share - Workaround for virtual camera issues */}
        <button
          onClick={shareFaceSwap}
          className="relative group flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 transition-all duration-200"
          title="Share Face Swap Window (Better than OBS Virtual Camera)"
        >
          <span className="text-lg">🎭</span>
          <span className="text-[10px] font-medium opacity-90">Face Swap</span>
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

        {/* Fraud Guard */}
        <button
          onClick={onToggleFraudDashboard}
          className={`relative group flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl transition-all duration-200 ${
            fraudDashboardOpen
              ? 'bg-primary/20 text-primary'
              : 'bg-white/10 hover:bg-white/15 text-white'
          }`}
          title="Fraud Guard"
        >
          <Shield className="w-5 h-5" />
          <span className="text-[10px] font-medium opacity-70">Guard</span>
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
