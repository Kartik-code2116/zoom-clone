import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getMeeting, getMeetingToken, type Meeting } from '../services/api';
import { showError } from '../utils/toast';
import Navbar from '../components/Navbar';

const JoinMeeting: React.FC = () => {
  const { meetingId } = useParams<{ meetingId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [displayName, setDisplayName] = useState(user?.name || '');
  const [isJoining, setIsJoining] = useState(false);
  const [meetingInfo, setMeetingInfo] = useState<Meeting | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

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

  // Camera preview
  useEffect(() => {
    let mediaStream: MediaStream | null = null;

    const startPreview = async () => {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch {
        // Camera not available
      }
    };

    startPreview();

    return () => {
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

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
      const data = await getMeetingToken(meetingId, displayName.trim(), displayName.trim());
      const token = data.token;

      // Stop camera preview
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      navigate(`/meeting/${meetingId}`, { state: { token, userName: displayName.trim() } });
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
              {!stream && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-darker/80">
                  <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-3">
                    <span className="text-4xl">📷</span>
                  </div>
                  <p className="text-white/40 text-sm">Camera preview unavailable</p>
                </div>
              )}

              {/* Meeting ID badge */}
              <div className="absolute top-4 left-4 bg-darker/80 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-white/10">
                <p className="text-white/50 text-xs">Meeting</p>
                <p className="text-white font-mono text-sm">{meetingId}</p>
              </div>
            </div>

            {/* Join Form */}
            <div className="p-6 sm:p-8">
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
