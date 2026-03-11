import React from 'react';

interface ReactionTrayProps {
  open: boolean;
  onSelect: (emoji: string) => void;
}

const reactions = ['👍', '👏', '😂', '😮', '❤️', '🙏'];

const ReactionTray: React.FC<ReactionTrayProps> = ({ open, onSelect }) => {
  if (!open) return null;

  return (
    <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-2 rounded-full bg-black/70 border border-white/10 shadow-xl">
      {reactions.map((emoji) => (
        <button
          key={emoji}
          onClick={() => onSelect(emoji)}
          className="text-xl hover:scale-125 transition-transform duration-150"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
};

export default ReactionTray;

