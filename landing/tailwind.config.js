/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Instrument Serif"', 'serif'],
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        brandDark: '#182C41',
      },
      animation: {
        'train-bob': 'train-bob 3s ease-in-out infinite',
      },
      keyframes: {
        'train-bob': {
          '0%, 100%': { transform: 'translateY(0px) scale(1.03)' },
          '50%': { transform: 'translateY(-6px) scale(1.03)' },
        },
      },
    },
  },
  plugins: [],
};
