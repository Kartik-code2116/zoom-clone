import React from 'react';
import { useRemoteParticipants, useRoomContext } from '@livekit/components-react';
import { Users } from 'lucide-react';

interface MeetingHeaderProps {
  meetingId: string;
  title?: string;
}

const MeetingHeader: React.FC<MeetingHeaderProps> = ({ meetingId, title }) => {
  const room               = useRoomContext();
  const remoteParticipants = useRemoteParticipants();
  const isConnected        = room.state === 'connected';
  const participantCount   = remoteParticipants.length + 1;

  return (
    <header className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between
                       px-4 sm:px-6 py-3 bg-gradient-to-b from-black/60 via-black/30
                       to-transparent pointer-events-none">

      {/* Left — Logo + title */}
      <div className="flex items-center gap-3 pointer-events-auto">
        <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center
                        shadow-lg shadow-primary/30 flex-shrink-0">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor">
            <path d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4z"/>
            <polygon points="10,9 10,15 15,12" fill="white" opacity="0.9"/>
          </svg>
        </div>
        <div>
          <span className="text-white font-semibold text-sm sm:text-base truncate
                           max-w-[180px] sm:max-w-xs block">
            {title || 'SecureMeet'}
          </span>
          <span className="text-[11px] text-white/50">
            ID: <span className="font-mono text-white/70">{meetingId}</span>
          </span>
        </div>
      </div>

      {/* Right — Status pills */}
      <div className="flex items-center gap-2 pointer-events-auto">
        <div className="flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1
                        border border-white/10 backdrop-blur-sm">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-success animate-pulse' : 'bg-warning'}`} />
          <span className="text-[11px] text-white/70">
            {isConnected ? 'Connected' : 'Connecting…'}
          </span>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1
                        border border-white/10 backdrop-blur-sm">
          <Users className="w-3.5 h-3.5 text-white/50" />
          <span className="text-[11px] text-white/70">{participantCount} in call</span>
        </div>
      </div>
    </header>
  );
};

export default MeetingHeader;
