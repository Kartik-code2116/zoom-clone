import React from 'react';
import { useRemoteParticipants, useRoomContext } from '@livekit/components-react';

interface MeetingHeaderProps {
  meetingId: string;
  title?: string;
}

const MeetingHeader: React.FC<MeetingHeaderProps> = ({ meetingId, title }) => {
  const room = useRoomContext();
  const remoteParticipants = useRemoteParticipants();
  const isConnected = room.state === 'connected';

  const participantCount = remoteParticipants.length + 1;

  return (
    <header className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 sm:px-6 py-3 bg-gradient-to-b from-black/60 via-black/30 to-transparent pointer-events-none">
      <div className="flex items-center gap-3 pointer-events-auto">
        <div className="w-9 h-9 rounded-xl bg-primary/20 border border-primary/40 flex items-center justify-center shadow-lg shadow-primary/30">
          <span className="text-primary font-bold text-sm">DF</span>
        </div>
        <div className="flex flex-col">
          <span className="text-white font-semibold text-sm sm:text-base truncate max-w-[180px] sm:max-w-xs">
            {title || 'DeepFake Guard Meeting'}
          </span>
          <span className="text-[11px] text-white/50">
            ID: <span className="font-mono text-white/70">{meetingId}</span>
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 pointer-events-auto">
        {/* Connection quality */}
        <div className="flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 border border-white/10">
          <span
            className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-yellow-400'
            }`}
          />
          <span className="text-[11px] text-white/70">
            {isConnected ? 'Connected' : 'Connecting...'}
          </span>
        </div>

        {/* Participants pill */}
        <div className="hidden sm:flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 border border-white/10">
          <span className="text-xs">👥</span>
          <span className="text-[11px] text-white/70">{participantCount} in call</span>
        </div>
      </div>
    </header>
  );
};

export default MeetingHeader;

