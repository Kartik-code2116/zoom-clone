import React from 'react';

interface FloatingReactionProps {
  emoji: string;
}

const FloatingReaction: React.FC<FloatingReactionProps> = ({ emoji }) => {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-end justify-center overflow-hidden z-20">
      <div className="animate-bounce-up text-5xl drop-shadow-xl select-none">{emoji}</div>
    </div>
  );
};

export default FloatingReaction;

