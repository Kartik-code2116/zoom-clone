import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <nav className="sticky top-0 z-50 bg-darker/95 backdrop-blur-md border-b border-white/5 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link
            to="/"
            className="flex items-center gap-2 group"
          >
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform duration-200">
              <span className="text-white font-bold text-sm">Z</span>
            </div>
            <span className="text-white font-bold text-xl tracking-tight group-hover:text-primary transition-colors duration-200">
              ZoomClone
            </span>
          </Link>

          {/* Navigation */}
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <Link
                  to="/dashboard"
                  className="text-white/70 hover:text-white px-4 py-2 rounded-lg hover:bg-white/5 transition-all duration-200 text-sm font-medium"
                >
                  Dashboard
                </Link>
                <Link
                  to="/profile"
                  className="text-white/70 hover:text-white px-4 py-2 rounded-lg hover:bg-white/5 transition-all duration-200 text-sm font-medium"
                >
                  Profile
                </Link>
                <div className="flex items-center gap-3 ml-2 pl-4 border-l border-white/10">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
                      <span className="text-primary text-xs font-bold uppercase">
                        {user.name?.charAt(0) || 'U'}
                      </span>
                    </div>
                    <span className="text-white/80 text-sm font-medium hidden sm:block">
                      {user.name}
                    </span>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="text-white/50 hover:text-red-400 hover:bg-red-400/10 px-3 py-2 rounded-lg transition-all duration-200 text-sm font-medium"
                  >
                    Logout
                  </button>
                </div>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  className="text-white/70 hover:text-white px-4 py-2 rounded-lg hover:bg-white/5 transition-all duration-200 text-sm font-medium"
                >
                  Login
                </Link>
                <Link
                  to="/register"
                  className="bg-primary hover:bg-primary/90 text-white px-5 py-2 rounded-lg transition-all duration-200 text-sm font-medium shadow-lg shadow-primary/20 hover:shadow-primary/30"
                >
                  Register
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
