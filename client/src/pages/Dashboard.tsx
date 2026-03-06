import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createMeeting, getMyMeetings, type Meeting } from '../services/api';
import { showSuccess, showError } from '../utils/toast';
import Navbar from '../components/Navbar';

const Dashboard: React.FC = () => {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchMeetings();
  }, []);

  const fetchMeetings = async () => {
    try {
      const data = await getMyMeetings();
      setMeetings(data.meetings);
    } catch {
      showError('Failed to fetch meetings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateMeeting = async () => {
    setIsCreating(true);
    try {
      const data = await createMeeting();
      const id = data.meeting.meetingId || data.meeting._id;
      showSuccess('Meeting created!');
      navigate(`/join/${id}`);
    } catch {
      showError('Failed to create meeting');
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinMeeting = () => {
    if (joinCode.trim()) {
      navigate(`/join/${joinCode.trim()}`);
    }
  };

  const copyMeetingLink = (meetingId: string) => {
    const link = `${window.location.origin}/join/${meetingId}`;
    navigator.clipboard.writeText(link);
    showSuccess('Link copied!');
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'active':
        return 'bg-green-500/15 text-green-400 border-green-500/20';
      case 'ended':
        return 'bg-white/5 text-white/40 border-white/10';
      default:
        return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20';
    }
  };

  return (
    <div className="min-h-screen bg-dark">
      <Navbar />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Action Section */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
          {/* New Meeting */}
          <div className="bg-darker border border-white/5 rounded-2xl p-6 hover:border-primary/20 transition-all duration-300">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                <span className="text-xl">➕</span>
              </div>
              <div>
                <h3 className="text-white font-semibold">New Meeting</h3>
                <p className="text-white/40 text-xs">Create and start a new meeting</p>
              </div>
            </div>
            <button
              onClick={handleCreateMeeting}
              disabled={isCreating}
              className="w-full bg-primary hover:bg-primary/90 disabled:bg-primary/50 text-white py-3 rounded-xl font-semibold transition-all duration-200 shadow-lg shadow-primary/20 hover:shadow-primary/30"
            >
              {isCreating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating...
                </span>
              ) : (
                'New Meeting'
              )}
            </button>
          </div>

          {/* Join Meeting */}
          <div className="bg-darker border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-all duration-300">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center">
                <span className="text-xl">🔗</span>
              </div>
              <div>
                <h3 className="text-white font-semibold">Join Meeting</h3>
                <p className="text-white/40 text-xs">Enter a code to join</p>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJoinMeeting()}
                placeholder="Enter meeting code"
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all duration-200 text-sm"
              />
              <button
                onClick={handleJoinMeeting}
                disabled={!joinCode.trim()}
                className="bg-white/10 hover:bg-white/15 disabled:opacity-30 text-white px-5 py-3 rounded-xl font-semibold transition-all duration-200 text-sm whitespace-nowrap"
              >
                Join
              </button>
            </div>
          </div>
        </div>

        {/* Meetings List */}
        <div>
          <h2 className="text-white font-bold text-xl mb-4 flex items-center gap-2">
            📋 <span>My Meetings</span>
          </h2>

          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="bg-darker border border-white/5 rounded-xl p-5 animate-pulse"
                >
                  <div className="flex items-center justify-between">
                    <div className="space-y-2">
                      <div className="h-4 w-48 bg-white/5 rounded" />
                      <div className="h-3 w-32 bg-white/5 rounded" />
                    </div>
                    <div className="h-8 w-20 bg-white/5 rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
          ) : meetings.length === 0 ? (
            <div className="bg-darker border border-white/5 rounded-2xl p-12 text-center">
              <span className="text-5xl mb-4 block">📭</span>
              <h3 className="text-white font-semibold text-lg mb-2">
                No meetings yet
              </h3>
              <p className="text-white/40 text-sm mb-6">
                Create your first meeting to get started
              </p>
              <button
                onClick={handleCreateMeeting}
                className="bg-primary hover:bg-primary/90 text-white px-6 py-2.5 rounded-xl font-medium transition-all duration-200 text-sm"
              >
                Create Meeting
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {meetings.map((meeting) => (
                <div
                  key={meeting._id}
                  className="bg-darker border border-white/5 rounded-xl p-4 sm:p-5 hover:border-white/10 transition-all duration-200 group"
                >
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <h4 className="text-white font-medium text-sm truncate">
                          {meeting.title || `Meeting ${meeting.meetingId}`}
                        </h4>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${getStatusColor(
                            meeting.status
                          )}`}
                        >
                          {meeting.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-white/30 text-xs">
                        <span className="font-mono">{meeting.meetingId}</span>
                        <span>•</span>
                        <span>{formatDate(meeting.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => copyMeetingLink(meeting.meetingId)}
                        className="text-white/40 hover:text-white hover:bg-white/10 px-3 py-2 rounded-lg transition-all duration-200 text-xs font-medium"
                        title="Copy link"
                      >
                        🔗 Copy
                      </button>
                      {meeting.status === 'active' && (
                        <button
                          onClick={() => navigate(`/join/${meeting.meetingId}`)}
                          className="bg-primary/10 hover:bg-primary/20 text-primary px-4 py-2 rounded-lg transition-all duration-200 text-xs font-semibold"
                        >
                          Join
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
