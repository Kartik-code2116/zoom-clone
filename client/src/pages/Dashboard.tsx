import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createMeeting, getMyMeetings, type Meeting } from '../services/api';
import api from '../services/api';
import { showSuccess, showError } from '../utils/toast';
import Navbar from '../components/Navbar';
import { 
  Video, 
  Plus, 
  LogIn, 
  Calendar, 
  Clock, 
  Users, 
  Copy, 
  ExternalLink, 
  MoreVertical,
  Shield,
  Activity,
  TrendingUp,
  Play,
  Search,
  Sparkles,
  X,
  FileText,
  Database,
  AlertTriangle,
  Eye,
  BarChart3,
  Camera
} from 'lucide-react';

interface MeetingStats {
  totalMeetings: number;
  activeMeetings: number;
  hostedMeetings: number;
  totalParticipants: number;
}

const Dashboard: React.FC = () => {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'ended'>('all');
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [showMeetingDetails, setShowMeetingDetails] = useState(false);
  const [meetingStats, setMeetingStats] = useState<{
    totalLogs: number;
    deepfakeDetections: number;
    avgTrustScore: number;
    minTrustScore: number;
    snapshotsWithEvidence: number;
    uniqueParticipants: string[];
    mlFramesAnalyzed: number;
  } | null>(null);
  const [meetingLogs, setMeetingLogs] = useState<any[]>([]);
  const [expandedSnapshot, setExpandedSnapshot] = useState<string | null>(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
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
      showSuccess('Meeting created successfully!');
      navigate(`/join/${id}`);
    } catch {
      showError('Failed to create meeting');
    } finally {
      setIsCreating(false);
    }
  };

  const fetchMeetingStats = async (meetingId: string) => {
    setLoadingStats(true);
    try {
      const { data } = await api.get<{ logs: any[] }>(`/deepfake/logs/${meetingId}`);
      const logs = data.logs || [];
      
      const stats = {
        totalLogs: logs.length,
        deepfakeDetections: logs.filter((l: any) => l.isLikelyFake || l.trustScore < 40).length,
        avgTrustScore: logs.length ? Math.round(logs.reduce((acc: number, l: any) => acc + l.trustScore, 0) / logs.length) : 0,
        minTrustScore: logs.length ? Math.min(...logs.map((l: any) => l.trustScore)) : 100,
        snapshotsWithEvidence: logs.filter((l: any) => l.snapshotJpegDataUrl).length,
        uniqueParticipants: [...new Set(logs.map((l: any) => l.participantId).filter(Boolean))] as string[],
        mlFramesAnalyzed: logs.filter((l: any) => l.mlLabel).length,
      };
      
      setMeetingStats(stats);
      setMeetingLogs(logs.filter((l: any) => l.snapshotJpegDataUrl).slice(0, 6));
    } catch (err) {
      setMeetingStats(null);
    } finally {
      setLoadingStats(false);
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
    showSuccess('Meeting link copied to clipboard!');
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return `Today at ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    } else if (diffDays === 1) {
      return `Yesterday at ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  };

  // Calculate stats
  const stats: MeetingStats = {
    totalMeetings: meetings.length,
    activeMeetings: meetings.filter(m => m.status === 'active').length,
    hostedMeetings: meetings.filter(m => m.hostId === 'user').length,
    totalParticipants: meetings.length * 3
  };

  // Filter meetings
  const filteredMeetings = meetings.filter(meeting => {
    const matchesSearch = (meeting.title || meeting.meetingId).toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterStatus === 'all' || meeting.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'active':
        return {
          color: 'text-emerald-400',
          bg: 'bg-emerald-500/10',
          border: 'border-emerald-500/20',
          label: 'Live',
          dot: 'bg-emerald-400'
        };
      case 'ended':
        return {
          color: 'text-slate-400',
          bg: 'bg-slate-500/10',
          border: 'border-slate-500/20',
          label: 'Ended',
          dot: 'bg-slate-400'
        };
      default:
        return {
          color: 'text-yellow-400',
          bg: 'bg-yellow-500/10',
          border: 'border-yellow-500/20',
          label: 'Scheduled',
          dot: 'bg-yellow-400'
        };
    }
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <Navbar />

      {/* Hero Section */}
      <div className="relative bg-gradient-to-br from-slate-900 via-slate-900 to-primary/5 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl sm:text-4xl font-bold text-white">
                  Welcome back
                </h1>
                <span className="px-3 py-1 bg-primary/10 border border-primary/30 rounded-full text-primary text-sm font-medium">
                  Pro Plan
                </span>
              </div>
              <p className="text-slate-400 text-lg">
                Manage your meetings and connect with your team
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleCreateMeeting}
                disabled={isCreating}
                className="group flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300 shadow-lg shadow-primary/25 hover:shadow-primary/40"
              >
                {isCreating ? (
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
                )}
                {isCreating ? 'Creating...' : 'New Meeting'}
              </button>
              
              <button
                onClick={() => navigate('/profile')}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300 border border-slate-700"
              >
                <Calendar className="w-5 h-5" />
                Schedule
              </button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-10">
            {[
              { 
                label: 'Total Meetings', 
                value: stats.totalMeetings, 
                icon: <Video className="w-5 h-5" />,
                color: 'from-blue-500/20 to-blue-600/10',
                textColor: 'text-blue-400'
              },
              { 
                label: 'Active Now', 
                value: stats.activeMeetings, 
                icon: <Activity className="w-5 h-5" />,
                color: 'from-emerald-500/20 to-emerald-600/10',
                textColor: 'text-emerald-400'
              },
              { 
                label: 'Hosted by You', 
                value: stats.hostedMeetings, 
                icon: <Users className="w-5 h-5" />,
                color: 'from-purple-500/20 to-purple-600/10',
                textColor: 'text-purple-400'
              },
              { 
                label: 'Participants', 
                value: stats.totalParticipants, 
                icon: <TrendingUp className="w-5 h-5" />,
                color: 'from-orange-500/20 to-orange-600/10',
                textColor: 'text-orange-400'
              },
            ].map((stat, index) => (
              <div 
                key={index} 
                className={`relative overflow-hidden p-5 rounded-2xl bg-gradient-to-br ${stat.color} border border-slate-800`}
              >
                <div className="relative z-10">
                  <div className={`${stat.textColor} mb-2`}>{stat.icon}</div>
                  <p className="text-2xl font-bold text-white">{stat.value}</p>
                  <p className="text-slate-400 text-sm">{stat.label}</p>
                </div>
                <div className="absolute -bottom-4 -right-4 w-20 h-20 bg-white/5 rounded-full blur-xl" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left Column */}
          <div className="lg:col-span-1 space-y-6">
            {/* Join Meeting Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                  <LogIn className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-white font-semibold">Join a Meeting</h3>
                  <p className="text-slate-400 text-sm">Enter meeting ID to join</p>
                </div>
              </div>
              <div className="space-y-3">
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoinMeeting()}
                  placeholder="Meeting ID or link"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all duration-200"
                />
                <button
                  onClick={handleJoinMeeting}
                  disabled={!joinCode.trim()}
                  className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-white py-3 rounded-xl font-semibold transition-all duration-200 border border-slate-700"
                >
                  <Play className="w-4 h-4" />
                  Join Meeting
                </button>
              </div>
            </div>

            {/* Pro Tip */}
            <div className="bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 rounded-2xl p-6">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-primary/20 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h4 className="text-white font-medium mb-1">Pro Tip</h4>
                  <p className="text-slate-400 text-sm">
                    Use our AI Deepfake Guard to ensure meeting security. Enable it from settings.
                  </p>
                </div>
              </div>
            </div>

            {/* Security Badge */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center">
                  <Shield className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-white font-semibold">Security Status</h3>
                  <p className="text-emerald-400 text-sm flex items-center gap-1">
                    <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                    Protected
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {[
                  'End-to-end encryption active',
                  'AI Deepfake detection enabled',
                  'Secure meeting links'
                ].map((item, index) => (
                  <div key={index} className="flex items-center gap-2 text-slate-400 text-sm">
                    <span className="text-emerald-400">✓</span>
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column - Meetings List */}
          <div className="lg:col-span-2">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  My Meetings
                  <span className="px-2 py-0.5 bg-slate-800 rounded-full text-slate-400 text-sm font-normal">
                    {filteredMeetings.length}
                  </span>
                </h2>
                <p className="text-slate-400 text-sm mt-1">
                  Manage and join your scheduled meetings
                </p>
              </div>

              <div className="flex gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search meetings..."
                    className="pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-primary/50 text-sm w-48"
                  />
                </div>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as any)}
                  className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-primary/50"
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="ended">Ended</option>
                </select>
              </div>
            </div>

            {/* Loading State */}
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="bg-slate-900 border border-slate-800 rounded-2xl p-6 animate-pulse"
                  >
                    <div className="flex items-center justify-between">
                      <div className="space-y-3 flex-1">
                        <div className="h-5 w-48 bg-slate-800 rounded" />
                        <div className="h-4 w-32 bg-slate-800 rounded" />
                      </div>
                      <div className="h-10 w-24 bg-slate-800 rounded-xl" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredMeetings.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center">
                <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-6">
                  {searchQuery ? (
                    <Search className="w-10 h-10 text-slate-600" />
                  ) : (
                    <Video className="w-10 h-10 text-slate-600" />
                  )}
                </div>
                <h3 className="text-white font-semibold text-xl mb-2">
                  {searchQuery ? 'No meetings found' : 'No meetings yet'}
                </h3>
                <p className="text-slate-400 mb-6 max-w-md mx-auto">
                  {searchQuery 
                    ? 'Try adjusting your search or filter to find what you are looking for.' 
                    : 'Create your first meeting to get started with video conferencing.'}
                </p>
                {!searchQuery && (
                  <button
                    onClick={handleCreateMeeting}
                    className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300"
                  >
                    <Plus className="w-5 h-5" />
                    Create Meeting
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredMeetings.map((meeting) => {
                  const status = getStatusConfig(meeting.status);
                  return (
                    <div
                      key={meeting._id}
                      className="group bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 hover:bg-slate-800/50 transition-all duration-300"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-primary/20 to-primary/5 rounded-xl flex items-center justify-center flex-shrink-0">
                          <Video className="w-6 h-6 text-primary" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1">
                            <h4 className="text-white font-semibold truncate">
                              {meeting.title || `Meeting ${meeting.meetingId}`}
                            </h4>
                            <span
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${status.bg} ${status.color} ${status.border} border`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${status.dot} ${meeting.status === 'active' && 'animate-pulse'}`} />
                              {status.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-slate-400 text-sm">
                            <span className="font-mono bg-slate-800 px-2 py-0.5 rounded">
                              {meeting.meetingId}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              {formatDate(meeting.createdAt)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => copyMeetingLink(meeting.meetingId)}
                            className="p-2.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-xl transition-all duration-200"
                            title="Copy meeting link"
                          >
                            <Copy className="w-5 h-5" />
                          </button>
                          
                          {meeting.status === 'active' ? (
                            <button
                              onClick={() => navigate(`/join/${meeting.meetingId}`)}
                              className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-white px-5 py-2.5 rounded-xl font-semibold transition-all duration-200"
                            >
                              <Play className="w-4 h-4" />
                              Join
                            </button>
                          ) : (
                            <button
                              onClick={() => navigate(`/join/${meeting.meetingId}`)}
                              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 px-5 py-2.5 rounded-xl font-semibold transition-all duration-200 border border-slate-700"
                            >
                              <ExternalLink className="w-4 h-4" />
                              View
                            </button>
                          )}
                          
                          <button 
                            onClick={() => { 
                              setSelectedMeeting(meeting); 
                              setShowMeetingDetails(true); 
                              setShowSnapshots(false);
                              fetchMeetingStats(meeting.meetingId);
                            }}
                            className="p-2.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-xl transition-all duration-200"
                            title="Meeting details"
                          >
                            <MoreVertical className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Meeting Details Modal */}
      {showMeetingDetails && selectedMeeting && (
        <div 
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowMeetingDetails(false)}
        >
          <div 
            className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">Meeting Details</h3>
              <button 
                onClick={() => setShowMeetingDetails(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {/* Stats Summary Cards */}
              {meetingStats && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-slate-800/50 rounded-xl">
                    <div className="flex items-center gap-2 mb-1">
                      <Eye className="w-4 h-4 text-primary" />
                      <span className="text-xs text-slate-400">AI Analysis</span>
                    </div>
                    <div className="text-lg font-bold text-white">{meetingStats.mlFramesAnalyzed}</div>
                    <div className="text-[10px] text-slate-500">frames analyzed</div>
                  </div>
                  
                  <div className={`p-3 rounded-xl ${meetingStats.deepfakeDetections > 0 ? 'bg-red-500/10 border border-red-500/20' : 'bg-emerald-500/10 border border-emerald-500/20'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className={`w-4 h-4 ${meetingStats.deepfakeDetections > 0 ? 'text-red-400' : 'text-emerald-400'}`} />
                      <span className="text-xs text-slate-400">Detections</span>
                    </div>
                    <div className={`text-lg font-bold ${meetingStats.deepfakeDetections > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {meetingStats.deepfakeDetections}
                    </div>
                    <div className="text-[10px] text-slate-500">deepfake alerts</div>
                  </div>
                  
                  <div 
                    className="p-3 bg-slate-800/50 rounded-xl cursor-pointer hover:bg-slate-700/50 transition-colors"
                    onClick={() => setShowSnapshots(true)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Camera className="w-4 h-4 text-blue-400" />
                      <span className="text-xs text-slate-400">Evidence</span>
                    </div>
                    <div className="text-lg font-bold text-white">{meetingStats.snapshotsWithEvidence}</div>
                    <div className="text-[10px] text-slate-500">snapshots captured</div>
                  </div>
                  
                  <div className="p-3 bg-slate-800/50 rounded-xl">
                    <div className="flex items-center gap-2 mb-1">
                      <BarChart3 className="w-4 h-4 text-purple-400" />
                      <span className="text-xs text-slate-400">Trust Score</span>
                    </div>
                    <div className="text-lg font-bold text-white">{meetingStats.avgTrustScore}%</div>
                    <div className="text-[10px] text-slate-500">avg (min: {meetingStats.minTrustScore}%)</div>
                  </div>
                </div>
              )}
              
              {loadingStats && (
                <div className="flex items-center justify-center py-4">
                  <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
              )}
              
              <div className="border-t border-slate-700 my-4" />
              
              {/* Snapshot Gallery - Animated */}
              {showSnapshots && meetingLogs.length > 0 && (
                <div 
                  className="space-y-3 animate-in fade-in slide-in-from-top-4 duration-500"
                  onDoubleClick={() => setShowSnapshots(false)}
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                      <Camera className="w-4 h-4 text-primary" />
                      Evidence Snapshots
                      <span className="text-[10px] text-slate-500 font-normal">(double-click to close)</span>
                    </h4>
                    <button 
                      onClick={() => setShowSnapshots(false)}
                      className="text-xs text-slate-500 hover:text-white transition-colors"
                    >
                      Hide
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {meetingLogs.map((log, idx) => (
                      <div 
                        key={idx} 
                        className="relative aspect-video rounded-lg overflow-hidden cursor-pointer group border border-slate-700 animate-in zoom-in duration-300"
                        style={{ animationDelay: `${idx * 100}ms` }}
                        onClick={() => setExpandedSnapshot(log.snapshotJpegDataUrl)}
                      >
                        <img 
                          src={log.snapshotJpegDataUrl} 
                          alt={`Evidence ${idx + 1}`}
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                          <span className="opacity-0 group-hover:opacity-100 text-white text-xs font-medium">
                            Click to expand
                          </span>
                        </div>
                        {log.isLikelyFake && (
                          <div className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" title="Deepfake detected" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {showSnapshots && meetingLogs.length === 0 && (
                <div className="p-4 bg-slate-800/50 rounded-xl text-center animate-in fade-in duration-300">
                  <p className="text-slate-400 text-sm">No snapshots available for this meeting.</p>
                  <p className="text-slate-500 text-xs mt-1">Deepfake Guard must be active during the meeting to capture evidence.</p>
                </div>
              )}
              
              <div className="border-t border-slate-700 my-4" />
              
              <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl">
                <Video className="w-5 h-5 text-primary" />
                <div>
                  <div className="text-xs text-slate-400">Meeting ID</div>
                  <div className="text-white font-mono">{selectedMeeting.meetingId}</div>
                </div>
              </div>
              
              <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl">
                <Calendar className="w-5 h-5 text-emerald-400" />
                <div>
                  <div className="text-xs text-slate-400">Created</div>
                  <div className="text-white">{formatDate(selectedMeeting.createdAt)}</div>
                </div>
              </div>
              
              <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl">
                <Shield className="w-5 h-5 text-blue-400" />
                <div>
                  <div className="text-xs text-slate-400">Status</div>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${selectedMeeting.status === 'active' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
                    <span className="text-white capitalize">{selectedMeeting.status}</span>
                  </div>
                </div>
              </div>
              
              {selectedMeeting.endedAt && (
                <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl">
                  <Clock className="w-5 h-5 text-orange-400" />
                  <div>
                    <div className="text-xs text-slate-400">Ended</div>
                    <div className="text-white">{formatDate(selectedMeeting.endedAt)}</div>
                  </div>
                </div>
              )}
              
              <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl">
                <Users className="w-5 h-5 text-orange-400" />
                <div>
                  <div className="text-xs text-slate-400">Participants Tracked</div>
                  <div className="text-white font-medium">
                    {meetingStats?.uniqueParticipants.length || 0} unique participant{meetingStats && meetingStats.uniqueParticipants.length !== 1 ? 's' : ''}
                  </div>
                  {meetingStats && meetingStats.uniqueParticipants.length > 0 && (
                    <div className="text-[10px] text-slate-500 mt-1">
                      {meetingStats.uniqueParticipants.slice(0, 3).join(', ')}
                      {meetingStats.uniqueParticipants.length > 3 && ` +${meetingStats.uniqueParticipants.length - 3} more`}
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl">
                <FileText className="w-5 h-5 text-yellow-400" />
                <div>
                  <div className="text-xs text-slate-400">Title</div>
                  <div className="text-white">{selectedMeeting.title || 'Untitled Meeting'}</div>
                </div>
              </div>
              
              <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl">
                <Database className="w-5 h-5 text-pink-400" />
                <div>
                  <div className="text-xs text-slate-400">Internal ID</div>
                  <div className="text-white font-mono text-xs truncate">{selectedMeeting._id}</div>
                </div>
              </div>
            </div>
            
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => { setShowMeetingDetails(false); navigate(`/join/${selectedMeeting.meetingId}`); }}
                className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white py-3 rounded-xl font-semibold transition-all"
              >
                <Play className="w-4 h-4" />
                {selectedMeeting.status === 'active' ? 'Join Meeting' : 'View Meeting'}
              </button>
              <button
                onClick={() => { copyMeetingLink(selectedMeeting.meetingId); setShowMeetingDetails(false); }}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-3 rounded-xl font-semibold transition-all border border-slate-700"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expanded Snapshot Modal */}
      {expandedSnapshot && (
        <div 
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setExpandedSnapshot(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img 
              src={expandedSnapshot} 
              alt="Evidence snapshot expanded"
              className="max-w-full max-h-[85vh] rounded-lg shadow-2xl"
            />
            <button
              onClick={() => setExpandedSnapshot(null)}
              className="absolute -top-10 right-0 text-white/70 hover:text-white text-sm flex items-center gap-1"
            >
              <span>Close</span>
              <span className="text-lg">×</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
