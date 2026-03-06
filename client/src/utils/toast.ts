import toast from 'react-hot-toast';

export const showSuccess = (msg: string): void => {
  toast.success(msg, {
    style: {
      background: '#1a1a2e',
      color: '#fff',
      border: '1px solid #2d2d44',
      borderRadius: '0.75rem',
      padding: '12px 16px',
    },
    iconTheme: {
      primary: '#4ade80',
      secondary: '#1a1a2e',
    },
    duration: 3000,
  });
};

export const showError = (msg: string): void => {
  toast.error(msg, {
    style: {
      background: '#1a1a2e',
      color: '#fff',
      border: '1px solid #2d2d44',
      borderRadius: '0.75rem',
      padding: '12px 16px',
    },
    iconTheme: {
      primary: '#f87171',
      secondary: '#1a1a2e',
    },
    duration: 4000,
  });
};

export const showInfo = (msg: string): void => {
  toast(msg, {
    style: {
      background: '#1a1a2e',
      color: '#fff',
      border: '1px solid #2d2d44',
      borderRadius: '0.75rem',
      padding: '12px 16px',
    },
    icon: 'ℹ️',
    duration: 3000,
  });
};
