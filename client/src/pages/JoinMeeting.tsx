import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getMeeting, getMeetingToken, type Meeting } from '../services/api';
import { showError } from '../utils/toast';
import Navbar from '../components/Navbar';
import { Camera, ChevronDown, AlertTriangle, RefreshCw, VideoOff } from 'lucide-react';

// FIX: consistent fallback with Meeting.tsx — use cloud URL if env not set
const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || 'wss://zoom-clone-2jil3ca0.livekit.cloud';

const JoinMeeting: React.FC = () => {
  const { meetingId } = useParams<{ meetingId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [displayName, setDisplayName] = useState(user?.name || '');
  const [isJoining, setIsJoining]     = useState(false);
  const [meetingInfo, setMeetingInfo] = useState<Meeting | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(true);
  const [stream, setStream]           = useState<MediaStream | null>(null);
  const [liveKitAvailable, setLiveKitAvailable] = useState<boolean | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [devices, setDevices]           = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [isDeviceMenuOpen, setIsDeviceMenuOpen] = useState(false);
  const [skipCamera, setSkipCamera]     = useState(false);

  // Check LiveKit availability
  useEffect(() => {
    const checkLiveKit = async () => {
      try {
        const wsUrl = LIVEKIT_URL.replace('ws://', 'http://').replace('wss://', 'https://');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        await fetch(`${wsUrl}/`, { method: 'GET', signal: controller.signal, mode: 'no-cors' });
        clearTimeout(timeout);
        setLiveKitAvailable(true);
      } catch {
        setLiveKitAvailable(false);
      }
    };
    checkLiveKit();
  }, []);

  // Fetch meeting info
  useEffect(() => {
    if (!meetingId) return;
    getMeeting(meetingId)
      .then(data => setMeetingInfo(data))
      .catch(() => {})
      .finally(() => setIsLoadingInfo(false));
  }, [meetingId]);

  // Camera preview
  useEffect(() => {
    let mediaStream: MediaStream | null = null;
    let isActive = true;

    const startPreview = async () => {
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices.filter(d => d.kind === 'videoinput');
        if (!isActive) return;
        setDevices(videoDevices);

        let targetDeviceId = selectedDeviceId;
        if (!targetDeviceId && videoDevices.length > 0) {
          const obsDevice = videoDevices.find(d =>
            d.label.toLowerCase().includes('obs') || d.label.toLowerCase().includes('virtual')
          );
          targetDeviceId = (obsDevice || videoDevices[0]).deviceId;
          setSelectedDeviceId(targetDeviceId);
        }

        if (stream) stream.getTracks().forEach(t => t.stop());

        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: targetDeviceId
            ? { deviceId: { ideal: targetDeviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
            : { width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });

        if (!isActive) { mediaStream.getTracks().forEach(t => t.stop()); return; }
        setStream(mediaStream);
        if (videoRef.current) videoRef.current.srcObject = mediaStream;
      } catch {
        // Camera unavailable
      }
    };

    startPreview();
    return () => {
      isActive = false;
      mediaStream?.getTracks().forEach(t => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDeviceId]);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  const handleJoin = async () => {
    if (!displayName.trim()) { showError('Please enter your display name'); return; }
    if (!meetingId) { showError('Invalid meeting ID'); return; }
    setIsJoining(true);
    try {
      const identity = user?.id || displayName.trim();
      const data = await getMeetingToken(meetingId, identity, displayName.trim());
      stream?.getTracks().forEach(t => t.stop());
      navigate(`/meeting/${meetingId}`, { state: { token: data.token, userName: displayName.trim(), skipCamera } });
    } catch {
      showError('Failed to join meeting. Please check the meeting code.');
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface">
      <Navbar />

      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-2xl">
          <div className="bg-surface-2 border border-white/8 rounded-2xl overflow-hidden shadow-2xl">

            {/* Camera Preview */}
            <div className="relative aspect-video bg-black/50 flex items-center justify-center overflow-hidden">
              <video ref={videoRef} autoPlay playsInline muted
                className="w-full h-full object-cover transform -scale-x-100" />

              {/* No camera state */}
              {!stream && !skipCamera && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface/90">
                  <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10
                                  flex items-center justify-center mb-3">
                    <VideoOff className="w-8 h-8 text-white/40" />
                  </div>
                  <p className="text-white/60 text-sm mb-1 font-medium">Camera unavailable</p>
                  <p className="text-white/40 text-xs mb-4 max-w-xs text-center">
                    Camera may be in use by another app (e.g. OBS Virtual Camera)
                  </p>
                  <div className="flex flex-col gap-2 items-center">
                    <button
                      onClick={() => { const d = selectedDeviceId; setSelectedDeviceId(''); setTimeout(() => setSelectedDeviceId(d || 'default'), 100); }}
                      className="flex items-center gap-2 px-4 py-2 bg-primary/20 hover:bg-primary/30
                                 text-primary text-sm rounded-lg border border-primary/30 transition-colors">
                      <RefreshCw className="w-4 h-4" />
                      Retry Camera
                    </button>
                    <button onClick={() => setSkipCamera(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/15
                                 text-white/80 text-sm rounded-lg transition-colors">
                      <VideoOff className="w-4 h-4" />
                      Join Without Camera
                    </button>
                  </div>
                  <p className="text-white/30 text-xs mt-3 max-w-xs text-center">
                    Tip: Join without camera, then use Face Swap from the More menu in the meeting
                  </p>
                </div>
              )}

              {/* Skip camera state */}
              {skipCamera && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface/90">
                  <div className="w-20 h-20 rounded-full bg-primary/10 border border-primary/30
                                  flex items-center justify-center mb-3">
                    <Camera className="w-8 h-8 text-primary/60" />
                  </div>
                  <p className="text-white/60 text-sm mb-2">Ready to join without camera</p>
                  <p className="text-white/40 text-xs max-w-xs text-center">
                    You can enable camera or Face Swap after joining
                  </p>
                  <button onClick={() => setSkipCamera(false)}
                    className="mt-3 px-3 py-1.5 bg-white/5 hover:bg-white/10
                               text-white/50 text-xs rounded-lg transition-colors">
                    Back to retry camera
                  </button>
                </div>
              )}

              {/* Meeting ID badge */}
              <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-sm rounded-lg
                              px-3 py-1.5 border border-white/10">
                <p className="text-white/50 text-xs">Meeting</p>
                <p className="text-white font-mono text-sm">{meetingId}</p>
              </div>

              {/* Camera Selector */}
              {devices.length > 0 && (
                <div className="absolute bottom-4 left-4 right-4">
                  <div className="relative">
                    <button onClick={() => setIsDeviceMenuOpen(!isDeviceMenuOpen)}
                      className="w-full bg-black/70 backdrop-blur-sm border border-white/10 rounded-lg
                                 px-3 py-2 flex items-center justify-between hover:bg-black/80 transition-colors">
                      <div className="flex items-center gap-2">
                        <Camera className="w-4 h-4 text-white/60" />
                        <span className="text-white/80 text-sm truncate">
                          {devices.find(d => d.deviceId === selectedDeviceId)?.label || 'Select Camera'}
                        </span>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-white/60 transition-transform ${isDeviceMenuOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isDeviceMenuOpen && (
                      <div className="absolute bottom-full left-0 right-0 mb-1 bg-surface-2 border
                                      border-white/10 rounded-lg overflow-hidden shadow-xl max-h-48 overflow-y-auto">
                        {devices.map(device => (
                          <button key={device.deviceId}
                            onClick={() => { setSelectedDeviceId(device.deviceId); setIsDeviceMenuOpen(false); }}
                            className={`w-full px-3 py-2 text-left text-sm hover:bg-white/5 transition-colors ${
                              selectedDeviceId === device.deviceId ? 'bg-primary/20 text-primary' : 'text-white/80'}`}>
                            {device.label || `Camera ${devices.indexOf(device) + 1}`}
                            {device.label.toLowerCase().includes('obs') && (
                              <span className="ml-2 text-xs text-primary">(OBS / Face Swap)</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Join Form */}
            <div className="p-6 sm:p-8">
              {/* LiveKit Warning */}
              {liveKitAvailable === false && (
                <div className="mb-5 p-3 bg-warning/10 border border-warning/30 rounded-xl flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-warning text-sm font-medium">Video server (LiveKit) is not running</p>
                    <p className="text-warning/70 text-xs mt-0.5">
                      Start it with: <code className="bg-white/10 px-1 py-0.5 rounded">docker compose up -d</code>
                    </p>
                  </div>
                </div>
              )}

              {/* Meeting info */}
              {!isLoadingInfo && meetingInfo && (
                <div className="mb-5 p-3 bg-white/4 border border-white/6 rounded-xl">
                  <p className="text-white/70 text-sm font-medium">{meetingInfo.title || 'Meeting Room'}</p>
                  {meetingInfo.status && (
                    <p className="text-xs text-text-muted mt-0.5 capitalize">Status: {meetingInfo.status}</p>
                  )}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label htmlFor="displayName" className="block text-text-muted text-sm font-medium mb-2">
                    Your Display Name
                  </label>
                  <input
                    id="displayName" type="text" value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleJoin()}
                    placeholder="Enter your name"
                    className="input-base"
                    autoFocus
                  />
                </div>

                <button onClick={handleJoin} disabled={isJoining || !displayName.trim()}
                  className="btn-primary w-full">
                  {isJoining ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Joining…
                    </span>
                  ) : 'Join Meeting'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default JoinMeeting;
