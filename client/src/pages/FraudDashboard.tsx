import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../services/api';
import Navbar from '../components/Navbar';
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
  // Custom ML Model fields
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

const FraudDashboard: React.FC = () => {
  const { meetingId } = useParams<{ meetingId: string }>();
  const navigate = useNavigate();
  const [logs, setLogs] = useState<DeepfakeLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSnapshot, setExpandedSnapshot] = useState<string | null>(null);

  useEffect(() => {
    async function fetchLogs() {
      if (!meetingId) return;
      setLoading(true);
      setError(null);
      try {
        const { data } = await api.get<{ logs: DeepfakeLogItem[] }>(`/deepfake/logs/${meetingId}`);
        setLogs(data.logs || []);
      } catch (err: any) {
        setError(err?.response?.data?.error || 'Failed to load logs');
      } finally {
        setLoading(false);
      }
    }
    fetchLogs();
  }, [meetingId]);

  const flagged = useMemo(() => logs.filter((l) => l.isLikelyFake || l.trustScore < 40), [logs]);

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

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify({ meetingId, logs }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deepfake-logs-${meetingId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const chartData = useMemo(() => {
    return logs.map((log) => ({
      time: new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      trust: Math.round(log.trustScore),
      mlTrust: log.mlProbabilities ? Math.round(log.mlProbabilities.real * 100) : null,
      mlFakeProb: log.mlProbabilities ? Math.round(log.mlProbabilities.fake * 100) : null,
      isFake: log.isLikelyFake
    }));
  }, [logs]);

  return (
    <div className="min-h-screen bg-dark">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">Fraud dashboard</h1>
            <p className="text-white/50 text-sm mt-1">
              Meeting ID: <span className="font-mono text-white/70">{meetingId}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(`/meeting/${meetingId}`)}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-medium transition-colors"
            >
              Back to meeting
            </button>
            <button
              onClick={downloadJson}
              className="px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-sm font-semibold transition-colors shadow-lg shadow-primary/20"
            >
              Export JSON
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-6">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs text-white/50">Total snapshots</div>
            <div className="text-2xl font-bold text-white mt-1">{logs.length}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 font-semibold text-red-400">
            <div className="text-xs text-white/50">AI Detections (ML)</div>
            <div className="text-2xl font-bold mt-1">{summary.mlDetections}</div>
            <div className="text-[10px] text-white/30">out of {summary.mlFrames} ML-analyzed frames</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs text-white/50">Flagged events</div>
            <div className="text-2xl font-bold text-white mt-1">{flagged.length}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs text-white/50">Min / Avg trust</div>
            <div className="text-white mt-1">
              <span className="text-2xl font-bold">{summary.minTrust !== null ? Math.round(summary.minTrust) : '--'}</span>
              <span className="text-white/30 mx-2">/</span>
              <span className="text-xl font-semibold text-white/80">{summary.avgTrust !== null ? Math.round(summary.avgTrust) : '--'}</span>
            </div>
          </div>
        </div>

        {/* Timeline Chart */}
        {logs.length > 0 && (
          <div className="mt-6 h-64 bg-white/[0.03] border border-white/10 rounded-2xl p-4">
            <h3 className="text-white/70 text-sm font-medium mb-4">Trust Score Timeline</h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff15" vertical={false} />
                  <XAxis dataKey="time" stroke="#ffffff50" fontSize={11} tickMargin={10} minTickGap={30} />
                  <YAxis stroke="#ffffff50" fontSize={11} domain={[0, 100]} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="trust" 
                    stroke="#10b981" 
                    name="Trust Score"
                    strokeWidth={2} 
                    dot={false} 
                    activeDot={{ r: 4 }} 
                  />
                  <Line 
                    type="monotone" 
                    dataKey="mlTrust" 
                    stroke="#3b82f6" 
                    name="ML Real Probability"
                    strokeWidth={1.5} 
                    strokeDasharray="3 3"
                    dot={false} 
                  />
                  <Line 
                    type="monotone" 
                    dataKey="mlFakeProb" 
                    stroke="#ef4444" 
                    name="ML Fake Probability"
                    strokeWidth={1.5} 
                    strokeDasharray="5 5"
                    dot={false} 
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Flagged list */}
        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-semibold text-lg">DeepFake detections</h2>
            {summary.last && (
              <span className="text-xs text-white/40">
                Last update: {new Date(summary.last.createdAt).toLocaleString()}
              </span>
            )}
          </div>

          {loading && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-white/60">
              Loading…
            </div>
          )}
          {error && (
            <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-red-200">
              {error}
            </div>
          )}

          {!loading && !error && flagged.length === 0 && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
              <div className="text-4xl mb-3">✅</div>
              <div className="text-white font-semibold">No deepfake detections</div>
              <div className="text-white/50 text-sm mt-1">
                If DeepFake Guard is enabled, events will appear here automatically.
              </div>
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            {flagged
              .slice()
              .reverse()
              .map((item) => (
                <div
                  key={item._id}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden"
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                    <div className="min-w-0">
                      <div className="text-white font-semibold text-sm truncate">
                        {item.participantId || 'Unknown participant'}
                      </div>
                      <div className="text-[11px] text-white/40">
                        {new Date(item.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-white/50">Trust</span>
                      <span
                        className={`text-xs font-bold px-2 py-1 rounded-full ${
                          item.trustScore > 50
                            ? 'bg-yellow-500/15 text-yellow-200 border border-yellow-500/20'
                            : 'bg-red-500/15 text-red-200 border border-red-500/20'
                        }`}
                      >
                        {Math.round(item.trustScore)}%
                      </span>
                    </div>
                  </div>

                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between text-white/70 text-xs">
                        <span>Gaze</span>
                        <span className="text-white/90 font-medium capitalize">{item.gazeDirection}</span>
                      </div>
                      <div className="flex items-center justify-between text-white/70 text-xs">
                        <span>Blink rate</span>
                        <span className="text-white/90 font-medium">{item.blinkRatePerMin.toFixed(1)} /min</span>
                      </div>
                      <div className="flex items-center justify-between text-white/70 text-xs">
                        <span>Micro-movements</span>
                        <span className="text-white/90 font-medium">{Math.round(item.microMovementsScore * 100)}%</span>
                      </div>
                      <div className="flex items-center justify-between text-white/70 text-xs">
                        <span>Gaze shifts</span>
                        <span className="text-white/90 font-medium">{item.gazeShiftFrequency.toFixed(2)} /s</span>
                      </div>
                      {item.mlLabel && (
                        <div className="flex items-center justify-between pt-1 mt-1 border-t border-white/5">
                          <span className="text-[10px] text-white/40 font-mono">ZPPM ML</span>
                          <div className="flex flex-col items-end">
                            <span className={`text-[11px] font-bold ${item.mlLabel?.toLowerCase() === 'real' ? 'text-emerald-400' : 'text-red-400'}`}>
                              {item.mlLabel.toUpperCase()} {item.mlConfidence ? `${(item.mlConfidence * 100).toFixed(0)}%` : ''}
                            </span>
                            {item.mlProbabilities && (
                              <span className="text-[9px] text-white/50">
                                R:{(item.mlProbabilities.real * 100).toFixed(0)}% F:{(item.mlProbabilities.fake * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                      {item.mlFeatures && (
                        <div className="mt-2 pt-2 border-t border-white/5">
                          <div className="text-[9px] text-white/40 font-mono mb-1">ML FEATURES</div>
                          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[9px] text-white/60">
                            <div>Blinks: {item.mlFeatures.total_blinks}</div>
                            <div>Rate: {item.mlFeatures.blink_rate.toFixed(1)}/min</div>
                            <div>EAR Var: {item.mlFeatures.ear_variance.toFixed(4)}</div>
                            <div>Yaw Var: {item.mlFeatures.yaw_variance.toFixed(2)}</div>
                          </div>
                        </div>
                      )}
                      <div className="pt-2">
                        <span className="inline-flex items-center text-[11px] px-2 py-1 rounded-full bg-red-500/10 text-red-200 border border-red-500/20">
                          DeepFake detected
                        </span>
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/30 overflow-hidden flex items-center justify-center min-h-40 cursor-pointer group relative"
                         onClick={() => item.snapshotJpegDataUrl && setExpandedSnapshot(item.snapshotJpegDataUrl)}>
                      {item.snapshotJpegDataUrl ? (
                        <>
                          <img
                            src={item.snapshotJpegDataUrl}
                            alt="Evidence snapshot"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                            <span className="opacity-0 group-hover:opacity-100 text-white text-sm font-medium px-3 py-1 bg-black/50 rounded-full">
                              Click to expand
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="text-white/40 text-xs px-4 text-center">
                          No snapshot available. Enable DeepFake Guard and allow logging to capture evidence images.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </section>

        {/* Expanded Snapshot Modal */}
        {expandedSnapshot && (
          <div 
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
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
      </main>
    </div>
  );
};

export default FraudDashboard;

