import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getMeeting, getMeetingToken, type Meeting } from '../services/api';
import { showError } from '../utils/toast';
import Navbar from '../components/Navbar';
import { Camera, ChevronDown } from 'lucide-react';

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880';

const JoinMeeting: React.FC = () => {
  const { meetingId } = useParams<{ meetingId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [displayName, setDisplayName] = useState(user?.name || '');
  const [isJoining, setIsJoining] = useState(false);
  const [meetingInfo, setMeetingInfo] = useState<Meeting | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [liveKitAvailable, setLiveKitAvailable] = useState<boolean | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Camera selection state
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [isDeviceMenuOpen, setIsDeviceMenuOpen] = useState(false);
  const [skipCamera, setSkipCamera] = useState(false);

  // Check LiveKit availability
  useEffect(() => {
    const checkLiveKit = async () => {
      try {
        // Try to check if LiveKit port is reachable
        const wsUrl = LIVEKIT_URL.replace('ws://', 'http://').replace('wss://', 'https://');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        
        await fetch(`${wsUrl}/`, { 
          method: 'GET',
          signal: controller.signal,
          mode: 'no-cors'
        });
        clearTimeout(timeout);
        setLiveKitAvailable(true);
      } catch {
        // If fetch fails, LiveKit is likely not running
        setLiveKitAvailable(false);
      }
    };
    
    checkLiveKit();
  }, []);

  // Fetch meeting info
  useEffect(() => {
    const fetchMeetingInfo = async () => {
      if (!meetingId) return;
      try {
        const data = await getMeeting(meetingId);
        setMeetingInfo(data);
      } catch {
        // Meeting info might not be available, that's okay
      } finally {
        setIsLoadingInfo(false);
      }
    };

    fetchMeetingInfo();
  }, [meetingId]);

  // Camera preview - fixed to properly handle initial load
  useEffect(() => {
    let mediaStream: MediaStream | null = null;
    let isActive = true;

    const startPreview = async () => {
      try {
        // First, enumerate available devices
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices.filter(d => d.kind === 'videoinput');
        
        if (!isActive) return;
        setDevices(videoDevices);

        // Determine which device to use
        let targetDeviceId = selectedDeviceId;
        
        // If no device selected yet, auto-select OBS or first device
        if (!targetDeviceId && videoDevices.length > 0) {
          const obsDevice = videoDevices.find(d => 
            d.label.toLowerCase().includes('obs') || 
            d.label.toLowerCase().includes('virtual')
          );
          const defaultDevice = obsDevice || videoDevices[0];
          targetDeviceId = defaultDevice.deviceId;
          setSelectedDeviceId(targetDeviceId);
        }

        // Stop any existing stream first (using ref to avoid dependency)
        const currentStream = stream;
        if (currentStream) {
          currentStream.getTracks().forEach(track => track.stop());
        }

        // Get constraints with selected device
        const constraints: MediaStreamConstraints = {
          video: targetDeviceId 
            ? { 
                deviceId: { ideal: targetDeviceId },
                width: { ideal: 640 },
                height: { ideal: 480 }
              }
            : { width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        };

        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (!isActive) {
          mediaStream.getTracks().forEach(track => track.stop());
          return;
        }
        
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        console.error('Failed to access camera:', err);
        // Camera not available - could be in use by face swap program
      }
    };

    startPreview();

    return () => {
      isActive = false;
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDeviceId]);

  // Sync video element with stream
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const handleJoin = async () => {
    if (!displayName.trim()) {
      showError('Please enter your display name');
      return;
    }

    if (!meetingId) {
      showError('Invalid meeting ID');
      return;
    }

    setIsJoining(true);

    try {
      const identity = user?.id || displayName.trim();
      const data = await getMeetingToken(meetingId, identity, displayName.trim());
      const token = data.token;

      // Stop camera preview
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      navigate(`/meeting/${meetingId}`, { state: { token, userName: displayName.trim(), skipCamera } });
    } catch {
      showError('Failed to join meeting. Please check the meeting code.');
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark">
      <Navbar />

      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-2xl">
          <div className="bg-darker border border-white/5 rounded-2xl overflow-hidden shadow-2xl">
            {/* Camera Preview */}
            <div className="relative aspect-video bg-black/50 flex items-center justify-center overflow-hidden">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform -scale-x-100"
              />
              {!stream && !skipCamera && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-darker/80">
                  <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-3">
                    <span className="text-4xl">�</span>
                  </div>
                  <p className="text-white/60 text-sm mb-2 font-medium">Camera is locked by face swap program</p>
                  <p className="text-white/40 text-xs mb-4 max-w-[240px] text-center">
                    OBS Virtual Camera can only be used by one app at a time
                  </p>
                  <div className="flex flex-col gap-2 items-center">
                    <button
                      onClick={() => {
                        // Retry camera access
                        const currentDevice = selectedDeviceId;
                        setSelectedDeviceId('');
                        setTimeout(() => setSelectedDeviceId(currentDevice || 'default'), 100);
                      }}
                      className="px-4 py-2 bg-primary/20 hover:bg-primary/30 text-primary text-sm rounded-lg border border-primary/30 transition-colors"
                    >
                      🔄 Retry (Stop face swap first)
                    </button>
                    <button
                      onClick={() => setSkipCamera(true)}
                      className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white/80 text-sm rounded-lg transition-colors"
                    >
                      📹 Join Without Camera
                    </button>
                  </div>
                  <p className="text-white/30 text-xs mt-3 max-w-[220px] text-center">
                    Tip: Join without camera, then click 🎭 Face Swap button in meeting
                  </p>
                </div>
              )}
              
              {skipCamera && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-darker/80">
                  <div className="w-20 h-20 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mb-3">
                    <span className="text-4xl">🎭</span>
                  </div>
                  <p className="text-white/60 text-sm mb-2">Ready to join without camera</p>
                  <p className="text-white/40 text-xs max-w-[220px] text-center">
                    Click 🎭 Face Swap button after joining to share your face swap window
                  </p>
                  <button
                    onClick={() => setSkipCamera(false)}
                    className="mt-3 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/50 text-xs rounded-lg transition-colors"
                  >
                    ← Back to retry camera
                  </button>
                </div>
              )}

              {/* Meeting ID badge */}
              <div className="absolute top-4 left-4 bg-darker/80 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-white/10">
                <p className="text-white/50 text-xs">Meeting</p>
                <p className="text-white font-mono text-sm">{meetingId}</p>
              </div>

              {/* Camera Selector */}
              {devices.length > 0 && (
                <div className="absolute bottom-4 left-4 right-4">
                  <div className="relative">
                    <button
                      onClick={() => setIsDeviceMenuOpen(!isDeviceMenuOpen)}
                      className="w-full bg-darker/90 backdrop-blur-sm border border-white/10 rounded-lg px-3 py-2 flex items-center justify-between hover:bg-darker transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Camera className="w-4 h-4 text-white/60" />
                        <span className="text-white/80 text-sm truncate">
                          {devices.find(d => d.deviceId === selectedDeviceId)?.label || 'Select Camera'}
                        </span>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-white/60 transition-transform ${isDeviceMenuOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isDeviceMenuOpen && (
                      <div className="absolute bottom-full left-0 right-0 mb-1 bg-darker border border-white/10 rounded-lg overflow-hidden shadow-xl max-h-48 overflow-y-auto">
                        {devices.map((device) => (
                          <button
                            key={device.deviceId}
                            onClick={() => {
                              setSelectedDeviceId(device.deviceId);
                              setIsDeviceMenuOpen(false);
                            }}
                            className={`w-full px-3 py-2 text-left text-sm hover:bg-white/5 transition-colors ${
                              selectedDeviceId === device.deviceId ? 'bg-primary/20 text-primary' : 'text-white/80'
                            }`}
                          >
                            {device.label || `Camera ${devices.indexOf(device) + 1}`}
                            {device.label.toLowerCase().includes('obs') && (
                              <span className="ml-2 text-xs text-primary">(Face Swap)</span>
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
                <div className="mb-5 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
                  <p className="text-yellow-200 text-sm font-medium">
                    ⚠️ Video server (LiveKit) is not running
                  </p>
                  <p className="text-yellow-200/70 text-xs mt-1">
                    The meeting will not connect. Start it with: docker compose up -d
                  </p>
                </div>
              )}

              {/* Meeting info */}
              {!isLoadingInfo && meetingInfo && (
                <div className="mb-5 p-3 bg-white/[0.02] border border-white/5 rounded-xl">
                  <p className="text-white/60 text-sm">
                    {meetingInfo.title || 'Meeting Room'}
                  </p>
                  {meetingInfo.status && (
                    <p className="text-xs text-white/30 mt-0.5">
                      Status: {meetingInfo.status}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="displayName"
                    className="block text-white/60 text-sm font-medium mb-2"
                  >
                    Your Display Name
                  </label>
                  <input
                    id="displayName"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                    placeholder="Enter your name"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all duration-200"
                    autoFocus
                  />
                </div>

                <button
                  onClick={handleJoin}
                  disabled={isJoining || !displayName.trim()}
                  className="w-full bg-primary hover:bg-primary/90 disabled:bg-primary/50 disabled:cursor-not-allowed text-white py-3.5 rounded-xl font-semibold text-lg transition-all duration-200 shadow-lg shadow-primary/20 hover:shadow-primary/30"
                >
                  {isJoining ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Joining...
                    </span>
                  ) : (
                    'Join Meeting'
                  )}
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
