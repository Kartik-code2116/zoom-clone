import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../services/api';
import Navbar from '../components/Navbar';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from 'recharts';
import {
  Camera, AlertTriangle, BarChart3, Brain, Shield,
  Download, ArrowLeft, CheckCircle, Users, Clock,
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

// ── Custom tooltip for chart ──────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-2 border border-white/10 rounded-xl p-3 shadow-2xl text-xs">
      <p className="text-text-muted mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-white/70">{p.name}:</span>
          <span className="text-white font-semibold">{p.value ?? '—'}</span>
        </div>
      ))}
    </div>
  );
};

const FraudDashboard: React.FC = () => {
  const { meetingId } = useParams<{ meetingId: string }>();
  const navigate      = useNavigate();
  const [logs,     setLogs]     = useState<DeepfakeLogItem[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [expandedSnapshot, setExpandedSnapshot] = useState<string | null>(null);

  useEffect(() => {
    if (!meetingId) return;
    setLoading(true); setError(null);
    api.get<{ logs: DeepfakeLogItem[] }>(`/deepfake/logs/${meetingId}`)
      .then(({ data }) => setLogs(data.logs || []))
      .catch(err => setError(err?.response?.data?.error || 'Failed to load logs'))
      .finally(() => setLoading(false));
  }, [meetingId]);

  const flagged = useMemo(() => logs.filter(l => l.isLikelyFake || l.trustScore < 40), [logs]);

  const summary = useMemo(() => {
    const minTrust  = logs.length ? Math.min(...logs.map(l => l.trustScore)) : null;
    const avgTrust  = logs.length ? logs.reduce((a, l) => a + l.trustScore, 0) / logs.length : null;
    const last      = logs.at(-1) ?? null;
    const mlDetections = logs.filter(l => l.mlLabel?.toLowerCase() === 'fake').length;
    const mlFrames     = logs.filter(l => l.mlLabel).length;
    return { minTrust, avgTrust, last, mlDetections, mlFrames };
  }, [logs]);

  const chartData = useMemo(() => logs.map(log => ({
    time:       new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    trust:      Math.round(log.trustScore),
    mlReal:     log.mlProbabilities ? Math.round(log.mlProbabilities.real * 100) : null,
    mlFake:     log.mlProbabilities ? Math.round(log.mlProbabilities.fake * 100) : null,
  })), [logs]);

  // ── Export helpers ────────────────────────────────────────────────
  const downloadJson = () => {
    const blob = new Blob([JSON.stringify({ meetingId, logs }, null, 2)], { type: 'application/json' });
    const a    = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `deepfake-${meetingId}.json` });
    a.click(); URL.revokeObjectURL(a.href);
  };

  const downloadCsv = () => {
    const headers = ['Time', 'Participant', 'TrustScore', 'IsLikelyFake', 'MLLabel', 'MLConfidence%', 'Gaze', 'BlinkRate'];
    const rows    = logs.map(l => [
      new Date(l.createdAt).toLocaleString(),
      l.participantId ?? 'Unknown',
      Math.round(l.trustScore),
      l.isLikelyFake ? 'YES' : 'NO',
      l.mlLabel ?? '',
      l.mlConfidence ? (l.mlConfidence * 100).toFixed(0) : '',
      l.gazeDirection,
      l.blinkRatePerMin.toFixed(1),
    ]);
    const csv  = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a    = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `deepfake-${meetingId}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="min-h-screen bg-surface">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* ── Page header ──────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <button onClick={() => navigate(`/meeting/${meetingId}`)}
                className="p-2 rounded-lg bg-surface-2 hover:bg-surface-3 text-text-muted
                           hover:text-white transition-all border border-white/8">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="w-9 h-9 bg-primary/10 border border-primary/20 rounded-xl
                              flex items-center justify-center">
                <Brain className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white leading-tight">AI Fraud Dashboard</h1>
                <p className="text-text-muted text-sm">
                  Meeting <span className="font-mono text-white/70">{meetingId}</span>
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={downloadCsv}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-2 border border-white/8
                         hover:bg-surface-3 text-white text-sm font-medium transition-all">
              <Download className="w-4 h-4" />
              CSV
            </button>
            <button onClick={downloadJson}
              className="btn-primary !py-2.5 !px-5 !text-sm flex items-center gap-2">
              <Download className="w-4 h-4" />
              JSON
            </button>
          </div>
        </div>

        {/* ── Summary cards ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          {[
            {
              icon: <Camera className="w-5 h-5 text-blue-400" />,
              iconBg: 'bg-blue-500/10 border-blue-500/20',
              label: 'Total Logs',
              value: logs.length,
              sub: 'snapshots captured',
            },
            {
              icon: <AlertTriangle className="w-5 h-5 text-red-400" />,
              iconBg: 'bg-red-500/10 border-red-500/20',
              label: 'ML Detections',
              value: summary.mlDetections,
              sub: `of ${summary.mlFrames} ML frames`,
              highlight: summary.mlDetections > 0,
            },
            {
              icon: <Shield className="w-5 h-5 text-orange-400" />,
              iconBg: 'bg-orange-500/10 border-orange-500/20',
              label: 'Flagged Events',
              value: flagged.length,
              sub: 'trust score < 40%',
              highlight: flagged.length > 0,
            },
            {
              icon: <BarChart3 className="w-5 h-5 text-purple-400" />,
              iconBg: 'bg-purple-500/10 border-purple-500/20',
              label: 'Avg / Min Trust',
              value: summary.avgTrust !== null ? `${Math.round(summary.avgTrust)}%` : '—',
              sub: `min: ${summary.minTrust !== null ? Math.round(summary.minTrust) + '%' : '—'}`,
            },
            {
              icon: <Brain className="w-5 h-5 text-primary" />,
              iconBg: 'bg-primary/10 border-primary/20',
              label: 'Last ML Score',
              value: summary.last?.mlConfidence ? `${(summary.last.mlConfidence * 100).toFixed(0)}%` : '—',
              sub: summary.last?.mlLabel?.toUpperCase() ?? 'No ML data',
              valueColor: summary.last?.mlLabel?.toLowerCase() === 'real' ? '#10b981'
                        : summary.last?.mlLabel?.toLowerCase() === 'fake' ? '#ef4444' : undefined,
            },
          ].map((card, i) => (
            <div key={i}
              className={`rounded-2xl border p-5 transition-all
                          ${card.highlight
                            ? 'bg-red-500/5 border-red-500/20'
                            : 'bg-surface-2/60 border-white/8'}`}>
              <div className={`w-9 h-9 rounded-xl border flex items-center justify-center mb-3 ${card.iconBg}`}>
                {card.icon}
              </div>
              <div className="text-[11px] text-text-muted mb-1">{card.label}</div>
              <div className="text-2xl font-bold text-white mb-0.5"
                style={card.valueColor ? { color: card.valueColor } : undefined}>
                {card.value}
              </div>
              <div className="text-[10px] text-text-subtle">{card.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Trust score chart ─────────────────────────────────── */}
        {logs.length > 0 && (
          <div className="mb-8 bg-surface-2/60 border border-white/8 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-5">
              <BarChart3 className="w-5 h-5 text-primary" />
              <h2 className="text-base font-semibold text-white">Trust Score Timeline</h2>
              <div className="flex items-center gap-4 ml-auto text-[10px] text-text-muted">
                {[
                  { color: '#10b981', label: 'Trust Score' },
                  { color: '#3b82f6', label: 'ML Real %',  dashed: true },
                  { color: '#ef4444', label: 'ML Fake %',  dashed: true },
                ].map(({ color, label, dashed }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <div className="w-5 h-0.5" style={{ backgroundColor: color,
                      backgroundImage: dashed ? `repeating-linear-gradient(90deg, ${color} 0, ${color} 3px, transparent 3px, transparent 6px)` : undefined }} />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0f" vertical={false} />
                  <XAxis dataKey="time" stroke="#ffffff30" fontSize={10} tickMargin={8} minTickGap={40} />
                  <YAxis stroke="#ffffff30" fontSize={10} domain={[0, 100]} />
                  <Tooltip content={<ChartTooltip />} />
                  {/* Reference lines for danger/caution thresholds */}
                  <ReferenceLine y={40} stroke="#ef4444" strokeDasharray="5 3" strokeOpacity={0.5}
                    label={{ value: 'Danger  40%', position: 'insideTopRight', fontSize: 9, fill: '#ef4444', opacity: 0.7 }} />
                  <ReferenceLine y={70} stroke="#f59e0b" strokeDasharray="5 3" strokeOpacity={0.4}
                    label={{ value: 'Caution  70%', position: 'insideTopRight', fontSize: 9, fill: '#f59e0b', opacity: 0.6 }} />
                  <Line type="monotone" dataKey="trust"  stroke="#10b981" name="Trust Score"   strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="mlReal" stroke="#3b82f6" name="ML Real %"     strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                  <Line type="monotone" dataKey="mlFake" stroke="#ef4444" name="ML Fake %"     strokeWidth={1.5} strokeDasharray="6 3" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ── Detections list ───────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <h2 className="text-lg font-bold text-white">Deepfake Detections</h2>
              {flagged.length > 0 && (
                <span className="px-2.5 py-0.5 bg-red-500/15 border border-red-500/25 text-red-400
                                 text-xs font-semibold rounded-full">
                  {flagged.length} flagged
                </span>
              )}
            </div>
            {summary.last && (
              <div className="flex items-center gap-1.5 text-xs text-text-muted">
                <Clock className="w-3.5 h-3.5" />
                Last update: {new Date(summary.last.createdAt).toLocaleString()}
              </div>
            )}
          </div>

          {/* Loading */}
          {loading && (
            <div className="bg-surface-2/60 border border-white/8 rounded-2xl p-8 flex items-center gap-4">
              <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin flex-shrink-0" />
              <div>
                <p className="text-white font-medium">Loading AI analysis data…</p>
                <p className="text-text-muted text-sm mt-0.5">Fetching deepfake detection logs</p>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-6 text-red-300">
              <AlertTriangle className="w-5 h-5 mb-2" />
              {error}
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && flagged.length === 0 && (
            <div className="bg-surface-2/60 border border-white/8 rounded-2xl p-12 text-center">
              <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl
                              flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-emerald-400" />
              </div>
              <h3 className="text-white font-semibold text-lg mb-2">No deepfake detections</h3>
              <p className="text-text-muted text-sm max-w-sm mx-auto">
                {logs.length === 0
                  ? 'Enable AI Deepfake Guard during a meeting to start monitoring. Events will appear here automatically.'
                  : 'All participants verified as real. No suspicious activity detected.'}
              </p>
            </div>
          )}

          {/* Detection cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[...flagged].reverse().map(item => (
              <div key={item._id}
                className="bg-surface-2/60 border border-white/8 rounded-2xl overflow-hidden
                           hover:border-red-500/25 transition-all">

                {/* Card header */}
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/8">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-red-500/15 border border-red-500/25
                                    flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-white font-semibold text-sm truncate">
                        {item.participantId || 'Unknown participant'}
                      </p>
                      <p className="text-text-muted text-xs">{new Date(item.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border
                                     ${item.trustScore > 50
                                       ? 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20'
                                       : 'bg-red-500/10 text-red-300 border-red-500/20'}`}>
                      {Math.round(item.trustScore)}% trust
                    </span>
                  </div>
                </div>

                {/* Card body */}
                <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Metrics */}
                  <div className="space-y-2.5">
                    {[
                      { label: 'Gaze',           value: item.gazeDirection },
                      { label: 'Blink rate',      value: `${item.blinkRatePerMin.toFixed(1)} /min` },
                      { label: 'Micro-movements', value: `${Math.round(item.microMovementsScore * 100)}%` },
                      { label: 'Gaze shifts',     value: `${item.gazeShiftFrequency.toFixed(2)} /s` },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between text-xs">
                        <span className="text-text-muted capitalize">{label}</span>
                        <span className="text-white font-medium capitalize">{value}</span>
                      </div>
                    ))}

                    {item.mlLabel && (
                      <div className="pt-2 mt-1 border-t border-white/8">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] text-text-subtle font-mono uppercase tracking-wide">
                            SecureMeet AI
                          </span>
                          <span className={`text-xs font-bold ${
                            item.mlLabel.toLowerCase() === 'real' ? 'text-emerald-400' : 'text-red-400'}`}>
                            {item.mlLabel.toUpperCase()}
                            {item.mlConfidence ? ` · ${(item.mlConfidence * 100).toFixed(0)}%` : ''}
                          </span>
                        </div>
                        {item.mlProbabilities && (
                          <div className="space-y-1">
                            {[
                              { label: 'Real', val: item.mlProbabilities.real, color: '#10b981' },
                              { label: 'Fake', val: item.mlProbabilities.fake, color: '#ef4444' },
                            ].map(({ label, val, color }) => (
                              <div key={label} className="flex items-center gap-2">
                                <span className="text-[10px] w-5 text-text-subtle">{label}</span>
                                <div className="flex-1 h-1.5 bg-surface-3 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full"
                                    style={{ width: `${val * 100}%`, backgroundColor: color }} />
                                </div>
                                <span className="text-[10px] w-6 text-right" style={{ color }}>
                                  {(val * 100).toFixed(0)}%
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="pt-2">
                      <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1
                                       rounded-full bg-red-500/10 text-red-300 border border-red-500/20">
                        <AlertTriangle className="w-3 h-3" />
                        Deepfake detected
                      </span>
                    </div>
                  </div>

                  {/* Evidence snapshot */}
                  <div className="rounded-xl border border-white/8 bg-black/30 overflow-hidden
                                  flex items-center justify-center min-h-36 cursor-pointer group relative"
                    onClick={() => item.snapshotJpegDataUrl && setExpandedSnapshot(item.snapshotJpegDataUrl)}>
                    {item.snapshotJpegDataUrl ? (
                      <>
                        <img src={item.snapshotJpegDataUrl} alt="Evidence"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors
                                        flex items-center justify-center">
                          <span className="opacity-0 group-hover:opacity-100 text-white text-xs font-medium
                                           px-3 py-1.5 bg-black/60 rounded-full transition-opacity">
                            Expand
                          </span>
                        </div>
                        <div className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-2 p-4 text-center">
                        <Camera className="w-6 h-6 text-text-subtle" />
                        <p className="text-text-subtle text-xs">No snapshot</p>
                        <p className="text-text-subtle text-[10px]">Enable DeepFake Guard to capture evidence</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Expanded snapshot modal */}
      {expandedSnapshot && (
        <div className="fixed inset-0 z-50 bg-black/92 flex items-center justify-center p-4"
          onClick={() => setExpandedSnapshot(null)}>
          <div className="relative max-w-4xl max-h-[90vh]">
            <img src={expandedSnapshot} alt="Evidence expanded"
              className="max-w-full max-h-[85vh] rounded-xl shadow-2xl" />
            <button onClick={() => setExpandedSnapshot(null)}
              className="absolute -top-12 right-0 flex items-center gap-1.5
                         text-white/60 hover:text-white text-sm transition-colors">
              <span>Close</span>
              <span className="text-xl leading-none">×</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FraudDashboard;
