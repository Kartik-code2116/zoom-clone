import React, { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import Navbar from '../components/Navbar';

const MeetingSummary: React.FC = () => {
  const { meetingId } = useParams<{ meetingId: string }>();
  const [duration, setDuration] = useState<string>('');

  useEffect(() => {
    // Calculate approximate duration from sessionStorage or just show a placeholder
    const joinTime = sessionStorage.getItem(`meeting_join_${meetingId}`);
    if (joinTime) {
      const elapsed = Math.floor((Date.now() - parseInt(joinTime, 10)) / 1000);
      const hrs = Math.floor(elapsed / 3600);
      const mins = Math.floor((elapsed % 3600) / 60);
      const secs = elapsed % 60;
      setDuration(
        `${hrs.toString().padStart(2, '0')}:${mins
          .toString()
          .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
      );
      sessionStorage.removeItem(`meeting_join_${meetingId}`);
    }
  }, [meetingId]);

  return (
    <div className="min-h-screen bg-dark">
      <Navbar />

      <div className="flex items-center justify-center px-4 py-20">
        <div className="w-full max-w-lg text-center">
          <div className="bg-darker border border-white/5 rounded-2xl p-10 shadow-2xl">
            {/* Icon */}
            <div className="w-20 h-20 bg-primary/10 border border-primary/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-4xl">✅</span>
            </div>

            {/* Title */}
            <h1 className="text-3xl font-bold text-white mb-3">Meeting Ended</h1>
            <p className="text-white/40 text-sm mb-8">
              Your meeting has ended successfully
            </p>

            {/* Duration */}
            {duration && (
              <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4 mb-8 inline-block">
                <p className="text-white/40 text-xs mb-1">Duration</p>
                <p className="text-white font-mono text-2xl tracking-wider">
                  {duration}
                </p>
              </div>
            )}

            {/* Meeting ID */}
            <div className="mb-8">
              <p className="text-white/30 text-xs">Meeting ID</p>
              <p className="text-white/60 font-mono text-sm">{meetingId}</p>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to="/dashboard"
                className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-white px-8 py-3 rounded-xl font-semibold transition-all duration-200 shadow-lg shadow-primary/20 hover:shadow-primary/30"
              >
                Back to Dashboard
              </Link>
              <Link
                to={`/join/${meetingId}`}
                className="w-full sm:w-auto bg-white/5 hover:bg-white/10 text-white/70 hover:text-white px-8 py-3 rounded-xl font-medium transition-all duration-200 border border-white/5 hover:border-white/10"
              >
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
