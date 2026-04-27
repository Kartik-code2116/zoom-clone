import React, { useRef, useState, useEffect, useCallback } from 'react';
import { X, Trash2, Download, Pen, Eraser, Minus, Pin } from 'lucide-react';

interface Point { x: number; y: number; }
interface Stroke { points: Point[]; color: string; size: number; isEraser: boolean; }

interface WhiteboardPanelProps {
  isOpen: boolean;
  onClose: () => void;
  width?: number;
  onWidthChange?: (w: number) => void;
}

const COLORS = ['#ffffff', '#a78bfa', '#34d399', '#f87171', '#fbbf24', '#60a5fa', '#f472b6', '#000000'];
const SIZES  = [2, 4, 8, 14];

const WhiteboardPanel: React.FC<WhiteboardPanelProps> = ({
  isOpen, onClose, width = 400, onWidthChange,
}) => {
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes]         = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Point[]>([]);
  const [isDrawing, setIsDrawing]     = useState(false);
  const [color, setColor]             = useState('#ffffff');
  const [size, setSize]               = useState(4);
  const [tool, setTool]               = useState<'pen' | 'eraser'>('pen');
  const [panelWidth, setPanelWidth]   = useState(width);
  const [isResizing, setIsResizing]   = useState(false);
  const MIN_W = 300; const MAX_W = 700;

  useEffect(() => { setPanelWidth(width); }, [width]);

  // Panel resize
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const w = Math.max(MIN_W, Math.min(MAX_W, window.innerWidth - e.clientX));
      setPanelWidth(w); onWidthChange?.(w);
    };
    const onUp = () => { setIsResizing(false); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    if (isResizing) {
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
      document.body.style.cursor    = 'ew-resize';
      document.body.style.userSelect = 'none';
    }
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [isResizing, onWidthChange]);

  // Redraw all strokes
  const redraw = useCallback((extraStroke?: Point[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const drawStroke = (pts: Point[], c: string, s: number, eraser: boolean) => {
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
      ctx.strokeStyle = c;
      ctx.lineWidth   = s;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    };

    strokes.forEach(s => drawStroke(s.points, s.color, s.size, s.isEraser));
    if (extraStroke && extraStroke.length > 1) {
      drawStroke(extraStroke, color, size, tool === 'eraser');
    }
  }, [strokes, color, size, tool]);

  useEffect(() => { redraw(); }, [redraw]);

  const getPos = (e: React.MouseEvent | React.TouchEvent): Point => {
    const canvas = canvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      const t = e.touches[0];
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDrawing(true);
    const p = getPos(e);
    setCurrentStroke([p]);
  };

  const moveDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing) return;
    const p = getPos(e);
    setCurrentStroke(prev => {
      const next = [...prev, p];
      redraw(next);
      return next;
    });
  };

  const endDraw = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentStroke.length > 1) {
      setStrokes(prev => [...prev, { points: currentStroke, color, size, isEraser: tool === 'eraser' }]);
    }
    setCurrentStroke([]);
  };

  const clearCanvas = () => { setStrokes([]); setCurrentStroke([]); };

  const undo = () => { setStrokes(prev => prev.slice(0, -1)); setCurrentStroke([]); };

  const downloadCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Create a version with dark background for download
    const offscreen = document.createElement('canvas');
    offscreen.width  = canvas.width;
    offscreen.height = canvas.height;
    const ctx = offscreen.getContext('2d')!;
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);
    ctx.drawImage(canvas, 0, 0);
    const a = document.createElement('a');
    a.href     = offscreen.toDataURL('image/png');
    a.download = `whiteboard-${Date.now()}.png`;
    a.click();
  };

  if (!isOpen) return null;

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
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 flex-shrink-0">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
          <Pen className="w-4 h-4 text-primary" />
          Whiteboard
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={undo} title="Undo" disabled={strokes.length === 0}
            className="text-white/40 hover:text-white disabled:opacity-20 hover:bg-white/8 w-7 h-7 rounded-lg flex items-center justify-center transition-all text-xs font-bold">
            ↩
          </button>
          <button onClick={downloadCanvas} title="Download"
            className="text-white/40 hover:text-white hover:bg-white/8 w-7 h-7 rounded-lg flex items-center justify-center transition-all">
            <Download className="w-3.5 h-3.5" />
          </button>
          <button onClick={clearCanvas} title="Clear all"
            className="text-white/40 hover:text-red-400 hover:bg-white/8 w-7 h-7 rounded-lg flex items-center justify-center transition-all">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={onClose}
            className="text-white/50 hover:text-white hover:bg-white/8 w-7 h-7 rounded-lg flex items-center justify-center transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-white/8 flex-shrink-0 flex-wrap">
        {/* Tool toggle */}
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          <button onClick={() => setTool('pen')}
            className={`px-3 py-1.5 flex items-center gap-1.5 text-xs transition-all ${tool === 'pen' ? 'bg-primary text-white' : 'bg-white/5 text-white/50 hover:text-white'}`}>
            <Pen className="w-3 h-3" /> Pen
          </button>
          <button onClick={() => setTool('eraser')}
            className={`px-3 py-1.5 flex items-center gap-1.5 text-xs transition-all ${tool === 'eraser' ? 'bg-primary text-white' : 'bg-white/5 text-white/50 hover:text-white'}`}>
            <Eraser className="w-3 h-3" /> Eraser
          </button>
        </div>

        {/* Brush size */}
        <div className="flex items-center gap-1">
          {SIZES.map(s => (
            <button key={s} onClick={() => setSize(s)}
              className={`rounded-full flex items-center justify-center transition-all border-2
                          ${size === s ? 'border-primary' : 'border-transparent hover:border-white/20'}`}
              style={{ width: s + 12, height: s + 12 }}>
              <div className="rounded-full bg-white" style={{ width: s, height: s }} />
            </button>
          ))}
        </div>

        {/* Colors */}
        <div className="flex items-center gap-1">
          {COLORS.map(c => (
            <button key={c} onClick={() => { setColor(c); setTool('pen'); }}
              className={`w-5 h-5 rounded-full transition-all border-2 ${color === c && tool === 'pen' ? 'border-white scale-110' : 'border-transparent hover:border-white/40'}`}
              style={{ background: c, boxShadow: c === '#000000' ? '0 0 0 1px rgba(255,255,255,0.2)' : undefined }}
            />
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-hidden bg-[#0f0f1a] relative">
        <canvas
          ref={canvasRef}
          width={800}
          height={1000}
          className="w-full h-full"
          style={{ cursor: tool === 'eraser' ? 'cell' : 'crosshair', touchAction: 'none' }}
          onMouseDown={startDraw}
          onMouseMove={moveDraw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={moveDraw}
          onTouchEnd={endDraw}
        />
        {strokes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-white/15 text-sm">Draw anything here…</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default WhiteboardPanel;
