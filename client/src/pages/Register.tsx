import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { showError, showSuccess } from '../utils/toast';
import Navbar from '../components/Navbar';
import { UserPlus, Mail, Lock, User, Shield } from 'lucide-react';

const Register: React.FC = () => {
  const [name, setName]                       = useState('');
  const [email, setEmail]                     = useState('');
  const [password, setPassword]               = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting]       = useState(false);
  const { register, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true });
  }, [user, navigate]);

  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password.trim() || !confirmPassword.trim()) {
      showError('Please fill in all fields');
      return;
    }
    if (password !== confirmPassword) {
      showError('Passwords do not match');
      return;
    }
    // FIX: server requires minimum 8 chars (was showing 6 in UI — now consistent)
    if (password.length < 8) {
      showError('Password must be at least 8 characters');
      return;
    }
    setIsSubmitting(true);
    try {
      await register(name, email, password);
      showSuccess('Account created successfully!');
      navigate('/dashboard');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      showError(axiosErr.response?.data?.error || 'Registration failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface mesh-bg">
      <Navbar />
      <div className="flex items-center justify-center px-4 py-12 min-h-[calc(100vh-4rem)]">
        <div className="w-full max-w-md animate-in">
          <div className="glass-card p-8 shadow-2xl shadow-black/40">
            <div className="text-center mb-8">
              <div className="w-14 h-14 bg-accent/10 border border-accent/20 rounded-2xl
                              flex items-center justify-center mx-auto mb-4 shadow-lg shadow-accent/10">
                <UserPlus className="w-7 h-7 text-accent" />
              </div>
              <h1 className="text-2xl font-bold text-white mb-1.5">Create your account</h1>
              <p className="text-text-muted text-sm">
                Get started with <span className="text-primary font-medium">SecureMeet</span> for free
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-text-muted text-sm font-medium mb-2">Full name</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-subtle pointer-events-none" />
                  <input id="name" type="text" value={name} onChange={e => setName(e.target.value)}
                    placeholder="Jane Smith" className="input-base pl-10" required />
                </div>
              </div>

              <div>
                <label htmlFor="email" className="block text-text-muted text-sm font-medium mb-2">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-subtle pointer-events-none" />
                  <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com" className="input-base pl-10" required />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-text-muted text-sm font-medium mb-2">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-subtle pointer-events-none" />
                  {/* FIX: placeholder now says Min. 8 characters to match server validation */}
                  <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="Min. 8 characters" className="input-base pl-10" required />
                </div>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-text-muted text-sm font-medium mb-2">Confirm password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-subtle pointer-events-none" />
                  <input id="confirmPassword" type="password" value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className={`input-base pl-10 ${passwordMismatch ? '!border-danger/50 focus:!border-danger/70 focus:!ring-danger/20' : ''}`}
                    required />
                </div>
                {passwordMismatch && (
                  <p className="text-danger text-xs mt-1.5">Passwords do not match</p>
                )}
              </div>

              <button type="submit" disabled={isSubmitting || passwordMismatch} className="btn-primary w-full mt-2">
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Creating account…
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <UserPlus className="w-4 h-4" />
                    Create Account
                  </span>
                )}
              </button>
            </form>

            <p className="text-center text-text-muted text-sm mt-6">
              Already have an account?{' '}
              <Link to="/login" className="text-primary hover:text-primary/80 font-medium transition-colors">Sign in</Link>
            </p>
          </div>

          <div className="flex items-center justify-center gap-2 mt-5 text-text-subtle text-xs">
            <Shield className="w-3.5 h-3.5" />
            <span>Free forever · No credit card required</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;
