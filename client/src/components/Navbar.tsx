import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard,
  User,
  LogOut,
  ChevronDown,
  Shield,
  Video,
} from 'lucide-react';

const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleLogout = async () => {
    setDropdownOpen(false);
    await logout();
    navigate('/');
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const isActive = (path: string) => location.pathname === path;

  const navLinkClass = (path: string) =>
    `px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
      isActive(path)
        ? 'bg-primary/15 text-primary'
        : 'text-white/65 hover:text-white hover:bg-white/6'
    }`;

  return (
    <nav className="sticky top-0 z-50 bg-surface/90 backdrop-blur-xl border-b border-white/6 shadow-lg shadow-black/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">

          {/* ── Logo ───────────────────────────────────────────── */}
          <Link to="/" className="flex items-center gap-2.5 group flex-shrink-0">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center
                            group-hover:scale-110 transition-transform duration-200
                            shadow-lg shadow-primary/30">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="currentColor">
                <path d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4z"/>
                <polygon points="10,9 10,15 15,12" fill="white" opacity="0.9"/>
              </svg>
            </div>
            <span className="text-white font-bold text-lg tracking-tight
                             group-hover:text-primary transition-colors duration-200">
              SecureMeet
            </span>
          </Link>

          {/* ── Desktop nav links ───────────────────────────────── */}
          <div className="hidden md:flex items-center gap-1">
            {user ? (
              <>
                <Link to="/dashboard" className={navLinkClass('/dashboard')}>
                  <LayoutDashboard className="w-4 h-4" />
                  Dashboard
                </Link>
                <Link to="/profile" className={navLinkClass('/profile')}>
                  <User className="w-4 h-4" />
                  Profile
                </Link>
              </>
            ) : (
              <>
                <a href="#features" className="text-white/65 hover:text-white px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200">
                  Features
                </a>
                <a href="#security" className="text-white/65 hover:text-white px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200">
                  Security
                </a>
              </>
            )}
          </div>

          {/* ── Right side ─────────────────────────────────────── */}
          <div className="flex items-center gap-2">
            {user ? (
              /* Avatar dropdown */
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl
                             hover:bg-white/6 transition-all duration-200 group"
                >
                  <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/30
                                  flex items-center justify-center flex-shrink-0
                                  group-hover:ring-2 group-hover:ring-primary/40 transition-all">
                    <span className="text-primary text-xs font-bold uppercase">
                      {user.name?.charAt(0) || 'U'}
                    </span>
                  </div>
                  <span className="text-white/80 text-sm font-medium hidden sm:block max-w-28 truncate">
                    {user.name}
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 text-white/40 transition-transform duration-200
                                           ${dropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {dropdownOpen && (
                  <div className="absolute right-0 top-12 w-52 bg-surface-2 border border-white/10
                                  rounded-2xl shadow-2xl shadow-black/50 overflow-hidden animate-in z-50">
                    {/* User info */}
                    <div className="px-4 py-3 border-b border-white/8">
                      <p className="text-white font-semibold text-sm truncate">{user.name}</p>
                      <p className="text-text-muted text-xs truncate">{user.email}</p>
                    </div>
                    {/* Links */}
                    <div className="py-1">
                      <Link
                        to="/dashboard"
                        onClick={() => setDropdownOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 text-sm text-white/80
                                   hover:bg-white/6 hover:text-white transition-colors"
                      >
                        <LayoutDashboard className="w-4 h-4 text-text-muted" />
                        Dashboard
                      </Link>
                      <Link
                        to="/profile"
                        onClick={() => setDropdownOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 text-sm text-white/80
                                   hover:bg-white/6 hover:text-white transition-colors"
                      >
                        <User className="w-4 h-4 text-text-muted" />
                        Profile
                      </Link>
                    </div>
                    {/* Logout */}
                    <div className="border-t border-white/8 py-1">
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm
                                   text-danger/80 hover:bg-danger/8 hover:text-danger transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        Sign out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Link
                  to="/login"
                  className="text-white/65 hover:text-white px-4 py-2 rounded-lg
                             text-sm font-medium transition-all duration-200 hidden sm:block"
                >
                  Sign in
                </Link>
                <Link
                  to="/register"
                  className="btn-primary !py-2 !px-5 !text-sm"
                >
                  Get Started
                </Link>
              </>
            )}

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2 rounded-lg hover:bg-white/6 text-white/70 transition-colors ml-1"
              aria-label="Toggle menu"
            >
              <div className="w-5 space-y-1.5">
                <span className={`block h-0.5 bg-current rounded-full transition-all duration-300
                                  ${mobileOpen ? 'rotate-45 translate-y-2' : ''}`} />
                <span className={`block h-0.5 bg-current rounded-full transition-all duration-300
                                  ${mobileOpen ? 'opacity-0' : ''}`} />
                <span className={`block h-0.5 bg-current rounded-full transition-all duration-300
                                  ${mobileOpen ? '-rotate-45 -translate-y-2' : ''}`} />
              </div>
            </button>
          </div>
        </div>

        {/* ── Mobile menu ─────────────────────────────────────── */}
        {mobileOpen && (
          <div className="md:hidden border-t border-white/6 py-3 space-y-1 animate-in">
            {user ? (
              <>
                <div className="flex items-center gap-3 px-4 py-3 mb-2">
                  <div className="w-9 h-9 rounded-full bg-primary/20 border border-primary/30
                                  flex items-center justify-center">
                    <span className="text-primary text-sm font-bold uppercase">
                      {user.name?.charAt(0) || 'U'}
                    </span>
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm">{user.name}</p>
                    <p className="text-text-muted text-xs">{user.email}</p>
                  </div>
                </div>
                <Link to="/dashboard" onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-white/80
                             hover:bg-white/6 hover:text-white text-sm font-medium transition-colors">
                  <LayoutDashboard className="w-4 h-4" /> Dashboard
                </Link>
                <Link to="/profile" onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-white/80
                             hover:bg-white/6 hover:text-white text-sm font-medium transition-colors">
                  <User className="w-4 h-4" /> Profile
                </Link>
                <button onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl
                             text-danger/80 hover:bg-danger/8 hover:text-danger text-sm font-medium transition-colors">
                  <LogOut className="w-4 h-4" /> Sign out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-white/80
                             hover:bg-white/6 text-sm font-medium transition-colors">
                  Sign in
                </Link>
                <Link to="/register" onClick={() => setMobileOpen(false)}
                  className="flex items-center justify-center gap-2 mx-4 py-2.5 rounded-xl
                             bg-primary hover:bg-primary/90 text-white text-sm font-semibold transition-colors">
                  <Video className="w-4 h-4" /> Get Started Free
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
