import React from 'react';
import {
  useRemoteParticipants,
  useLocalParticipant,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import type { RemoteParticipant } from 'livekit-client';

interface ParticipantPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const ParticipantPanel: React.FC<ParticipantPanelProps> = ({ isOpen, onClose }) => {
  const remoteParticipants = useRemoteParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();

  const totalCount = remoteParticipants.length + 1;

  const isParticipantMicEnabled = (participant: RemoteParticipant): boolean => {
    const micPub = participant.getTrackPublication(Track.Source.Microphone);
    return !!micPub && !micPub.isMuted;
  };

  const isParticipantCameraEnabled = (participant: RemoteParticipant): boolean => {
    const camPub = participant.getTrackPublication(Track.Source.Camera);
    return !!camPub && !camPub.isMuted;
  };

  return (
    <div
      className={`fixed top-0 right-0 h-full w-80 sm:w-96 bg-darker border-l border-white/10 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-dark">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
          👥{' '}
          <span>
            Participants{' '}
            <span className="text-white/40 font-normal">({totalCount})</span>
          </span>
        </h3>
        <button
          onClick={onClose}
          className="text-white/50 hover:text-white hover:bg-white/10 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200"
        >
          ✕
        </button>
      </div>

      {/* Participant List */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {/* Local participant (You) */}
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-primary/5 border border-primary/10">
          <div className="w-9 h-9 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
            <span className="text-primary text-xs font-bold uppercase">
              {localParticipant.name?.charAt(0) || localParticipant.identity?.charAt(0) || 'Y'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">
              {localParticipant.name || localParticipant.identity || 'You'}
              <span className="text-primary/60 text-xs ml-1.5">(You)</span>
            </p>
            <span className="inline-block text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-md font-medium mt-0.5">
              Host
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={`text-sm ${isMicrophoneEnabled ? 'opacity-60' : 'text-red-400'}`}
              title={isMicrophoneEnabled ? 'Mic on' : 'Mic off'}
            >
              {isMicrophoneEnabled ? '🎤' : '🔇'}
            </span>
            <span
              className={`text-sm ${isCameraEnabled ? 'opacity-60' : 'text-red-400'}`}
              title={isCameraEnabled ? 'Camera on' : 'Camera off'}
            >
              {isCameraEnabled ? '📹' : '📷'}
            </span>
          </div>
        </div>

        {/* Remote participants */}
        {remoteParticipants.map((participant) => {
          const micOn = isParticipantMicEnabled(participant);
          const camOn = isParticipantCameraEnabled(participant);

          return (
            <div
              key={participant.sid}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors duration-150"
            >
              <div className="w-9 h-9 rounded-full bg-white/10 border border-white/10 flex items-center justify-center shrink-0">
                <span className="text-white/70 text-xs font-bold uppercase">
                  {participant.name?.charAt(0) || participant.identity?.charAt(0) || '?'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white/90 text-sm font-medium truncate">
                  {participant.name || participant.identity || 'Participant'}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className={`text-sm ${micOn ? 'opacity-60' : 'text-red-400'}`}
                  title={micOn ? 'Mic on' : 'Mic off'}
                >
                  {micOn ? '🎤' : '🔇'}
                </span>
                <span
                  className={`text-sm ${camOn ? 'opacity-60' : 'text-red-400'}`}
                  title={camOn ? 'Camera on' : 'Camera off'}
                >
                  {camOn ? '📹' : '📷'}
                </span>
              </div>
            </div>
          );
        })}

        {remoteParticipants.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-white/30">
            <span className="text-3xl mb-2">🫥</span>
            <p className="text-sm">No other participants yet</p>
            <p className="text-xs mt-1">Share the meeting link to invite others</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ParticipantPanel;
