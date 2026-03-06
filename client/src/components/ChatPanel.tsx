import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

interface ChatMessage {
  senderName: string;
  message: string;
  timestamp: string;
}

interface ChatPanelProps {
  meetingId: string;
  userName: string;
  isOpen: boolean;
  onClose: () => void;
  onNewMessage?: () => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ meetingId, userName, isOpen, onClose, onNewMessage }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const newSocket = io({
      transports: ['websocket', 'polling'],
    });

    newSocket.on('connect', () => {
      newSocket.emit('join-room', { meetingId, userName });
    });

    newSocket.on('receive-message', (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
      onNewMessage?.();
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [meetingId, userName, onNewMessage]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  const sendMessage = useCallback(() => {
    if (!inputValue.trim() || !socket) return;

    socket.emit('send-message', {
      meetingId,
      senderName: userName,
      message: inputValue.trim(),
    });
    setInputValue('');
  }, [inputValue, socket, meetingId, userName]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
          💬 <span>Meeting Chat</span>
        </h3>
        <button
          onClick={onClose}
          className="text-white/50 hover:text-white hover:bg-white/10 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200"
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-white/30">
            <span className="text-4xl mb-3">💬</span>
            <p className="text-sm">No messages yet</p>
            <p className="text-xs mt-1">Start the conversation!</p>
          </div>
        )}
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex flex-col ${
              msg.senderName === userName ? 'items-end' : 'items-start'
            }`}
          >
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-medium text-primary/80">
                {msg.senderName === userName ? 'You' : msg.senderName}
              </span>
              <span className="text-[10px] text-white/30">
                {formatTime(msg.timestamp)}
              </span>
            </div>
            <div
              className={`max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
                msg.senderName === userName
                  ? 'bg-primary/20 text-white rounded-tr-sm'
                  : 'bg-white/5 text-white/90 rounded-tl-sm'
              }`}
            >
              {msg.message}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-white/10 bg-dark">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all duration-200"
          />
          <button
            onClick={sendMessage}
            disabled={!inputValue.trim()}
            className="bg-primary hover:bg-primary/90 disabled:bg-white/5 disabled:text-white/20 text-white w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 shrink-0"
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
