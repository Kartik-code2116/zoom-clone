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
  width?: number;
  onWidthChange?: (width: number) => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ 
  meetingId, 
  userName, 
  isOpen, 
  onClose, 
  onNewMessage,
  width = 320,
  onWidthChange
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  
  // Draggable state
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isDefaultPosition, setIsDefaultPosition] = useState(true);

  // Resizable state
  const [panelWidth, setPanelWidth] = useState(width);
  const [panelHeight, setPanelHeight] = useState(500);
  const [isResizingWidth, setIsResizingWidth] = useState(false);
  const [isResizingHeight, setIsResizingHeight] = useState(false);
  const MIN_WIDTH = 280;
  const MAX_WIDTH = 600;
  const MIN_HEIGHT = 300;
  const MAX_HEIGHT = 800;

  // Sync with parent width
  useEffect(() => {
    setPanelWidth(width);
  }, [width]);

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

  // Handle drag start
  const handleDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input')) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  };

  // Handle resize start (width - from left edge)
  const handleResizeWidthStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizingWidth(true);
  };

  // Handle resize start (height - from bottom edge)
  const handleResizeHeightStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizingHeight(true);
  };

  // Handle resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingWidth && panelRef.current) {
        const newWidth = isDefaultPosition 
          ? window.innerWidth - e.clientX 
          : (panelRef.current.getBoundingClientRect().right - e.clientX);
        const clampedWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
        setPanelWidth(clampedWidth);
        onWidthChange?.(clampedWidth);
      }
      if (isResizingHeight && panelRef.current) {
        const newHeight = e.clientY - panelRef.current.getBoundingClientRect().top;
        const clampedHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, newHeight));
        setPanelHeight(clampedHeight);
      }
      if (!isDragging) return;
      
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      
      const maxX = window.innerWidth - (panelRef.current?.offsetWidth || 320);
      const maxY = window.innerHeight - (panelRef.current?.offsetHeight || 400);
      
      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY))
      });
      setIsDefaultPosition(false);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizingWidth(false);
      setIsResizingHeight(false);
    };

    if (isDragging || isResizingWidth || isResizingHeight) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      if (isResizingWidth) document.body.style.cursor = 'ew-resize';
      else if (isResizingHeight) document.body.style.cursor = 'ns-resize';
      else document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, isResizingWidth, isResizingHeight, dragStart]);

  const formatTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className={`bg-darker border border-white/10 z-50 flex flex-col shadow-2xl rounded-2xl overflow-hidden ${
        isDefaultPosition 
          ? 'fixed top-0 right-0 h-full w-80 sm:w-96 border-l border-r-0 border-t-0 border-b-0' 
          : 'fixed'
      } ${isDragging ? 'shadow-primary/20' : ''}`}
      style={isDefaultPosition ? { width: panelWidth } : {
        left: position.x,
        top: position.y,
        right: 'auto',
        bottom: 'auto',
        width: panelWidth,
        height: panelHeight
      }}
    >
      {/* Resize Handle - Left Edge (Width) */}
      <div
        onMouseDown={handleResizeWidthStart}
        className={`absolute left-0 top-0 bottom-0 w-4 cursor-ew-resize z-20 flex items-center justify-center group ${
          isResizingWidth ? 'bg-primary/20' : 'hover:bg-primary/10'
        }`}
        title="Drag to resize width"
      >
        <div className={`w-1 h-8 rounded-full transition-colors ${
          isResizingWidth ? 'bg-primary' : 'bg-slate-600 group-hover:bg-primary'
        }`} />
      </div>

      {/* Resize Handle - Bottom Edge (Height) - only when floating */}
      {!isDefaultPosition && (
        <div
          onMouseDown={handleResizeHeightStart}
          className={`absolute left-0 right-0 bottom-0 h-4 cursor-ns-resize z-20 flex items-center justify-center group ${
            isResizingHeight ? 'bg-primary/20' : 'hover:bg-primary/10'
          }`}
          title="Drag to resize height"
        >
          <div className={`w-8 h-1 rounded-full transition-colors ${
            isResizingHeight ? 'bg-primary' : 'bg-slate-600 group-hover:bg-primary'
          }`} />
        </div>
      )}
      
      {/* Drag Handle - only visible when moved */}
      {!isDefaultPosition && (
        <div
          onMouseDown={handleDragStart}
          className="w-full h-4 cursor-grab active:cursor-grabbing flex items-center justify-center bg-dark border-b border-white/10"
          title="Drag to move"
        >
          <div className="w-8 h-1 bg-slate-600 rounded-full" />
        </div>
      )}
      
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-dark">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
          💬 <span>Meeting Chat</span>
        </h3>
        <div className="flex items-center gap-1">
          {/* Pin/Unpin button */}
          {!isDefaultPosition && (
            <button
              onClick={() => {
                setPosition({ x: 0, y: 0 });
                setIsDefaultPosition(true);
              }}
              className="text-white/50 hover:text-white hover:bg-white/10 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200"
              title="Pin to side"
            >
              📌
            </button>
          )}
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white hover:bg-white/10 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200"
          >
            ✕
          </button>
        </div>
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
