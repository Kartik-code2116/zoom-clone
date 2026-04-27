import React, { useEffect, useRef, useState } from 'react';
import { Subtitles, X, Globe } from 'lucide-react';

interface Caption {
  id: number;
  speaker: string;
  text: string;
  interim: boolean;
}

interface LiveCaptionsProps {
  isEnabled: boolean;
  participantName: string;
  onClose: () => void;
}

const LANGUAGES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-IN', label: 'English (India)' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'es-ES', label: 'Spanish' },
  { code: 'fr-FR', label: 'French' },
  { code: 'de-DE', label: 'German' },
  { code: 'ja-JP', label: 'Japanese' },
  { code: 'zh-CN', label: 'Chinese (Simplified)' },
];

const LiveCaptions: React.FC<LiveCaptionsProps> = ({ isEnabled, participantName, onClose }) => {
  const [captions, setCaptions]     = useState<Caption[]>([]);
  const [language, setLanguage]     = useState('en-US');
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [isListening, setIsListening]  = useState(false);
  const [supported, setSupported]      = useState(true);
  const recognitionRef = useRef<any>(null);
  const captionEndRef  = useRef<HTMLDivElement>(null);
  const idRef          = useRef(0);

  useEffect(() => {
    captionEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [captions]);

  useEffect(() => {
    if (!isEnabled) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous      = true;
    recognition.interimResults  = true;
    recognition.lang            = language;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onend   = () => {
      setIsListening(false);
      // Auto-restart if still enabled
      if (isEnabled) {
        setTimeout(() => { try { recognition.start(); } catch {} }, 300);
      }
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let final   = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += t;
        else interim += t;
      }

      setCaptions(prev => {
        // Remove previous interim caption
        const withoutInterim = prev.filter(c => !c.interim);
        const next: Caption[] = [...withoutInterim];
        if (final.trim()) {
          next.push({ id: idRef.current++, speaker: participantName, text: final.trim(), interim: false });
        }
        if (interim.trim()) {
          next.push({ id: -1, speaker: participantName, text: interim.trim(), interim: true });
        }
        return next.slice(-20); // keep last 20 captions
      });
    };

    recognition.onerror = (e: any) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        setIsListening(false);
      }
    };

    try { recognition.start(); } catch {}

    return () => {
      try { recognition.stop(); } catch {}
    };
  }, [isEnabled, language, participantName]);

  if (!isEnabled) return null;

  return (
    <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-40 w-full max-w-2xl px-4 pointer-events-none">
      {/* Language picker (pointer-events-auto so it's clickable) */}
      <div className="pointer-events-auto flex justify-end mb-2 relative">
        <button
          onClick={() => setShowLangMenu(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-black/70 backdrop-blur text-white/70 hover:text-white
                     text-xs rounded-lg border border-white/10 transition-all"
        >
          <Globe className="w-3.5 h-3.5" />
          {LANGUAGES.find(l => l.code === language)?.label ?? language}
        </button>
        {showLangMenu && (
          <div className="absolute bottom-full right-0 mb-1 bg-surface-2 border border-white/10
                          rounded-xl overflow-hidden shadow-2xl z-50 min-w-44">
            {LANGUAGES.map(lang => (
              <button key={lang.code}
                onClick={() => { setLanguage(lang.code); setShowLangMenu(false); }}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-white/8 transition-colors
                            ${language === lang.code ? 'text-primary bg-primary/10' : 'text-white/80'}`}>
                {lang.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Caption bar */}
      <div className="bg-black/80 backdrop-blur-md rounded-2xl border border-white/10 p-4 pointer-events-auto">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Subtitles className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">Live Captions</span>
            {isListening && (
              <span className="flex items-center gap-1 text-xs text-green-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Listening
              </span>
            )}
            {!supported && (
              <span className="text-xs text-red-400">Not supported in this browser</span>
            )}
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="min-h-[60px] max-h-32 overflow-y-auto space-y-1">
          {captions.length === 0 && supported && (
            <p className="text-white/30 text-sm text-center py-2">Start speaking — captions will appear here</p>
          )}
          {captions.map((cap, i) => (
            <p key={cap.id === -1 ? `interim-${i}` : cap.id}
              className={`text-sm leading-relaxed ${cap.interim ? 'text-white/50 italic' : 'text-white'}`}>
              <span className="text-primary font-semibold mr-1.5">{cap.speaker}:</span>
              {cap.text}
            </p>
          ))}
          <div ref={captionEndRef} />
        </div>
      </div>
    </div>
  );
};

export default LiveCaptions;
