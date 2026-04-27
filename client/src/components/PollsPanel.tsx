import React, { useState } from 'react';
import { X, Plus, ClipboardList, CheckCircle2, Trash2, Pin } from 'lucide-react';

interface PollOption {
  id: string;
  text: string;
  votes: number;
}

interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  myVote: string | null;
  active: boolean;
  createdBy: string;
}

interface PollsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  isHost?: boolean;
  userName: string;
  width?: number;
  onWidthChange?: (w: number) => void;
}

const PollsPanel: React.FC<PollsPanelProps> = ({
  isOpen, onClose, isHost = false, userName, width = 320, onWidthChange,
}) => {
  const [polls, setPolls] = useState<Poll[]>([
    {
      id: '1',
      question: 'Should we extend the meeting by 15 minutes?',
      options: [
        { id: 'a', text: 'Yes, definitely', votes: 3 },
        { id: 'b', text: 'No, wrap up now', votes: 1 },
        { id: 'c', text: 'Maybe 5 more minutes', votes: 2 },
      ],
      myVote: null,
      active: true,
      createdBy: 'Host',
    },
  ]);

  const [showCreate, setShowCreate]       = useState(false);
  const [newQuestion, setNewQuestion]     = useState('');
  const [newOptions, setNewOptions]       = useState(['', '']);
  const [isResizing, setIsResizing]       = useState(false);
  const [panelWidth, setPanelWidth]       = useState(width);
  const MIN_W = 280; const MAX_W = 600;

  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const w = Math.max(MIN_W, Math.min(MAX_W, window.innerWidth - e.clientX));
      setPanelWidth(w); onWidthChange?.(w);
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

  if (!isOpen) return null;

  const vote = (pollId: string, optionId: string) => {
    setPolls(prev => prev.map(p => {
      if (p.id !== pollId || p.myVote !== null || !p.active) return p;
      return {
        ...p,
        myVote: optionId,
        options: p.options.map(o => o.id === optionId ? { ...o, votes: o.votes + 1 } : o),
      };
    }));
  };

  const endPoll = (pollId: string) => {
    setPolls(prev => prev.map(p => p.id === pollId ? { ...p, active: false } : p));
  };

  const deletePoll = (pollId: string) => {
    setPolls(prev => prev.filter(p => p.id !== pollId));
  };

  const createPoll = () => {
    const opts = newOptions.filter(o => o.trim());
    if (!newQuestion.trim() || opts.length < 2) return;
    const newPoll: Poll = {
      id: Date.now().toString(),
      question: newQuestion.trim(),
      options: opts.map((text, i) => ({ id: String(i), text, votes: 0 })),
      myVote: null,
      active: true,
      createdBy: userName,
    };
    setPolls(prev => [...prev, newPoll]);
    setNewQuestion('');
    setNewOptions(['', '']);
    setShowCreate(false);
  };

  return (
    <div
      className="fixed top-0 right-0 h-full bg-surface-2 border-l border-white/10 z-50 flex flex-col shadow-2xl"
      style={{ width: panelWidth }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setIsResizing(true); }}
        className="absolute left-0 top-0 bottom-0 w-4 cursor-ew-resize z-20 flex items-center justify-center group hover:bg-primary/10"
      >
        <div className="w-1 h-8 rounded-full bg-slate-600 group-hover:bg-primary transition-colors" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 bg-surface-2 flex-shrink-0">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-primary" />
          Polls & Q&A
          <span className="text-white/40 font-normal">({polls.length})</span>
        </h3>
        <button onClick={onClose}
          className="text-white/50 hover:text-white hover:bg-white/8 w-8 h-8 rounded-lg flex items-center justify-center transition-all">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {polls.length === 0 && !showCreate && (
          <div className="flex flex-col items-center justify-center py-12 text-white/30 text-center">
            <ClipboardList className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm font-medium">No polls yet</p>
            {isHost && <p className="text-xs mt-1">Create a poll to engage participants</p>}
          </div>
        )}

        {polls.map(poll => {
          const total = poll.options.reduce((sum, o) => sum + o.votes, 0) || 1;
          const winner = [...poll.options].sort((a, b) => b.votes - a.votes)[0];
          return (
            <div key={poll.id}
              className={`bg-surface border rounded-xl p-4 ${poll.active ? 'border-white/10' : 'border-white/5 opacity-70'}`}>
              <div className="flex items-start justify-between gap-2 mb-3">
                <p className="text-white text-sm font-medium leading-snug">{poll.question}</p>
                {isHost && (
                  <div className="flex gap-1 flex-shrink-0">
                    {poll.active && (
                      <button onClick={() => endPoll(poll.id)}
                        title="End poll"
                        className="text-white/40 hover:text-red-400 transition-colors p-1 rounded">
                        <Pin className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button onClick={() => deletePoll(poll.id)}
                      title="Delete poll"
                      className="text-white/40 hover:text-red-400 transition-colors p-1 rounded">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {!poll.active && (
                <div className="text-xs text-white/40 mb-2 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Poll ended · {total} votes
                </div>
              )}

              <div className="space-y-2">
                {poll.options.map(opt => {
                  const pct = Math.round((opt.votes / total) * 100);
                  const isVoted = poll.myVote === opt.id;
                  const isWinner = !poll.active && opt.id === winner.id;
                  return (
                    <div key={opt.id}>
                      <button
                        onClick={() => vote(poll.id, opt.id)}
                        disabled={poll.myVote !== null || !poll.active}
                        className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all relative overflow-hidden
                          ${isVoted ? 'border border-primary/50 bg-primary/10 text-white' : ''}
                          ${isWinner ? 'border border-green-500/40 bg-green-500/10 text-white' : ''}
                          ${!isVoted && !isWinner ? 'border border-white/8 bg-white/4 text-white/80 hover:bg-white/8 hover:text-white' : ''}
                          ${(poll.myVote !== null || !poll.active) ? 'cursor-default' : 'cursor-pointer'}`}
                      >
                        {/* Progress bar behind */}
                        {poll.myVote !== null && (
                          <div
                            className={`absolute left-0 top-0 bottom-0 rounded-lg transition-all duration-700 ${isVoted ? 'bg-primary/20' : 'bg-white/5'}`}
                            style={{ width: `${pct}%` }}
                          />
                        )}
                        <div className="relative flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            {isVoted && <CheckCircle2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                            {isWinner && !isVoted && <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />}
                            {opt.text}
                          </span>
                          {poll.myVote !== null && (
                            <span className={`text-xs font-semibold ${isVoted ? 'text-primary' : 'text-white/40'}`}>
                              {pct}%
                            </span>
                          )}
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>

              {poll.myVote === null && poll.active && (
                <p className="text-xs text-white/30 mt-2 text-center">Click an option to vote</p>
              )}
              {poll.myVote !== null && poll.active && (
                <p className="text-xs text-primary/70 mt-2 text-center flex items-center justify-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> You voted · {total} total votes
                </p>
              )}
            </div>
          );
        })}

        {/* Create poll form */}
        {showCreate && isHost && (
          <div className="bg-surface border border-primary/20 rounded-xl p-4">
            <p className="text-white text-xs font-semibold uppercase tracking-wider mb-3 text-primary/80">New Poll</p>
            <textarea
              placeholder="Ask a question..."
              value={newQuestion}
              onChange={e => setNewQuestion(e.target.value)}
              rows={2}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm
                         placeholder-white/30 resize-none outline-none focus:border-primary/50 mb-3"
            />
            {newOptions.map((opt, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  placeholder={`Option ${i + 1}`}
                  value={opt}
                  onChange={e => setNewOptions(prev => prev.map((o, j) => j === i ? e.target.value : o))}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm
                             placeholder-white/30 outline-none focus:border-primary/50"
                />
                {newOptions.length > 2 && (
                  <button onClick={() => setNewOptions(prev => prev.filter((_, j) => j !== i))}
                    className="text-white/30 hover:text-red-400 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            {newOptions.length < 5 && (
              <button onClick={() => setNewOptions(prev => [...prev, ''])}
                className="text-primary/70 hover:text-primary text-xs flex items-center gap-1 mb-3 transition-colors">
                <Plus className="w-3.5 h-3.5" /> Add option
              </button>
            )}
            <div className="flex gap-2">
              <button onClick={createPoll}
                disabled={!newQuestion.trim() || newOptions.filter(o => o.trim()).length < 2}
                className="flex-1 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed
                           text-white text-sm font-semibold py-2 rounded-lg transition-all">
                Launch Poll
              </button>
              <button onClick={() => { setShowCreate(false); setNewQuestion(''); setNewOptions(['', '']); }}
                className="px-3 py-2 bg-white/8 hover:bg-white/12 text-white/60 hover:text-white text-sm rounded-lg transition-all">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer — host create button */}
      {isHost && !showCreate && (
        <div className="px-3 py-3 border-t border-white/8 flex-shrink-0">
          <button onClick={() => setShowCreate(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary/15 hover:bg-primary/25
                       text-primary text-sm font-medium rounded-xl border border-primary/20 transition-all">
            <Plus className="w-4 h-4" />
            Create Poll
          </button>
        </div>
      )}
    </div>
  );
};

export default PollsPanel;
