import React from 'react';

interface MeetingSettingsModalProps {
  open: boolean;
  onClose: () => void;
  deepfakeGuardEnabled: boolean;
  onToggleDeepfakeGuard: () => void;
  onOpenFraudDashboard: () => void;
}

const MeetingSettingsModal: React.FC<MeetingSettingsModalProps> = ({
  open,
  onClose,
  deepfakeGuardEnabled,
  onToggleDeepfakeGuard,
  onOpenFraudDashboard,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 text-white shadow-2xl border border-slate-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div>
            <h2 className="text-lg font-semibold">Meeting settings</h2>
            <p className="text-xs text-slate-400">
              Control safety, video and interaction options for this meeting.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-5 text-sm">
          {/* Fraud dashboard */}
          <section className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-medium">Fraud dashboard</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                View deepfake detections, trust score history, and evidence snapshots for investigation.
              </p>
            </div>
            <button
              onClick={onOpenFraudDashboard}
              className="shrink-0 px-3 py-2 rounded-xl bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary font-semibold text-xs transition-colors"
            >
              Open
            </button>
          </section>

          {/* DeepFake Guard - Enhanced Section */}
          <section className="rounded-xl bg-gradient-to-r from-slate-800/80 to-slate-900/80 border border-slate-600/50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-xl ${
                  deepfakeGuardEnabled 
                    ? 'bg-emerald-500/20 text-emerald-400' 
                    : 'bg-slate-700 text-slate-400'
                }`}>
                  🛡️
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-white">DeepFake Guard</h3>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      deepfakeGuardEnabled 
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                        : 'bg-slate-700 text-slate-400 border border-slate-600'
                    }`}>
                      {deepfakeGuardEnabled ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                    Analyzes your video for signs of artificial manipulation. Detects anomalies in gaze, 
                    blinks, and micro-movements to protect meeting authenticity.
                  </p>
                  <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      Local analysis only
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                      Privacy protected
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={onToggleDeepfakeGuard}
                className={`relative inline-flex h-7 w-12 items-center rounded-full border-2 transition-all shrink-0 ${
                  deepfakeGuardEnabled
                    ? 'bg-emerald-500 border-emerald-400'
                    : 'bg-slate-700 border-slate-500'
                }`}
                aria-pressed={deepfakeGuardEnabled}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform ${
                    deepfakeGuardEnabled ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </section>

          {/* Layout & view options (placeholder for future features) */}
          <section className="border-t border-slate-800 pt-4">
            <h3 className="font-medium mb-1.5">Layout & view</h3>
            <p className="text-xs text-slate-400 mb-2">
              Coming soon: switch between gallery view, speaker view and focus mode.
            </p>
            <div className="grid grid-cols-3 gap-2 opacity-60 pointer-events-none">
              <div className="rounded-xl border border-slate-700 bg-slate-800/80 px-2 py-2 text-center text-xs">
                Gallery
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-800/80 px-2 py-2 text-center text-xs">
                Speaker
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-800/80 px-2 py-2 text-center text-xs">
                Focus
              </div>
            </div>
          </section>

          {/* Advanced controls placeholder */}
          <section className="border-t border-slate-800 pt-4">
            <h3 className="font-medium mb-1.5">Advanced controls</h3>
            <ul className="text-xs text-slate-400 space-y-1.5 list-disc list-inside">
              <li>Mute on entry and host control for muting all participants.</li>
              <li>Recording and meeting transcription controls.</li>
              <li>Lobby / waiting room for extra security.</li>
            </ul>
          </section>
        </div>

        <div className="px-5 py-3 border-t border-slate-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default MeetingSettingsModal;

