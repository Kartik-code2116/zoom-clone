import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { showError } from '../utils/toast';
import Navbar from '../components/Navbar';
import { LogIn, Mail, Lock, Shield } from 'lucide-react';

const Login: React.FC = () => {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true });
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      showError('Please fill in all fields');
      return;
    }
    setIsSubmitting(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      showError(axiosErr.response?.data?.error || 'Login failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface mesh-bg">
      <Navbar />

      <div className="flex items-center justify-center px-4 py-20 min-h-[calc(100vh-4rem)]">
        <div className="w-full max-w-md animate-in">

          {/* Card */}
          <div className="glass-card p-8 shadow-2xl shadow-black/40">

            {/* Header */}
            <div className="text-center mb-8">
              <div className="w-14 h-14 bg-primary/10 border border-primary/20 rounded-2xl
                              flex items-center justify-center mx-auto mb-4
                              shadow-lg shadow-primary/10">
                <LogIn className="w-7 h-7 text-primary" />
              </div>
              <h1 className="text-2xl font-bold text-white mb-1.5">Welcome back</h1>
              <p className="text-text-muted text-sm">
                Sign in to continue to{' '}
                <span className="text-primary font-medium">SecureMeet</span>
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">

              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-text-muted text-sm font-medium mb-2">
                  Email address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-subtle pointer-events-none" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="input-base pl-10"
                    required
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="password" className="text-text-muted text-sm font-medium">
                    Password
                  </label>
                  <a href="#" className="text-xs text-primary hover:text-primary/80 transition-colors">
                    Forgot password?
                  </a>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-subtle pointer-events-none" />
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="input-base pl-10"
                    required
                  />
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary w-full mt-2"
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Signing in…
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <LogIn className="w-4 h-4" />
                    Sign In
                  </span>
                )}
              </button>
            </form>

            {/* Footer link */}
            <p className="text-center text-text-muted text-sm mt-6">
              Don&apos;t have an account?{' '}
              <Link to="/register" className="text-primary hover:text-primary/80 font-medium transition-colors">
                Create one free
              </Link>
            </p>
          </div>

          {/* Trust badge */}
          <div className="flex items-center justify-center gap-2 mt-5 text-text-subtle text-xs">
            <Shield className="w-3.5 h-3.5" />
            <span>End-to-end encrypted · AI deepfake protection</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
