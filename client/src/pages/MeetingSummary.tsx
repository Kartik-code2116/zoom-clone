import React, { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { CheckCircle, Clock, Hash, RotateCcw, LayoutDashboard } from 'lucide-react';

const MeetingSummary: React.FC = () => {
  const { meetingId } = useParams<{ meetingId: string }>();
  const [duration, setDuration] = React.useState<string>('');

  useEffect(() => {
    const joinTime = sessionStorage.getItem(`meeting_join_${meetingId}`);
    if (joinTime) {
      const elapsed = Math.floor((Date.now() - parseInt(joinTime, 10)) / 1000);
      const hrs  = Math.floor(elapsed / 3600);
      const mins = Math.floor((elapsed % 3600) / 60);
      const secs = elapsed % 60;
      setDuration(
        `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
      );
      sessionStorage.removeItem(`meeting_join_${meetingId}`);
    }
  }, [meetingId]);

  return (
    <div className="min-h-screen bg-surface mesh-bg">
      <Navbar />

      <div className="flex items-center justify-center px-4 py-20 min-h-[calc(100vh-4rem)]">
        <div className="w-full max-w-lg text-center animate-in">
          <div className="glass-card p-10 shadow-2xl shadow-black/40">

            {/* Icon */}
            <div className="w-20 h-20 bg-success/10 border border-success/20 rounded-full
                            flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10 text-success" />
            </div>

            <h1 className="text-3xl font-bold text-white mb-2">Meeting Ended</h1>
            <p className="text-text-muted text-sm mb-8">
              Your meeting has ended successfully
            </p>

            {/* Duration */}
            {duration && (
              <div className="bg-white/5 border border-white/8 rounded-xl p-4 mb-6 inline-block">
                <div className="flex items-center gap-2 text-text-muted text-xs mb-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Duration</span>
                </div>
                <p className="text-white font-mono text-2xl tracking-wider">{duration}</p>
              </div>
            )}

            {/* Meeting ID */}
            <div className="flex items-center justify-center gap-2 mb-8 text-text-muted">
              <Hash className="w-3.5 h-3.5" />
              <span className="font-mono text-sm">{meetingId}</span>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link to="/dashboard"
                className="w-full sm:w-auto flex items-center justify-center gap-2
                           btn-primary px-8 py-3">
                <LayoutDashboard className="w-4 h-4" />
                Back to Dashboard
              </Link>
              <Link to={`/join/${meetingId}`}
                className="w-full sm:w-auto flex items-center justify-center gap-2
                           bg-white/5 hover:bg-white/10 text-white/70 hover:text-white
                           px-8 py-3 rounded-xl font-medium transition-all duration-200
                           border border-white/8 hover:border-white/15">
                <RotateCcw className="w-4 h-4" />
                Rejoin Meeting
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MeetingSummary;
