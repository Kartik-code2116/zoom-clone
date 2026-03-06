import React, { useState, useEffect, useCallback } from 'react';

const MeetingTimer: React.FC = () => {
  const [seconds, setSeconds] = useState<number>(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const formatTime = useCallback((totalSeconds: number): string => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return [
      hrs.toString().padStart(2, '0'),
      mins.toString().padStart(2, '0'),
      secs.toString().padStart(2, '0'),
    ].join(':');
  }, []);

  return (
    <div className="absolute top-4 right-4 z-40 flex items-center gap-2 bg-darker/80 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-white/10">
      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
      <span className="text-white/80 text-sm font-mono tracking-wider">
        {formatTime(seconds)}
      </span>
    </div>
  );
};

export default MeetingTimer;
