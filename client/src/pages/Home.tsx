import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';

const Home: React.FC = () => {
  const [meetingCode, setMeetingCode] = useState('');
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleStartMeeting = () => {
    if (user) {
      navigate('/dashboard');
    } else {
      navigate('/login');
    }
  };

  const handleJoinMeeting = () => {
    if (meetingCode.trim()) {
      navigate(`/join/${meetingCode.trim()}`);
    }
  };

  return (
    <div className="min-h-screen bg-dark">
      <Navbar />

      {/* Hero Section */}
      <main className="relative overflow-hidden">
        {/* Background gradients */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-purple-500/5" />
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-32">
          <div className="text-center max-w-4xl mx-auto">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 mb-8">
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
              <span className="text-primary text-sm font-medium">
                Free video conferencing for everyone
              </span>
            </div>

            {/* Title */}
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white leading-tight mb-6">
              Video calls for{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-purple-400">
                everyone
              </span>
            </h1>

            {/* Subtitle */}
            <p className="text-lg sm:text-xl text-white/50 max-w-2xl mx-auto mb-12 leading-relaxed">
              Connect with your team, friends, and family with crystal-clear video
              and audio. No downloads required — start or join a meeting in seconds.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
              <button
                onClick={handleStartMeeting}
                className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-white px-8 py-4 rounded-2xl font-semibold text-lg transition-all duration-200 shadow-xl shadow-primary/25 hover:shadow-primary/40 hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-3"
              >
                <span className="text-xl">📹</span>
                Start a Meeting
              </button>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:flex-initial">
                  <input
                    type="text"
                    value={meetingCode}
                    onChange={(e) => setMeetingCode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleJoinMeeting()}
                    placeholder="Enter meeting code"
                    className="w-full sm:w-64 bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white placeholder-white/30 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all duration-200 text-lg"
                  />
                </div>
                <button
                  onClick={handleJoinMeeting}
                  disabled={!meetingCode.trim()}
                  className="bg-white/10 hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed text-white px-6 py-4 rounded-2xl font-semibold text-lg transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] whitespace-nowrap"
                >
                  Join
                </button>
              </div>
            </div>

            {/* Feature Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-3xl mx-auto">
              <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-6 hover:bg-white/[0.05] hover:border-white/10 transition-all duration-300 group">
                <span className="text-3xl mb-3 block group-hover:scale-110 transition-transform duration-200">🔒</span>
                <h3 className="text-white font-semibold mb-1">Secure</h3>
                <p className="text-white/40 text-sm">
                  End-to-end encrypted meetings for your privacy
                </p>
              </div>
              <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-6 hover:bg-white/[0.05] hover:border-white/10 transition-all duration-300 group">
                <span className="text-3xl mb-3 block group-hover:scale-110 transition-transform duration-200">⚡</span>
                <h3 className="text-white font-semibold mb-1">Fast</h3>
                <p className="text-white/40 text-sm">
                  Low-latency connections powered by LiveKit
                </p>
              </div>
              <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-6 hover:bg-white/[0.05] hover:border-white/10 transition-all duration-300 group">
                <span className="text-3xl mb-3 block group-hover:scale-110 transition-transform duration-200">🎨</span>
                <h3 className="text-white font-semibold mb-1">Beautiful</h3>
                <p className="text-white/40 text-sm">
                  Modern UI with screen sharing and chat
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Home;
