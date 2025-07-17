/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      animation: {
        'spin': 'spin 1s linear infinite',
      },
      colors: {
        'helia-blue': '#3B82F6',
        'helia-green': '#10B981',
        'helia-purple': '#8B5CF6',
      },
    },
  },
  plugins: [],
} 