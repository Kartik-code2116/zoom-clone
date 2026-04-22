import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';

import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import JoinMeeting from './pages/JoinMeeting';
import Meeting from './pages/Meeting';
import MeetingSummary from './pages/MeetingSummary';
import FraudDashboard from './pages/FraudDashboard';
import ProfilePage from './pages/ProfilePage';
import NotFound from './pages/NotFound';

const App: React.FC = () => {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          <Route path="/join/:meetingId" element={<JoinMeeting />} />
          {/* Meeting page wrapped in its own boundary so a crash doesn't kill the whole app */}
          <Route
            path="/meeting/:meetingId"
            element={
              <ErrorBoundary>
                <Meeting />
              </ErrorBoundary>
            }
          />
          <Route
            path="/meeting/:meetingId/fraud-dashboard"
            element={
              <ProtectedRoute>
                <FraudDashboard />
              </ProtectedRoute>
            }
          />
          <Route path="/meeting/:meetingId/summary" element={<MeetingSummary />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </ErrorBoundary>
    </AuthProvider>
  );
};

export default App;
