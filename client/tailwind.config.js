/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#2D8CFF',
        dark: '#1A1A2E',
        darker: '#0F0F23',
        accent: '#00D084',
      },
    },
  },
  plugins: [],
};
