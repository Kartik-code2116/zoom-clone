import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';

const NotFound: React.FC = () => {
  return (
    <div className="min-h-screen bg-dark">
      <Navbar />

      <div className="flex items-center justify-center px-4 py-20">
        <div className="text-center max-w-md">
          {/* 404 Number */}
          <div className="relative mb-8">
            <h1 className="text-[120px] sm:text-[160px] font-black text-white/[0.03] leading-none select-none">
              404
            </h1>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-6xl">🔍</span>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-white mb-3">Page Not Found</h2>
          <p className="text-white/40 text-sm mb-8 leading-relaxed">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
            Let&apos;s get you back on track.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/"
              className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-white px-8 py-3 rounded-xl font-semibold transition-all duration-200 shadow-lg shadow-primary/20 hover:shadow-primary/30"
            >
              Go Home
            </Link>
            <Link
              to="/dashboard"
              className="w-full sm:w-auto bg-white/5 hover:bg-white/10 text-white/70 hover:text-white px-8 py-3 rounded-xl font-medium transition-all duration-200 border border-white/5 hover:border-white/10"
            >
              Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
