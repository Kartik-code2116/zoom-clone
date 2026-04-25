/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Brand
        primary: '#2D8CFF',
        accent: '#00D084',
        // Legacy aliases (kept for backward compat)
        dark: '#1A1A2E',
        darker: '#0F0F23',
        // Unified surface system — use these going forward
        surface: {
          DEFAULT: '#0f172a',   // page background  (replaces bg-slate-950 & bg-darker)
          2: '#1e293b',         // card/panel        (replaces bg-slate-900  & bg-dark)
          3: '#334155',         // input/hover       (replaces bg-slate-800)
          4: '#475569',         // subtle borders    (replaces bg-slate-700)
        },
        // Text scale
        text: {
          base:    '#f1f5f9',  // primary text
          muted:   '#94a3b8',  // secondary text
          subtle:  '#64748b',  // tertiary / placeholders
        },
        // Status colours
        success: '#10b981',
        warning: '#f59e0b',
        danger:  '#ef4444',
      },
      fontFamily: {
        sans: ['DM Sans', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':       { transform: 'translateY(-8px)' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-ring': {
          '0%':   { boxShadow: '0 0 0 0 rgba(239,68,68,0.4)' },
          '70%':  { boxShadow: '0 0 0 8px rgba(239,68,68,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(239,68,68,0)' },
        },
      },
      animation: {
        float:          'float 4s ease-in-out infinite',
        'float-slow':   'float 6s ease-in-out infinite',
        'fade-in':      'fade-in 0.3s ease-out',
        'pulse-ring':   'pulse-ring 1.5s ease-out infinite',
      },
      boxShadow: {
        'primary-glow': '0 0 24px rgba(45,140,255,0.25)',
        'danger-glow':  '0 0 24px rgba(239,68,68,0.25)',
      },
    },
  },
  plugins: [],
  // Safelist dynamic trust-score colours so Tailwind never purges them
  safelist: [
    'bg-emerald-500', 'bg-yellow-400', 'bg-red-500',
    'text-emerald-400', 'text-yellow-400', 'text-red-400',
    'border-emerald-500/30', 'border-yellow-500/30', 'border-red-500/30',
  ],
};
