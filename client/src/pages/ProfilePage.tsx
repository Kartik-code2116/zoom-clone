import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api, { getMyMeetings, type Meeting, type User } from '../services/api';
import { showSuccess, showError } from '../utils/toast';
import Navbar from '../components/Navbar';
import { 
  User as UserIcon, 
  Mail, 
  Calendar, 
  Video, 
  Shield, 
  Edit2, 
  Save, 
  X,
  LogOut,
  Clock,
  Activity
} from 'lucide-react';

interface UserStats {
  totalMeetings: number;
  totalMinutes: number;
  hostedMeetings: number;
  joinedMeetings: number;
}

const ProfilePage: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(user?.name || '');
  const [isSaving, setIsSaving] = useState(false);
  const [stats, setStats] = useState<UserStats>({
    totalMeetings: 0,
    totalMinutes: 0,
    hostedMeetings: 0,
    joinedMeetings: 0
  });

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    fetchUserData();
  }, [user, navigate]);

  const fetchUserData = async () => {
    try {
      const data = await getMyMeetings();
      setMeetings(data.meetings);
      
      // Calculate stats
      const hosted = data.meetings.filter(m => m.hostId === user?.id || m.hostId === user?._id).length;
      const joined = data.meetings.length - hosted;
      
      setStats({
        totalMeetings: data.meetings.length,
        totalMinutes: data.meetings.length * 30, // Approximate
        hostedMeetings: hosted,
        joinedMeetings: joined
      });
    } catch {
      showError('Failed to fetch user data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateProfile = async () => {
    if (!editName.trim()) {
      showError('Name cannot be empty');
      return;
    }
    
    setIsSaving(true);
    try {
      await api.put('/auth/profile', { name: editName.trim() });
      showSuccess('Profile updated successfully');
      setIsEditing(false);
      // Refresh user data
      window.location.reload();
    } catch {
      showError('Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch {
      showError('Failed to logout');
    }
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <Navbar />
      
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">My Profile</h1>
          <p className="text-slate-400 mt-1">Manage your account and view your activity</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-2 border-slate-600 border-t-primary rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - User Info */}
            <div className="lg:col-span-1 space-y-6">
              {/* Profile Card */}
              <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
                <div className="flex flex-col items-center">
                  {/* Avatar */}
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-white text-3xl font-bold mb-4">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  
                  {isEditing ? (
                    <div className="w-full space-y-3">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-center focus:outline-none focus:border-primary"
                        placeholder="Your name"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleUpdateProfile}
                          disabled={isSaving}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors disabled:opacity-50"
                        >
                          {isSaving ? (
                            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          ) : (
                            <Save size={16} />
                          )}
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setIsEditing(false);
                            setEditName(user.name);
                          }}
                          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h2 className="text-xl font-semibold text-white">{user.name}</h2>
                      <p className="text-slate-400 text-sm">{user.email}</p>
                      <button
                        onClick={() => setIsEditing(true)}
                        className="mt-4 flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors text-sm"
                      >
                        <Edit2 size={14} />
                        Edit Profile
                      </button>
                    </>
                  )}
                </div>

                <div className="mt-6 pt-6 border-t border-slate-800 space-y-3">
                  <div className="flex items-center gap-3 text-slate-300">
                    <Calendar size={16} className="text-slate-500" />
                    <span className="text-sm">Joined {formatDate(user.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-300">
                    <Shield size={16} className="text-emerald-500" />
                    <span className="text-sm text-emerald-400">Account Active</span>
                  </div>
                </div>

                <button
                  onClick={handleLogout}
                  className="mt-6 w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg transition-colors"
                >
                  <LogOut size={16} />
                  Logout
                </button>
              </div>

              {/* Quick Actions */}
              <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">Quick Actions</h3>
                <div className="space-y-2">
                  <button
                    onClick={() => navigate('/dashboard')}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
                  >
                    <Video size={18} className="text-primary" />
                    <span>My Meetings</span>
                  </button>
                  <button
                    onClick={() => navigate('/join/test')}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
                  >
                    <Activity size={18} className="text-emerald-400" />
                    <span>Join Meeting</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Right Column - Stats & Activity */}
            <div className="lg:col-span-2 space-y-6">
              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center gap-2 text-slate-400 mb-2">
                    <Video size={16} />
                    <span className="text-xs uppercase tracking-wider">Meetings</span>
                  </div>
                  <p className="text-2xl font-bold text-white">{stats.totalMeetings}</p>
                  <p className="text-xs text-slate-500 mt-1">Total joined</p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center gap-2 text-slate-400 mb-2">
                    <Clock size={16} />
                    <span className="text-xs uppercase tracking-wider">Minutes</span>
                  </div>
                  <p className="text-2xl font-bold text-white">{stats.totalMinutes}+</p>
                  <p className="text-xs text-slate-500 mt-1">In meetings</p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center gap-2 text-slate-400 mb-2">
                    <UserIcon size={16} />
                    <span className="text-xs uppercase tracking-wider">Hosted</span>
                  </div>
                  <p className="text-2xl font-bold text-emerald-400">{stats.hostedMeetings}</p>
                  <p className="text-xs text-slate-500 mt-1">As host</p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center gap-2 text-slate-400 mb-2">
                    <Activity size={16} />
                    <span className="text-xs uppercase tracking-wider">Joined</span>
                  </div>
                  <p className="text-2xl font-bold text-primary">{stats.joinedMeetings}</p>
                  <p className="text-xs text-slate-500 mt-1">As participant</p>
                </div>
              </div>

              {/* Recent Meetings */}
              <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-white">Recent Meetings</h3>
                  <button
                    onClick={() => navigate('/dashboard')}
                    className="text-sm text-primary hover:text-primary/80 transition-colors"
                  >
                    View All
                  </button>
                </div>

                {meetings.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    <Video size={48} className="mx-auto mb-3 opacity-50" />
                    <p>No meetings yet</p>
                    <p className="text-sm mt-1">Join or create your first meeting</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {meetings.slice(0, 5).map((meeting) => (
                      <div
                        key={meeting._id}
                        onClick={() => navigate(`/join/${meeting.meetingId}`)}
                        className="flex items-center justify-between p-4 bg-slate-800/50 hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${meeting.status === 'active' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                          <div>
                            <p className="text-white font-medium">{meeting.title || `Meeting ${meeting.meetingId}`}</p>
                            <p className="text-sm text-slate-400">ID: {meeting.meetingId}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`px-2 py-1 rounded text-xs ${meeting.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                            {meeting.status === 'active' ? 'Active' : 'Ended'}
                          </span>
                          <p className="text-xs text-slate-500 mt-1">{formatDate(meeting.createdAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Account Info */}
              <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Account Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-800/50 rounded-lg">
                    <div className="flex items-center gap-2 text-slate-400 mb-2">
                      <UserIcon size={14} />
                      <span className="text-xs uppercase tracking-wider">User ID</span>
                    </div>
                    <p className="text-sm text-slate-300 font-mono">{user._id || user.id}</p>
                  </div>
                  <div className="p-4 bg-slate-800/50 rounded-lg">
                    <div className="flex items-center gap-2 text-slate-400 mb-2">
                      <Mail size={14} />
                      <span className="text-xs uppercase tracking-wider">Email</span>
                    </div>
                    <p className="text-sm text-slate-300">{user.email}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProfilePage;
