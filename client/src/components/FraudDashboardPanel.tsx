import React, { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

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
}

const FraudDashboardPanel: React.FC<FraudDashboardPanelProps> = ({ meetingId, isOpen, onClose }) => {
  const [logs, setLogs] = useState<DeepfakeLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

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

  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-slate-900 border-l border-slate-700 shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-800">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            🛡️ Fraud Dashboard
          </h2>
          <p className="text-xs text-slate-400">Live deepfake detection monitoring</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`p-2 rounded-lg transition-colors ${autoRefresh ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}
            title={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          >
            {autoRefresh ? '⏵' : '⏸'}
          </button>
          <button
            onClick={fetchLogs}
            className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
            title="Refresh"
          >
            🔄
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && (
          <div className="flex items-center justify-center py-8 text-slate-400">
            <span className="w-5 h-5 border-2 border-slate-600 border-t-primary rounded-full animate-spin mr-2" />
            Loading...
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && logs.length === 0 && (
          <div className="text-center py-8 text-slate-500">
            <p className="text-4xl mb-2">📊</p>
            <p>No detection data yet</p>
            <p className="text-xs mt-1">Deepfake analysis will appear here</p>
          </div>
        )}

        {!loading && !error && logs.length > 0 && (
          <>
            {/* Participants Status Cards */}
            <div>
              <p className="text-xs text-slate-400 mb-2 flex items-center gap-2">
                👥 Participants ({participantStatus.length})
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-400">
                  {participantStatus.filter(p => p.isLive).length} active
                </span>
              </p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {participantStatus.map((participant) => (
                  <div
                    key={participant.participantId}
                    className={`p-3 rounded-lg border ${
                      participant.latestLog.isLikelyFake || participant.avgTrustScore < 40
                        ? 'bg-red-500/10 border-red-500/30'
                        : participant.avgTrustScore >= 70
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : 'bg-yellow-500/10 border-yellow-500/30'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${participant.isLive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                        <span className="text-sm font-medium text-white truncate max-w-[120px]">
                          {participant.participantId}
                        </span>
                      </div>
                      <span className={`text-xs font-bold px-2 py-1 rounded ${
                        participant.latestLog.mlLabel?.toLowerCase() === 'fake'
                          ? 'bg-red-500 text-white'
                          : participant.latestLog.mlLabel?.toLowerCase() === 'real'
                          ? 'bg-emerald-500 text-white'
                          : 'bg-slate-600 text-slate-300'
                      }`}>
                        {participant.latestLog.mlLabel?.toUpperCase() || 'PENDING'}
                      </span>
                    </div>
                    
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Trust Score:</span>
                      <span className={`font-semibold ${
                        participant.avgTrustScore >= 70 ? 'text-emerald-400' 
                        : participant.avgTrustScore >= 40 ? 'text-yellow-400' 
                        : 'text-red-400'
                      }`}>
                        {Math.round(participant.avgTrustScore)}%
                      </span>
                    </div>
                    
                    <div className="flex items-center justify-between text-xs mt-1">
                      <span className="text-slate-400">ML Confidence:</span>
                      <span className="text-slate-300">
                        {participant.latestLog.mlConfidence 
                          ? `${(participant.latestLog.mlConfidence * 100).toFixed(0)}%`
                          : '--'}
                      </span>
                    </div>
                    
                    {participant.fakeDetections > 0 && (
                      <div className="mt-2 text-[10px] text-red-400">
                        ⚠️ {participant.fakeDetections} suspicious frame{participant.fakeDetections > 1 ? 's' : ''} detected
                      </div>
                    )}
                    
                    {participant.latestLog.mlProbabilities && (
                      <div className="mt-2 flex gap-2 text-[10px]">
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

            {/* Overall Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400">Avg Trust Score</p>
                <p className={`text-2xl font-bold ${
                  summary.avgTrust && summary.avgTrust >= 70 ? 'text-emerald-400' 
                  : summary.avgTrust && summary.avgTrust >= 40 ? 'text-yellow-400' 
                  : 'text-red-400'
                }`}>
                  {summary.avgTrust !== null ? Math.round(summary.avgTrust) : '--'}
                </p>
              </div>
              <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                <p className="text-xs text-slate-400">Suspicious</p>
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
              <div className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-500/30 rounded-lg p-3">
                <p className="text-xs font-medium text-indigo-300 mb-2">🤖 ML Model Detections</p>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Fake detected:</span>
                  <span className={`font-semibold ${summary.mlDetections > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {summary.mlDetections} / {summary.mlFrames} frames
                  </span>
                </div>
              </div>
            )}

            {/* Trust Chart */}
            <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
              <p className="text-xs text-slate-400 mb-2">Trust Score History</p>
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="time" hide />
                    <YAxis domain={[0, 100]} hide />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                      labelStyle={{ color: '#94a3b8' }}
                    />
                    <Line type="monotone" dataKey="trust" stroke="#10b981" strokeWidth={2} dot={false} />
                    {summary.mlFrames > 0 && (
                      <Line type="monotone" dataKey="mlTrust" stroke="#6366f1" strokeWidth={2} dot={false} strokeDasharray="5 5" />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Recent Logs */}
            <div>
              <p className="text-xs text-slate-400 mb-2">Recent Detections</p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {logs.slice(-10).reverse().map((log) => (
                  <div
                    key={log._id}
                    className={`p-2 rounded-lg text-xs border ${
                      log.isLikelyFake || log.trustScore < 40
                        ? 'bg-red-500/10 border-red-500/30'
                        : 'bg-slate-800 border-slate-700'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <span className="text-slate-400">
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </span>
                      <span className={`font-semibold ${log.trustScore >= 70 ? 'text-emerald-400' : log.trustScore >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {Math.round(log.trustScore)}%
                      </span>
                    </div>
                    <div className="mt-1 text-slate-300">
                      {log.mlLabel && (
                        <span className={`mr-2 ${log.mlLabel === 'fake' ? 'text-red-400' : 'text-emerald-400'}`}>
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
  );
};

export default FraudDashboardPanel;
