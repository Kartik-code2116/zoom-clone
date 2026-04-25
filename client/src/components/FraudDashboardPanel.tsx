import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useRemoteParticipants, useLocalParticipant } from '@livekit/components-react';
import {
  Shield, X, RefreshCw, Play, Pause, Users, AlertTriangle,
  Activity, ChevronRight, ExternalLink, Zap, Clock, Radio,
  CheckCircle, Brain,
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
  mlProbabilities?: { real: number; fake: number };
  mlFeatures?: {
    total_blinks: number;
    blink_rate: number;
    avg_ear: number;
    ear_variance: number;
    yaw_variance: number;
    pitch_variance: number;
  };
  frameMetrics?: { ear: number; blink_detected: boolean; yaw?: number; pitch?: number };
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

// FIX: returns a fixed colour string instead of a dynamic Tailwind class
// Dynamic classes like bg-${color}-400 are purged by Tailwind in production.
function riskColour(level: 'safe' | 'warning' | 'danger'): {
  bg: string; text: string; border: string; barBg: string;
} {
  if (level === 'danger')  return { bg: 'rgba(239,68,68,0.08)',  text: '#ef4444', border: 'rgba(239,68,68,0.3)',  barBg: '#ef4444' };
  if (level === 'warning') return { bg: 'rgba(234,179,8,0.08)',  text: '#eab308', border: 'rgba(234,179,8,0.3)',  barBg: '#eab308' };
  return                          { bg: 'rgba(16,185,129,0.08)', text: '#10b981', border: 'rgba(16,185,129,0.3)', barBg: '#10b981' };
}

function trustColour(score: number): string {
  if (score >= 70) return '#10b981';
  if (score >= 40) return '#eab308';
  return '#ef4444';
}

const FraudDashboardPanel: React.FC<FraudDashboardPanelProps> = ({
  meetingId, isOpen, onClose, onToggle, width = 384, onWidthChange,
}) => {
  const navigate = useNavigate();
  const [logs, setLogs]               = useState<DeepfakeLogItem[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const remoteParticipants    = useRemoteParticipants();
  const { localParticipant }  = useLocalParticipant();
  const totalLiveParticipants = remoteParticipants.length + 1;
  const [lastUpdateTime, setLastUpdateTime] = useState<Date>(new Date());

  // Resizable panel
  const [panelWidth, setPanelWidth] = useState(width);
  const [isResizing, setIsResizing] = useState(false);
  const MIN_WIDTH = 280; const MAX_WIDTH = 600;

  useEffect(() => { setPanelWidth(width); }, [width]);

  useEffect(() => {
    const id = setInterval(() => setLastUpdateTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const handleResizeStart = (e: React.MouseEvent) => { e.preventDefault(); setIsResizing(true); };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const w = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - e.clientX));
      setPanelWidth(w);
      onWidthChange?.(w);
    };
    const onUp = () => { setIsResizing(false); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    if (isResizing) {
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
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

  useEffect(() => { if (isOpen) fetchLogs(); }, [meetingId, isOpen]);
  useEffect(() => {
    if (!isOpen || !autoRefresh) return;
    const id = setInterval(fetchLogs, 5000);
    return () => clearInterval(id);
  }, [isOpen, autoRefresh, meetingId]);

  const participantStatus: ParticipantStatus[] = useMemo(() => {
    const grouped = logs.reduce((acc, log) => {
      const pid = log.participantId || 'Unknown';
      acc[pid] = acc[pid] || [];
      acc[pid].push(log);
      return acc;
    }, {} as Record<string, DeepfakeLogItem[]>);

    return Object.entries(grouped).map(([participantId, pLogs]) => {
      const latest    = pLogs[pLogs.length - 1];
      const avgTrust  = pLogs.reduce((s, l) => s + l.trustScore, 0) / pLogs.length;
      const fakeCount = pLogs.filter(l => l.isLikelyFake || l.trustScore < 40).length;
      const isLive    = Date.now() - new Date(latest.createdAt).getTime() < 30000;
      return { participantId, latestLog: latest, logCount: pLogs.length, avgTrustScore: avgTrust, fakeDetections: fakeCount, isLive };
    }).sort((a, b) => b.avgTrustScore - a.avgTrustScore);
  }, [logs]);

  const summary = useMemo(() => {
    const minTrust = logs.length ? Math.min(...logs.map(l => l.trustScore)) : null;
    const avgTrust = logs.length ? logs.reduce((a, l) => a + l.trustScore, 0) / logs.length : null;
    const last = logs.at(-1) ?? null;
    const mlDetections = logs.filter(l => l.mlLabel?.toLowerCase() === 'fake').length;
    const mlFrames     = logs.filter(l => l.mlLabel).length;
    return { minTrust, avgTrust, last, mlDetections, mlFrames };
  }, [logs]);

  const chartData = useMemo(() => logs.map(log => ({
    time:      new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    trust:     Math.round(log.trustScore),
    mlTrust:   log.mlProbabilities ? Math.round(log.mlProbabilities.real * 100) : null,
    mlFakeProb:log.mlProbabilities ? Math.round(log.mlProbabilities.fake * 100) : null,
  })), [logs]);

  const riskLevel = useMemo((): 'safe' | 'warning' | 'danger' => {
    const fakeCount = participantStatus.filter(p => p.latestLog.isLikelyFake || p.avgTrustScore < 40).length;
    if (fakeCount === 0) return 'safe';
    if (fakeCount === 1) return 'warning';
    return 'danger';
  }, [participantStatus]);

  const riskLabel  = { safe: 'All Clear', warning: 'Caution', danger: 'High Risk' }[riskLevel];
  const rc         = riskColour(riskLevel);

  return (
    <>
      {/* Mini widget when panel is closed */}
      {!isOpen && (
        <button onClick={onToggle}
          className="fixed top-4 right-4 z-50 flex items-center gap-2 bg-slate-900/90
                     backdrop-blur-md border border-slate-700/50 rounded-2xl px-4 py-2.5
                     shadow-2xl hover:bg-slate-800/90 transition-all duration-300 group">
          {/* FIX: inline style for dynamic dot colour — never purged */}
          <span className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ backgroundColor: rc.text }} />
          <div className="flex flex-col items-start">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Trust Score</span>
            <span className="text-sm font-bold" style={{ color: rc.text }}>
              {summary.avgTrust !== null ? Math.round(summary.avgTrust) : '--'}%
            </span>
          </div>
          <div className="w-8 h-8 bg-slate-800 rounded-xl flex items-center justify-center ml-1
                          group-hover:bg-slate-700 transition-colors">
            <Shield className="w-4 h-4 text-primary" />
          </div>
        </button>
      )}

      {/* Slide-in panel */}
      <div className={`fixed top-0 right-0 h-full z-50 transition-transform duration-500 ease-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ width: panelWidth }}>

        {/* Resize handle */}
        <div onMouseDown={handleResizeStart}
          className={`absolute left-0 top-0 bottom-0 w-4 cursor-ew-resize z-10 flex items-center
                      justify-center group ${isResizing ? 'bg-primary/20' : 'hover:bg-primary/10'}`}>
          <div className={`w-1 h-8 rounded-full transition-colors ${isResizing ? 'bg-primary' : 'bg-slate-600 group-hover:bg-primary'}`} />
        </div>

        <div className="h-full w-full bg-slate-950/95 backdrop-blur-xl border-l border-slate-800 shadow-2xl flex flex-col ml-4">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 border border-primary/20 rounded-xl flex items-center justify-center">
                <Brain className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-white">Fraud Guard</h2>
                <p className="text-xs text-slate-400">AI-Powered Detection</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setAutoRefresh(!autoRefresh)}
                className={`p-2 rounded-xl border transition-all ${autoRefresh
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'}`}
                title={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}>
                {autoRefresh ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              </button>
              <button onClick={fetchLogs}
                className="p-2 rounded-xl bg-slate-800 text-slate-400 border border-slate-700
                           hover:bg-slate-700 hover:text-white transition-all" title="Refresh">
                <RefreshCw className="w-4 h-4" />
              </button>
              <button onClick={onClose}
                className="p-2 rounded-xl bg-slate-800 text-slate-400 border border-slate-700
                           hover:bg-slate-700 hover:text-white transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">

            {loading && (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <div className="w-8 h-8 border-2 border-slate-700 border-t-primary rounded-full animate-spin mb-4" />
                <p className="text-sm">Loading detection data…</p>
              </div>
            )}

            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm flex items-center gap-3">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
              </div>
            )}

            {!loading && !error && logs.length === 0 && (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-slate-800/50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Activity className="w-8 h-8 text-slate-600" />
                </div>
                <p className="text-white font-medium mb-1">No detection data yet</p>
                <p className="text-slate-500 text-sm">Enable AI Guard in meeting settings to start monitoring</p>
              </div>
            )}

            {!loading && !error && logs.length > 0 && (
              <>
                {/* Live stats */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
                    <div className="flex items-center gap-2 mb-2">
                      <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                      <span className="text-xs text-slate-400">Live Participants</span>
                    </div>
                    <div className="text-2xl font-bold text-white">{totalLiveParticipants}</div>
                    <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                      {lastUpdateTime.toLocaleTimeString()}
                    </div>
                  </div>
                  <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="w-4 h-4 text-slate-400" />
                      <span className="text-xs text-slate-400">Tracked</span>
                    </div>
                    <div className="text-2xl font-bold text-white">{participantStatus.length}</div>
                    <div className="text-[10px] text-slate-500 mt-1">{logs.length} logs total</div>
                  </div>
                </div>

                {/* Overall status — FIX: inline styles, no dynamic class names */}
                <div className="p-4 rounded-2xl border" style={{ background: rc.bg, borderColor: rc.border }}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-slate-300">Overall Status</span>
                    <span className="px-3 py-1 rounded-full text-xs font-bold border"
                      style={{ background: rc.bg, color: rc.text, borderColor: rc.border }}>
                      {riskLabel}
                    </span>
                  </div>
                  <div className="flex items-end gap-2">
                    <span className="text-4xl font-bold" style={{ color: rc.text }}>
                      {summary.avgTrust !== null ? Math.round(summary.avgTrust) : '--'}
                    </span>
                    <span className="text-slate-400 mb-1">% avg trust</span>
                  </div>
                  <div className="mt-3 h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${summary.avgTrust || 0}%`, backgroundColor: rc.barBg }} />
                  </div>
                </div>

                {/* Participant cards — FIX: all colours via inline style */}
                <div>
                  <p className="text-sm text-slate-400 flex items-center gap-2 mb-3">
                    <Users className="w-4 h-4" />
                    Participant Analysis ({participantStatus.length})
                  </p>
                  <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                    {participantStatus.map((participant) => {
                      const tc = trustColour(participant.avgTrustScore);
                      const isSuspicious = participant.latestLog.isLikelyFake || participant.avgTrustScore < 40;
                      return (
                        <div key={participant.participantId}
                          className="p-4 rounded-xl border transition-all"
                          style={{
                            background: isSuspicious ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.02)',
                            borderColor: isSuspicious ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.08)',
                          }}>
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full"
                                style={{ backgroundColor: participant.isLive ? '#10b981' : '#64748b',
                                         animation: participant.isLive ? 'pulse 2s infinite' : 'none' }} />
                              <span className="text-sm font-medium text-white truncate max-w-[130px]">
                                {participant.participantId}
                              </span>
                            </div>
                            <span className="text-xs font-bold px-2 py-1 rounded-lg"
                              style={{
                                background: participant.latestLog.mlLabel?.toLowerCase() === 'fake'
                                  ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)',
                                color: participant.latestLog.mlLabel?.toLowerCase() === 'fake' ? '#ef4444' : '#10b981',
                              }}>
                              {participant.latestLog.mlLabel?.toUpperCase() || 'PENDING'}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-slate-500 block mb-0.5">Avg Trust</span>
                              <span className="font-semibold" style={{ color: tc }}>
                                {Math.round(participant.avgTrustScore)}%
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500 block mb-0.5">ML Confidence</span>
                              <span className="text-slate-300">
                                {participant.latestLog.mlConfidence
                                  ? `${(participant.latestLog.mlConfidence * 100).toFixed(0)}%` : '--'}
                              </span>
                            </div>
                          </div>
                          {participant.fakeDetections > 0 && (
                            <div className="mt-2 text-xs text-red-400 flex items-center gap-1.5">
                              <AlertTriangle className="w-3 h-3" />
                              {participant.fakeDetections} suspicious frame{participant.fakeDetections !== 1 ? 's' : ''}
                            </div>
                          )}
                          {participant.latestLog.mlProbabilities && (
                            <div className="mt-2 flex gap-3 text-xs pt-2 border-t border-slate-800">
                              <span style={{ color: '#10b981' }}>
                                Real: {(participant.latestLog.mlProbabilities.real * 100).toFixed(0)}%
                              </span>
                              <span className="text-slate-600">|</span>
                              <span style={{ color: '#ef4444' }}>
                                Fake: {(participant.latestLog.mlProbabilities.fake * 100).toFixed(0)}%
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
                    <p className="text-xs text-slate-500 mb-1">Min Trust</p>
                    <p className="text-2xl font-bold" style={{ color: trustColour(summary.minTrust ?? 100) }}>
                      {summary.minTrust !== null ? Math.round(summary.minTrust) : '--'}
                    </p>
                  </div>
                  <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
                    <p className="text-xs text-slate-500 mb-1">Suspicious</p>
                    <p className="text-2xl font-bold" style={{
                      color: participantStatus.filter(p => p.latestLog.isLikelyFake).length === 0
                        ? '#10b981' : '#ef4444'
                    }}>
                      {participantStatus.filter(p => p.latestLog.isLikelyFake).length}
                    </p>
                  </div>
                </div>

                {/* ML stats */}
                {summary.mlFrames > 0 && (
                  <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Zap className="w-4 h-4 text-primary" />
                      <p className="text-sm font-medium text-primary">SecureMeet AI Model</p>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Fake detections</span>
                      <span className="font-bold" style={{ color: summary.mlDetections > 0 ? '#ef4444' : '#10b981' }}>
                        {summary.mlDetections} / {summary.mlFrames} frames
                      </span>
                    </div>
                  </div>
                )}

                {/* Chart */}
                <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
                  <p className="text-sm text-slate-400 mb-3 flex items-center gap-2">
                    <Activity className="w-4 h-4" /> Trust Score History
                  </p>
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="time" hide />
                        <YAxis domain={[0, 100]} hide />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px' }}
                          labelStyle={{ color: '#64748b', fontSize: '11px' }}
                          itemStyle={{ fontSize: '11px' }}
                        />
                        <Line type="monotone" dataKey="trust" stroke="#10b981" strokeWidth={2} dot={false} name="Trust" />
                        {summary.mlFrames > 0 && (
                          <Line type="monotone" dataKey="mlTrust" stroke="#6366f1" strokeWidth={1.5}
                            dot={false} strokeDasharray="4 4" name="ML Real %" />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* FIX: Correct URL — was /fraud-dashboard/:id, now /meeting/:id/fraud-dashboard */}
                <button
                  onClick={() => navigate(`/meeting/${meetingId}/fraud-dashboard`)}
                  className="w-full flex items-center justify-center gap-2 bg-slate-800
                             hover:bg-slate-700 text-white py-3 rounded-xl font-medium
                             transition-all border border-slate-700 group">
                  <ExternalLink className="w-4 h-4" />
                  View Full Fraud Dashboard
                  <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>

                {/* Recent logs */}
                <div>
                  <p className="text-sm text-slate-400 mb-3">Recent Detections</p>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {[...logs].reverse().slice(0, 10).map((log) => (
                      <div key={log._id}
                        className="p-3 rounded-xl text-xs border"
                        style={{
                          background: (log.isLikelyFake || log.trustScore < 40)
                            ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.02)',
                          borderColor: (log.isLikelyFake || log.trustScore < 40)
                            ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.06)',
                        }}>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-500">{new Date(log.createdAt).toLocaleTimeString()}</span>
                          <span className="font-bold" style={{ color: trustColour(log.trustScore) }}>
                            {Math.round(log.trustScore)}%
                          </span>
                        </div>
                        {log.mlLabel && (
                          <div className="mt-1" style={{
                            color: log.mlLabel.toLowerCase() === 'fake' ? '#ef4444' : '#10b981'
                          }}>
                            AI: {log.mlLabel.toUpperCase()}
                            {log.mlConfidence ? ` · ${(log.mlConfidence * 100).toFixed(0)}%` : ''}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile backdrop */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 sm:hidden" onClick={onClose} />
      )}
    </>
  );
};

export default FraudDashboardPanel;
