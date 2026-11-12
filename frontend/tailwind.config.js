/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Neutros cálidos del sistema MyQuote v2 (papel y tinta): reemplazan al slate azulado.
      colors: {
        slate: {
          50: '#FAFAF8',
          100: '#F2F2EF',
          200: '#E7E7E2',
          300: '#D3D3CD',
          400: '#A1A199',
          500: '#6E6E66',
          600: '#5A5A53',
          700: '#3D3D38',
          800: '#232320',
          900: '#121211',
          950: '#0C0C0B',
        },
      },
      // Radios cerrados: nada de tarjetas infladas.
      borderRadius: {
        sm: '2px',
        DEFAULT: '4px',
        md: '4px',
        lg: '6px',
        xl: '8px',
        '2xl': '8px',
        '3xl': '10px',
      },
      fontFamily: {
        sans: ["'Geist'", "'Segoe UI'", 'system-ui', 'sans-serif'],
        mono: ["'Geist Mono'", 'ui-monospace', "'Cascadia Mono'", 'Consolas', 'monospace'],
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(0.985)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.32s cubic-bezier(0.2, 0.7, 0.2, 1) both',
        'fade-in': 'fade-in 0.2s ease-out both',
        'scale-in': 'scale-in 0.26s cubic-bezier(0.2, 0.7, 0.2, 1) both',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
}
