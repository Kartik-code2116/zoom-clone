import React from 'react';

const Spinner: React.FC = () => {
  return (
    <div className="flex items-center justify-center min-h-screen bg-dark">
      <div className="relative">
        <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-5 h-5 rounded-full bg-primary/30 animate-pulse" />
        </div>
      </div>
    </div>
  );
};

export default Spinner;
