/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Grises fríos del sistema MyQuote: los tonos oscuros dejan de ser azul marino.
      colors: {
        slate: {
          50: '#F7F8FA',
          100: '#EEF0F3',
          200: '#E1E4E8',
          300: '#CBD0D6',
          400: '#9AA4AF',
          500: '#6B7480',
          600: '#5A6472',
          700: '#3A424C',
          800: '#1F252C',
          900: '#14181D',
          950: '#0C0F12',
        },
      },
      fontFamily: {
        sans: ["'Plus Jakarta Sans'", "'Segoe UI'", 'system-ui', 'sans-serif'],
        mono: ["'JetBrains Mono'", 'ui-monospace', "'Cascadia Mono'", 'Consolas', 'monospace'],
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.35s ease-out both',
        'fade-in': 'fade-in 0.25s ease-out both',
        'scale-in': 'scale-in 0.2s ease-out both',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
}
