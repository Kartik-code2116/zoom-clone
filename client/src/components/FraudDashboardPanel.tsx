import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { 
  useRemoteParticipants, 
  useLocalParticipant 
} from '@livekit/components-react';
import { 
  Shield, 
  X, 
  RefreshCw, 
  Play, 
  Pause, 
  Users, 
  AlertTriangle, 
  Activity,
  ChevronRight,
  ExternalLink,
  Zap,
  Clock,
  Radio
} from 'lucide-react';

type GazeDirection = 'center' | 'left' | 'right' | 'up' | 'down' | 'unknown';

interface DeepfakeLogItem {
  _id: string;
  meetingId: string;
  participantId?: string;
  trustScore: number;
  isLikelyFake: boolean;
  gazeDirection: GazeDirection;
  blinkRatePerMin: number;
  microMovementsScore: number;
  gazeShiftFrequency: number;
  snapshotJpegDataUrl?: string;
  hfLabel?: string;
  hfScore?: number;
  mlLabel?: string;
  mlConfidence?: number;
  mlProbabilities?: {
    real: number;
    fake: number;
  };
  mlFeatures?: {
    total_blinks: number;
    blink_rate: number;
    avg_ear: number;
    ear_variance: number;
    yaw_variance: number;
    pitch_variance: number;
  };
  frameMetrics?: {
    ear: number;
    blink_detected: boolean;
    yaw?: number;
    pitch?: number;
  };
  createdAt: string;
}

interface ParticipantStatus {
  participantId: string;
  latestLog: DeepfakeLogItem;
  logCount: number;
  avgTrustScore: number;
  fakeDetections: number;
  isLive: boolean;
}

interface FraudDashboardPanelProps {
  meetingId: string;
  isOpen: boolean;
  onClose: () => void;
  onToggle?: () => void;
  width?: number;
  onWidthChange?: (width: number) => void;
}

const FraudDashboardPanel: React.FC<FraudDashboardPanelProps> = ({ 
  meetingId, 
  isOpen, 
  onClose, 
  onToggle,
  width = 384,
  onWidthChange 
}) => {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<DeepfakeLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  
  // Real-time participant tracking from LiveKit
  const remoteParticipants = useRemoteParticipants();
  const { localParticipant } = useLocalParticipant();
  const totalLiveParticipants = remoteParticipants.length + 1;
  const [lastUpdateTime, setLastUpdateTime] = useState<Date>(new Date());
  
  // Resizable panel state
  const [panelWidth, setPanelWidth] = useState(width);
  const [isResizing, setIsResizing] = useState(false);
  const MIN_WIDTH = 280;
  const MAX_WIDTH = 600;

  // Update timestamp every second
  useEffect(() => {
    const interval = setInterval(() => {
      setLastUpdateTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Sync with parent width
  useEffect(() => {
    setPanelWidth(width);
  }, [width]);

  // Resize handlers
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = window.innerWidth - e.clientX;
      const clampedWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
      setPanelWidth(clampedWidth);
      onWidthChange?.(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, onWidthChange]);

  const fetchLogs = async () => {
    if (!meetingId) return;
    try {
      const { data } = await api.get<{ logs: DeepfakeLogItem[] }>(`/deepfake/logs/${meetingId}`);
      setLogs(data.logs || []);
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    fetchLogs();
  }, [meetingId, isOpen]);

  // Auto-refresh logs every 5 seconds when panel is open
  useEffect(() => {
    if (!isOpen || !autoRefresh) return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [isOpen, autoRefresh, meetingId]);

  // Group logs by participant
  const participantStatus: ParticipantStatus[] = useMemo(() => {
    const grouped = logs.reduce((acc, log) => {
      const pid = log.participantId || 'Unknown';
      if (!acc[pid]) {
        acc[pid] = [];
      }
      acc[pid].push(log);
      return acc;
    }, {} as Record<string, DeepfakeLogItem[]>);

    return Object.entries(grouped).map(([participantId, participantLogs]) => {
      const latest = participantLogs[participantLogs.length - 1];
      const avgTrust = participantLogs.reduce((sum, l) => sum + l.trustScore, 0) / participantLogs.length;
      const fakeCount = participantLogs.filter(l => l.isLikelyFake || l.trustScore < 40).length;
      
      // Check if participant is still active (last log within 30 seconds)
      const lastLogTime = new Date(latest.createdAt).getTime();
      const isLive = Date.now() - lastLogTime < 30000;

      return {
        participantId,
        latestLog: latest,
        logCount: participantLogs.length,
        avgTrustScore: avgTrust,
        fakeDetections: fakeCount,
        isLive
      };
    }).sort((a, b) => b.avgTrustScore - a.avgTrustScore);
  }, [logs]);

  const summary = useMemo(() => {
    const minTrust = logs.length ? Math.min(...logs.map((l) => l.trustScore)) : null;
    const avgTrust = logs.length
      ? logs.reduce((acc, l) => acc + l.trustScore, 0) / logs.length
      : null;
    const last = logs.length ? logs[logs.length - 1] : null;
    const hfDetections = logs.filter(l => l.hfLabel?.toLowerCase() === 'fake').length;
    const mlDetections = logs.filter(l => l.mlLabel?.toLowerCase() === 'fake').length;
    const mlFrames = logs.filter(l => l.mlLabel).length;
    return { minTrust, avgTrust, last, hfDetections, mlDetections, mlFrames };
  }, [logs]);

  const chartData = useMemo(() => {
    return logs.map((log) => ({
      time: new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      trust: Math.round(log.trustScore),
      mlTrust: log.mlProbabilities ? Math.round(log.mlProbabilities.real * 100) : null,
      mlFakeProb: log.mlProbabilities ? Math.round(log.mlProbabilities.fake * 100) : null,
      isFake: log.isLikelyFake
    }));
  }, [logs]);

  // Calculate overall risk level
  const riskLevel = useMemo(() => {
    const fakeCount = participantStatus.filter(p => p.latestLog.isLikelyFake || p.avgTrustScore < 40).length;
    if (fakeCount === 0) return { level: 'safe', color: 'emerald', text: 'All Clear' };
    if (fakeCount === 1) return { level: 'warning', color: 'yellow', text: 'Caution' };
    return { level: 'danger', color: 'red', text: 'High Risk' };
  }, [participantStatus]);

  return (
    <>
      {/* Mini Trust Score Widget - Always visible when dashboard is closed */}
      {!isOpen && (
        <button
          onClick={onToggle}
          className="fixed top-4 right-4 z-50 flex items-center gap-2 bg-slate-900/90 backdrop-blur-md border border-slate-700/50 rounded-2xl px-4 py-2.5 shadow-2xl hover:bg-slate-800/90 transition-all duration-300 group"
        >
          <div className={`w-2.5 h-2.5 rounded-full bg-${riskLevel.color}-400 animate-pulse`} />
          <div className="flex flex-col items-start">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Trust Score</span>
            <span className={`text-sm font-bold text-${riskLevel.color}-400`}>
              {summary.avgTrust !== null ? Math.round(summary.avgTrust) : '--'}%
            </span>
          </div>
          <div className="w-8 h-8 bg-slate-800 rounded-xl flex items-center justify-center ml-1 group-hover:bg-slate-700 transition-colors">
            <Shield className="w-4 h-4 text-primary" />
          </div>
        </button>
      )}

      {/* Slide-in Dashboard Panel */}
      <div 
        className={`fixed top-0 right-0 h-full z-50 transition-transform duration-500 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ width: panelWidth }}
      >
        {/* Resize Handle */}
        <div
          onMouseDown={handleResizeStart}
          className={`absolute left-0 top-0 bottom-0 w-4 cursor-ew-resize z-10 flex items-center justify-center group ${
            isResizing ? 'bg-primary/20' : 'hover:bg-primary/10'
          }`}
          title="Drag to resize"
        >
          <div className={`w-1 h-8 rounded-full transition-colors ${
            isResizing ? 'bg-primary' : 'bg-slate-600 group-hover:bg-primary'
          }`} />
        </div>

        <div className="h-full w-full bg-slate-950/95 backdrop-blur-xl border-l border-slate-800 shadow-2xl flex flex-col ml-4">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-primary/20 to-primary/5 rounded-xl flex items-center justify-center">
                <Shield className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Fraud Guard</h2>
                <p className="text-xs text-slate-400">AI-Powered Detection</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`p-2 rounded-xl transition-all duration-200 ${
                  autoRefresh 
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' 
                    : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'
                }`}
                title={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
              >
                {autoRefresh ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              </button>
              <button
                onClick={fetchLogs}
                className="p-2 rounded-xl bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white transition-all duration-200"
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-xl bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-white transition-all duration-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {loading && (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <div className="w-10 h-10 border-3 border-slate-700 border-t-primary rounded-full animate-spin mb-4" />
                <p className="text-sm">Loading detection data...</p>
              </div>
            )}

            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                {error}
              </div>
            )}

            {!loading && !error && logs.length === 0 && (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-slate-800/50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Activity className="w-8 h-8 text-slate-600" />
                </div>
                <p className="text-white font-medium mb-1">No detection data yet</p>
                <p className="text-slate-500 text-sm">Deepfake analysis will appear here once the meeting starts</p>
              </div>
            )}

            {!loading && !error && logs.length > 0 && (
              <>
                {/* Live Meeting Stats */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
                    <div className="flex items-center gap-2 mb-2">
                      <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                      <span className="text-xs text-slate-400">Live Participants</span>
                    </div>
                    <div className="flex items-end gap-2">
                      <span className="text-2xl font-bold text-white">{totalLiveParticipants}</span>
                      <span className="text-xs text-slate-500 mb-1">({remoteParticipants.length} remote)</span>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-[10px] text-slate-500">Last update: {lastUpdateTime.toLocaleTimeString()}</span>
                    </div>
                  </div>
                  
                  <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="w-4 h-4 text-slate-400" />
                      <span className="text-xs text-slate-400">Tracked Participants</span>
                    </div>
                    <div className="flex items-end gap-2">
                      <span className="text-2xl font-bold text-white">{participantStatus.length}</span>
                      <span className="text-xs text-slate-500 mb-1">({participantStatus.filter(p => p.isLive).length} active)</span>
                    </div>
                    <div className="mt-2 text-[10px] text-slate-500">
                      From {logs.length} detection logs
                    </div>
                  </div>
                </div>

                {/* Overall Status Card */}
                <div className={`p-4 rounded-2xl border bg-gradient-to-br ${
                  riskLevel.level === 'safe' 
                    ? 'from-emerald-500/10 to-emerald-600/5 border-emerald-500/30' 
                    : riskLevel.level === 'warning'
                    ? 'from-yellow-500/10 to-yellow-600/5 border-yellow-500/30'
                    : 'from-red-500/10 to-red-600/5 border-red-500/30'
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-slate-300">Overall Status</span>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold bg-${riskLevel.color}-500/20 text-${riskLevel.color}-400 border border-${riskLevel.color}-500/30`}>
                      {riskLevel.text}
                    </span>
                  </div>
                  <div className="flex items-end gap-2">
                    <span className={`text-4xl font-bold text-${riskLevel.color}-400`}>
                      {summary.avgTrust !== null ? Math.round(summary.avgTrust) : '--'}
                    </span>
                    <span className="text-slate-400 mb-1">% avg trust</span>
                  </div>
                  <div className="mt-3 h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div 
                      className={`h-full bg-${riskLevel.color}-400 transition-all duration-500`}
                      style={{ width: `${summary.avgTrust || 0}%` }}
                    />
                  </div>
                </div>

                {/* Participants Status Cards */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm text-slate-400 flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Participant Analysis ({participantStatus.length})
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        {totalLiveParticipants} in meeting
                      </span>
                      <span className="text-[10px] px-2 py-1 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                        {participantStatus.filter(p => p.isLive).length} tracked
                      </span>
                    </div>
                  </div>
                  <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                    {participantStatus.map((participant) => (
                      <div
                        key={participant.participantId}
                        className={`p-4 rounded-xl border transition-all duration-200 ${
                          participant.latestLog.isLikelyFake || participant.avgTrustScore < 40
                            ? 'bg-red-500/5 border-red-500/20 hover:border-red-500/40'
                            : participant.avgTrustScore >= 70
                            ? 'bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40'
                            : 'bg-yellow-500/5 border-yellow-500/20 hover:border-yellow-500/40'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className={`w-2.5 h-2.5 rounded-full ${participant.isLive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                            <span className="text-sm font-medium text-white truncate max-w-[140px]">
                              {participant.participantId}
                            </span>
                          </div>
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
                            participant.latestLog.mlLabel?.toLowerCase() === 'fake'
                              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                              : participant.latestLog.mlLabel?.toLowerCase() === 'real'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-slate-700 text-slate-300 border border-slate-600'
                          }`}>
                            {participant.latestLog.mlLabel?.toUpperCase() || 'PENDING'}
                          </span>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <span className="text-slate-500 block mb-1">Trust Score</span>
                            <span className={`font-semibold ${
                              participant.avgTrustScore >= 70 ? 'text-emerald-400' 
                              : participant.avgTrustScore >= 40 ? 'text-yellow-400' 
                              : 'text-red-400'
                            }`}>
                              {Math.round(participant.avgTrustScore)}%
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block mb-1">ML Confidence</span>
                            <span className="text-slate-300">
                              {participant.latestLog.mlConfidence 
                                ? `${(participant.latestLog.mlConfidence * 100).toFixed(0)}%`
                                : '--'}
                            </span>
                          </div>
                        </div>
                        
                        {participant.fakeDetections > 0 && (
                          <div className="mt-3 text-xs text-red-400 flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            {participant.fakeDetections} suspicious frame{participant.fakeDetections > 1 ? 's' : ''} detected
                          </div>
                        )}
                        
                        {participant.latestLog.mlProbabilities && (
                          <div className="mt-3 flex gap-3 text-xs pt-3 border-t border-slate-800">
                            <span className="text-emerald-400">
                              Real: {(participant.latestLog.mlProbabilities.real * 100).toFixed(0)}%
                            </span>
                            <span className="text-slate-600">|</span>
                            <span className="text-red-400">
                              Fake: {(participant.latestLog.mlProbabilities.fake * 100).toFixed(0)}%
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
                    <p className="text-xs text-slate-500 mb-1">Min Trust Score</p>
                    <p className={`text-2xl font-bold ${
                      summary.minTrust && summary.minTrust >= 70 ? 'text-emerald-400' 
                      : summary.minTrust && summary.minTrust >= 40 ? 'text-yellow-400' 
                      : 'text-red-400'
                    }`}>
                      {summary.minTrust !== null ? Math.round(summary.minTrust) : '--'}
                    </p>
                  </div>
                  <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
                    <p className="text-xs text-slate-500 mb-1">Suspicious</p>
                    <p className={`text-2xl font-bold ${
                      participantStatus.filter(p => p.latestLog.isLikelyFake).length === 0 
                        ? 'text-emerald-400' 
                        : 'text-red-400'
                    }`}>
                      {participantStatus.filter(p => p.latestLog.isLikelyFake).length}
                    </p>
                  </div>
                </div>

                {/* ML Stats */}
                {summary.mlFrames > 0 && (
                  <div className="bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/30 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Zap className="w-4 h-4 text-primary" />
                      <p className="text-sm font-medium text-primary">AI Model Analysis</p>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-400">Fake detections</span>
                      <span className={`font-bold ${summary.mlDetections > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                        {summary.mlDetections} / {summary.mlFrames} frames
                      </span>
                    </div>
                  </div>
                )}

                {/* Trust Chart */}
                <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
                  <p className="text-sm text-slate-400 mb-3 flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Trust Score History
                  </p>
                  <div className="h-36">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="time" hide />
                        <YAxis domain={[0, 100]} hide />
                        <Tooltip
                          contentStyle={{ 
                            backgroundColor: '#0f172a', 
                            border: '1px solid #1e293b',
                            borderRadius: '8px',
                            padding: '8px 12px'
                          }}
                          labelStyle={{ color: '#64748b', fontSize: '12px' }}
                          itemStyle={{ fontSize: '12px' }}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="trust" 
                          stroke="#10b981" 
                          strokeWidth={2} 
                          dot={false}
                          activeDot={{ r: 4, fill: '#10b981' }}
                        />
                        {summary.mlFrames > 0 && (
                          <Line 
                            type="monotone" 
                            dataKey="mlTrust" 
                            stroke="#6366f1" 
                            strokeWidth={2} 
                            dot={false} 
                            strokeDasharray="5 5" 
                          />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* View Full Dashboard Button */}
                <button
                  onClick={() => navigate(`/fraud-dashboard/${meetingId}`)}
                  className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-medium transition-all duration-200 border border-slate-700 group"
                >
                  <ExternalLink className="w-4 h-4" />
                  View Full Fraud Dashboard
                  <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>

                {/* Recent Logs */}
                <div>
                  <p className="text-sm text-slate-400 mb-3">Recent Detections</p>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {logs.slice(-10).reverse().map((log) => (
                      <div
                        key={log._id}
                        className={`p-3 rounded-xl text-xs border ${
                          log.isLikelyFake || log.trustScore < 40
                            ? 'bg-red-500/5 border-red-500/20'
                            : 'bg-slate-900/50 border-slate-800'
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <span className="text-slate-500">
                            {new Date(log.createdAt).toLocaleTimeString()}
                          </span>
                          <span className={`font-bold ${
                            log.trustScore >= 70 ? 'text-emerald-400' 
                            : log.trustScore >= 40 ? 'text-yellow-400' 
                            : 'text-red-400'
                          }`}>
                            {Math.round(log.trustScore)}%
                          </span>
                        </div>
                        <div className="mt-1.5 flex gap-3">
                          {log.mlLabel && (
                            <span className={`${log.mlLabel === 'fake' ? 'text-red-400' : 'text-emerald-400'}`}>
                              ML: {log.mlLabel.toUpperCase()}
                            </span>
                          )}
                          {log.hfLabel && (
                            <span className={`${log.hfLabel === 'fake' ? 'text-red-400' : 'text-emerald-400'}`}>
                              HF: {log.hfLabel.toUpperCase()}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Backdrop for mobile */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 sm:hidden"
          onClick={onClose}
        />
      )}
    </>
  );
};

export default FraudDashboardPanel;
