import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import { 
  Video, Users, Shield, Zap, Globe, Monitor, MessageSquare,
  Calendar, CheckCircle, ArrowRight, Play, Mic, VideoOff, Share2, Smile
} from 'lucide-react';

const Home: React.FC = () => {
  const [meetingCode, setMeetingCode] = useState('');
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);

  const handleStartMeeting = () => navigate(user ? '/dashboard' : '/login');
  const handleJoinMeeting  = () => { if (meetingCode.trim()) navigate(`/join/${meetingCode.trim()}`); };

  const features = [
    { icon: <Video className="w-8 h-8" />,        title: 'HD Video & Audio',       description: 'Crystal-clear video and audio quality with adaptive streaming technology for the best experience on any connection.' },
    { icon: <Users className="w-8 h-8" />,         title: 'Up to 100 Participants',  description: 'Host large meetings with up to 100 participants simultaneously with gallery view and speaker spotlight.' },
    { icon: <Shield className="w-8 h-8" />,        title: 'Enterprise Security',     description: 'End-to-end encryption, waiting rooms, meeting locks, and password protection keep your meetings secure.' },
    { icon: <Monitor className="w-8 h-8" />,       title: 'Screen Sharing',          description: 'Share your entire screen or specific application windows with annotation tools and remote control.' },
    { icon: <MessageSquare className="w-8 h-8" />, title: 'Team Chat',               description: 'Built-in messaging with file sharing, reactions, and threaded conversations during meetings.' },
    { icon: <Zap className="w-8 h-8" />,           title: 'AI Deepfake Guard',       description: 'Our proprietary AI detects and alerts you to potential deepfake participants in real-time.' },
  ];

  const useCases = [
    { title: 'Team Meetings',  description: 'Daily standups, project reviews, and brainstorming sessions with your entire team.',          image: '🏢', color: 'from-blue-500/20 to-blue-600/10'   },
    { title: 'Online Classes', description: 'Virtual classrooms with interactive whiteboards, breakout rooms, and attendance tracking.',     image: '🎓', color: 'from-emerald-500/20 to-emerald-600/10' },
    { title: 'Telehealth',     description: 'HIPAA-compliant video consultations with secure recording and notes integration.',              image: '🏥', color: 'from-rose-500/20 to-rose-600/10'   },
    { title: 'Virtual Events', description: 'Webinars, conferences, and live streams with up to 10,000 viewers.',                           image: '🎪', color: 'from-purple-500/20 to-purple-600/10' },
  ];

  const stats = [
    { value: '10M+',  label: 'Daily Meeting Participants' },
    { value: '150+',  label: 'Countries Supported' },
    { value: '99.9%', label: 'Uptime Guarantee' },
    { value: '4.8/5', label: 'User Rating' },
  ];

  return (
    <div className="min-h-screen bg-slate-950">
      <Navbar />

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center overflow-hidden">
        {/* Always-visible gradient mesh background */}
        <div className="absolute inset-0 z-0 mesh-bg bg-slate-950">
          {/* Video loads on top when available */}
          <video
            autoPlay loop muted playsInline
            onLoadedData={() => setIsVideoLoaded(true)}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${isVideoLoaded ? 'opacity-100' : 'opacity-0'}`}
          >
            <source src="https://st1.zoom.us/homepage/20260326-1202/primary/dist/assets/zoommedia/aic-video.mp4" type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950/50 via-transparent to-slate-950" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-32">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="text-left">
              <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-full px-4 py-2 mb-6">
                <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                <span className="text-primary text-sm font-medium">#1 Video Conferencing Platform</span>
              </div>

              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white leading-[1.1] mb-6">
                One platform to{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-400">
                  connect
                </span>
              </h1>

              <p className="text-xl text-slate-300 mb-8 leading-relaxed max-w-xl">
                Enterprise-grade video conferencing with AI-powered security.
                Host meetings, webinars, and virtual events with confidence.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 mb-8">
                <button onClick={handleStartMeeting}
                  className="group flex items-center justify-center gap-3 bg-primary hover:bg-primary/90
                             text-white px-8 py-4 rounded-2xl font-semibold text-lg transition-all duration-300
                             shadow-xl shadow-primary/25 hover:shadow-primary/40 hover:scale-[1.02] active:scale-[0.98]">
                  <Video className="w-5 h-5" />
                  Start New Meeting
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
                <button onClick={() => navigate('/login')}
                  className="flex items-center justify-center gap-3 bg-white/10 hover:bg-white/15
                             text-white px-8 py-4 rounded-2xl font-semibold text-lg transition-all duration-300
                             backdrop-blur-sm border border-white/10">
                  <Calendar className="w-5 h-5" />
                  Schedule for Later
                </button>
              </div>

              <div className="flex items-center gap-3 max-w-md">
                <div className="relative flex-1">
                  <input
                    type="text" value={meetingCode}
                    onChange={e => setMeetingCode(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleJoinMeeting()}
                    placeholder="Enter meeting ID or link"
                    className="w-full bg-white/5 border border-white/20 rounded-xl px-5 py-3.5 text-white
                               placeholder-slate-400 focus:outline-none focus:border-primary/50 focus:bg-white/10
                               transition-all duration-200"
                  />
                </div>
                <button onClick={handleJoinMeeting} disabled={!meetingCode.trim()}
                  className="px-6 py-3.5 bg-white/10 hover:bg-white/15 disabled:opacity-40
                             disabled:cursor-not-allowed text-white rounded-xl font-medium
                             transition-all duration-200 whitespace-nowrap border border-white/20">
                  Join
                </button>
              </div>
            </div>

            {/* Floating UI preview */}
            <div className="hidden lg:flex justify-center items-center">
              <div className="relative">
                <div className="relative w-80 h-56 bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-slate-700 to-slate-800" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-blue-500 flex items-center justify-center">
                      <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                  </div>
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-red-500/90 flex items-center justify-center">
                      <Mic className="w-5 h-5 text-white" />
                    </div>
                    <div className="w-10 h-10 rounded-full bg-red-500/90 flex items-center justify-center">
                      <VideoOff className="w-5 h-5 text-white" />
                    </div>
                    <div className="w-10 h-10 rounded-full bg-slate-600/90 flex items-center justify-center">
                      <Share2 className="w-5 h-5 text-white" />
                    </div>
                  </div>
                </div>

                {/* Fixed: animate-float instead of animate-bounce */}
                <div className="absolute -top-8 -right-16 w-32 h-24 bg-slate-800 rounded-xl border border-slate-700 shadow-xl overflow-hidden animate-float">
                  <div className="h-full bg-gradient-to-br from-emerald-500/20 to-emerald-600/30 flex items-center justify-center">
                    <Smile className="w-8 h-8 text-emerald-400" />
                  </div>
                </div>
                <div className="absolute -bottom-4 -left-12 w-28 h-20 bg-slate-800 rounded-xl border border-slate-700 shadow-xl overflow-hidden animate-float-slow">
                  <div className="h-full bg-gradient-to-br from-purple-500/20 to-purple-600/30 flex items-center justify-center">
                    <Users className="w-6 h-6 text-purple-400" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10">
          <div className="flex flex-col items-center gap-2 text-slate-400 animate-bounce">
            <span className="text-xs uppercase tracking-widest">Scroll to explore</span>
            <ArrowRight className="w-4 h-4 rotate-90" />
          </div>
        </div>
      </section>

      {/* ── Stats ─────────────────────────────────────────────────── */}
      <section className="relative z-10 py-16 bg-slate-900/50 border-y border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, i) => (
              <div key={i} className="text-center">
                <p className="text-4xl md:text-5xl font-bold text-white mb-2">{stat.value}</p>
                <p className="text-slate-400 text-sm">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────── */}
      <section className="py-24 bg-slate-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="text-primary text-sm font-semibold uppercase tracking-wider">Features</span>
            <h2 className="text-4xl font-bold text-white mt-3 mb-4">Everything you need for video conferencing</h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">Powerful features designed for modern teams. From AI security to seamless collaboration.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((f, i) => (
              <div key={i} className="group p-8 bg-slate-900/50 border border-slate-800 rounded-2xl hover:bg-slate-800/50 hover:border-slate-700 transition-all duration-300">
                <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center text-primary mb-5 group-hover:scale-110 transition-transform duration-300">{f.icon}</div>
                <h3 className="text-xl font-semibold text-white mb-3">{f.title}</h3>
                <p className="text-slate-400 leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Use Cases ─────────────────────────────────────────────── */}
      <section className="py-24 bg-slate-900/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="text-primary text-sm font-semibold uppercase tracking-wider">Use Cases</span>
            <h2 className="text-4xl font-bold text-white mt-3 mb-4">Built for every scenario</h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">From small team huddles to large virtual conferences, we have got you covered.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            {useCases.map((u, i) => (
              <div key={i} className={`group relative overflow-hidden rounded-2xl p-8 bg-gradient-to-br ${u.color} border border-slate-800 hover:border-slate-600 transition-all duration-300`}>
                <div className="relative z-10">
                  <span className="text-5xl mb-4 block">{u.image}</span>
                  <h3 className="text-2xl font-bold text-white mb-3">{u.title}</h3>
                  <p className="text-slate-300 leading-relaxed">{u.description}</p>
                </div>
                <div className="absolute top-4 right-4 w-24 h-24 bg-white/5 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-500" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ──────────────────────────────────────────── */}
      <section className="py-24 bg-slate-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="text-primary text-sm font-semibold uppercase tracking-wider">How It Works</span>
            <h2 className="text-4xl font-bold text-white mt-3 mb-4">Start connecting in seconds</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: '1', title: 'Create or Join',  description: 'Start an instant meeting or join one with a meeting ID. No downloads required.',                     icon: <Video className="w-6 h-6" />  },
              { step: '2', title: 'Invite Others',   description: 'Share the meeting link or ID with participants via email, chat, or calendar.',                        icon: <Users className="w-6 h-6" />  },
              { step: '3', title: 'Collaborate',     description: 'Use video, audio, screen sharing, and chat to work together effectively.',                            icon: <Globe className="w-6 h-6" />  },
            ].map((item, i) => (
              <div key={i} className="relative text-center">
                <div className="w-16 h-16 bg-primary/10 border border-primary/30 rounded-2xl flex items-center justify-center text-primary mx-auto mb-6">{item.icon}</div>
                <span className="text-5xl font-bold text-slate-800 absolute -top-4 left-1/2 -translate-x-1/2 -z-10">{item.step}</span>
                <h3 className="text-xl font-semibold text-white mb-3">{item.title}</h3>
                <p className="text-slate-400">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AI Deepfake section ────────────────────────────────────── */}
      <section id="security" className="py-24 bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-rose-500/10 border border-rose-500/30 rounded-full px-4 py-2 mb-6">
                <Shield className="w-4 h-4 text-rose-400" />
                <span className="text-rose-400 text-sm font-medium">AI-Powered Security</span>
              </div>
              {/* Fixed: World's (apostrophe) */}
              <h2 className="text-4xl font-bold text-white mb-6">World's First Deepfake Detection</h2>
              <p className="text-slate-400 text-lg mb-8 leading-relaxed">
                Our proprietary AI analyzes video frames in real-time to detect potential deepfake participants.
                Protect your meetings from AI-generated impersonators with our advanced Fraud Dashboard.
              </p>
              <ul className="space-y-4">
                {[
                  'Real-time face analysis using MediaPipe Face Mesh',
                  'Behavioral signal detection (blinks, gaze, micro-movements)',
                  'Custom ML model with 95%+ accuracy',
                  'Instant alerts for suspicious participants',
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-slate-300">
                    <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative">
              <div className="aspect-square max-w-md mx-auto bg-slate-800 rounded-3xl border border-slate-700 p-6 shadow-2xl">
                <div className="h-full bg-slate-900 rounded-2xl overflow-hidden flex flex-col">
                  <div className="p-4 bg-slate-800 border-b border-slate-700">
                    <div className="flex items-center gap-2">
                      <Shield className="w-5 h-5 text-primary" />
                      <span className="text-white font-semibold">Fraud Dashboard</span>
                    </div>
                  </div>
                  <div className="flex-1 p-4 space-y-3">
                    {[
                      { name: 'John Smith',   status: 'REAL', score: 94, color: '#10b981' },
                      { name: 'Sarah Chen',   status: 'REAL', score: 91, color: '#10b981' },
                      { name: 'Unknown User', status: 'FAKE', score: 23, color: '#ef4444' },
                    ].map((u, i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-slate-800 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: u.color }} />
                          <span className="text-slate-300 text-sm">{u.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs px-2 py-1 rounded font-semibold"
                            style={{ backgroundColor: u.color + '20', color: u.color }}>
                            {u.status}
                          </span>
                          <span className="text-slate-400 text-sm">{u.score}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="p-4 bg-rose-500/10 border-t border-rose-500/30">
                    <p className="text-rose-400 text-sm flex items-center gap-2">
                      <Shield className="w-4 h-4" />
                      1 suspicious participant detected
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Testimonials ──────────────────────────────────────────── */}
      <section className="py-24 bg-slate-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="text-primary text-sm font-semibold uppercase tracking-wider">Testimonials</span>
            <h2 className="text-4xl font-bold text-white mt-3 mb-4">Trusted by millions worldwide</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { quote: 'The deepfake detection feature is a game-changer for our security team. We feel confident hosting sensitive meetings.',              author: 'Michael Torres', role: 'CISO, TechCorp Inc.',        avatar: 'MT' },
              { quote: 'Best video quality I have experienced. The AI features and screen sharing make remote collaboration feel seamless.',               author: 'Emily Zhang',    role: 'Product Manager, StartupXYZ', avatar: 'EZ' },
              { quote: 'We migrated from Zoom and never looked back. The fraud dashboard gives us peace of mind for client meetings.',                      author: 'David Kumar',    role: 'VP Engineering, SecureChat',  avatar: 'DK' },
            ].map((t, i) => (
              <div key={i} className="p-8 bg-slate-900 border border-slate-800 rounded-2xl">
                <div className="flex gap-0.5 mb-4">
                  {[...Array(5)].map((_, j) => <span key={j} className="text-yellow-400">★</span>)}
                </div>
                <p className="text-slate-300 mb-6 leading-relaxed">"{t.quote}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-semibold text-sm">
                    {t.avatar}
                  </div>
                  <div>
                    <p className="text-white font-medium">{t.author}</p>
                    <p className="text-slate-500 text-sm">{t.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────── */}
      <section className="py-24 bg-gradient-to-br from-primary/20 via-slate-900 to-primary/10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">Ready to transform your meetings?</h2>
          <p className="text-slate-400 text-lg mb-8 max-w-2xl mx-auto">
            Join millions of users who trust our platform for secure, high-quality video conferencing.
            Get started for free today.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button onClick={() => navigate('/register')}
              className="flex items-center justify-center gap-3 bg-primary hover:bg-primary/90 text-white
                         px-8 py-4 rounded-2xl font-semibold text-lg transition-all duration-300
                         shadow-xl shadow-primary/25 hover:shadow-primary/40 hover:scale-[1.02]">
              <Play className="w-5 h-5" />
              Get Started Free
            </button>
            <button onClick={() => navigate('/login')}
              className="flex items-center justify-center gap-3 bg-white/10 hover:bg-white/15 text-white
                         px-8 py-4 rounded-2xl font-semibold text-lg transition-all duration-300
                         backdrop-blur-sm border border-white/20">
              Sign In
            </button>
          </div>
          <p className="text-slate-500 text-sm mt-6">No credit card required. Free forever for basic use.</p>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────── */}
      <footer className="py-16 bg-slate-950 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8 mb-12">
            <div>
              <h3 className="text-white font-bold text-xl mb-4">SecureMeet</h3>
              <p className="text-slate-400 text-sm">Enterprise-grade video conferencing with AI-powered security.</p>
            </div>
            {[
              { heading: 'Product',   links: ['Features', 'Pricing', 'Security', 'Integrations'] },
              { heading: 'Resources', links: ['Documentation', 'API Reference', 'Community', 'Support'] },
              { heading: 'Company',   links: ['About', 'Blog', 'Careers', 'Contact'] },
            ].map(col => (
              <div key={col.heading}>
                <h4 className="text-white font-semibold mb-4">{col.heading}</h4>
                <ul className="space-y-2 text-slate-400 text-sm">
                  {col.links.map(l => (
                    <li key={l}><a href="#" className="hover:text-white transition-colors">{l}</a></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="pt-8 border-t border-slate-800 flex flex-col md:flex-row justify-between items-center gap-4">
            {/* Fixed: © 2025 */}
            <p className="text-slate-500 text-sm">© 2025 SecureMeet. All rights reserved.</p>
            <div className="flex items-center gap-6">
              {['Privacy', 'Terms', 'Cookies'].map(l => (
                <a key={l} href="#" className="text-slate-400 hover:text-white text-sm transition-colors">{l}</a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Home;
