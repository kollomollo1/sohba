/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Facebook-inspired blue with light, readable surfaces
        primary: {
          DEFAULT: '#1877f2',
          50: '#edf4ff',
          100: '#dbe9ff',
          200: '#b8d4ff',
          300: '#8bbaff',
          400: '#5b9cff',
          500: '#1877f2',
          600: '#166fe5',
          700: '#125fc4',
          800: '#0f4f9e',
          900: '#0b3d78',
        },
        secondary: {
          DEFAULT: '#0866ff',
          50: '#eef5ff',
          100: '#dceaff',
          200: '#bdd6ff',
          300: '#94bdff',
          400: '#609bff',
          500: '#0866ff',
          600: '#0758df',
          700: '#064abf',
          800: '#053d9d',
          900: '#032f7a',
        },
        accent: {
          DEFAULT: '#1877f2',
          soft: '#e7f0ff',
        },
        urgent: {
          DEFAULT: '#d92121',
          50: '#ffeaea',
          100: '#ffd0d0',
          glow: 'rgba(217, 33, 33, 0.25)',
        },
        success: {
          DEFAULT: '#21806a',
          50: '#e4f4ef',
        },
        warning: {
          DEFAULT: '#f59e0b',
          50: '#fef3c7',
        },
        error: {
          DEFAULT: '#ba1a1a',
          50: '#fee2e2',
        },
        surface: {
          DEFAULT: '#f5f8fc',
          raised: '#ffffff',
          subtle: '#edf2f8',
          dim: '#dde5ef',
        },
        ink: {
          DEFAULT: '#131b2e',
          soft: '#44474e',
          muted: '#70768a',
          faint: '#a9aebf',
          inverse: '#ffffff',
        },
      },
      fontFamily: {
        sans: ['"Noto Sans Arabic"', 'system-ui', '-apple-system', 'sans-serif'],
        arabic: ['"Noto Sans Arabic"', 'system-ui', '-apple-system', 'sans-serif'],
        noto: ['"Noto Sans Arabic"', 'system-ui', '-apple-system', 'sans-serif'],
        post: ['"Noto Sans Arabic"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      },
      boxShadow: {
        card: '0 1px 3px rgba(19, 27, 46, 0.06), 0 1px 2px rgba(19, 27, 46, 0.04)',
        'card-raised': '0 4px 16px rgba(19, 27, 46, 0.08), 0 2px 6px rgba(19, 27, 46, 0.04)',
        nav: '0 -1px 12px rgba(19, 27, 46, 0.08)',
        fab: '0 6px 20px rgba(24, 119, 242, 0.28)',
        urgent: '0 0 0 1px rgba(217, 33, 33, 0.18), 0 4px 18px rgba(217, 33, 33, 0.12)',
      },
      animation: {
        'fade-in': 'fadeIn 0.25s ease-out',
        'slide-up': 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-down': 'slideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'pop': 'pop 0.2s ease-out',
        'urgent-pulse': 'urgentPulse 2.4s ease-in-out infinite',
        'like-pop': 'likePop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { transform: 'translateY(16px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        slideDown: { '0%': { transform: 'translateY(-16px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        pop: { '0%': { transform: 'scale(0.96)' }, '100%': { transform: 'scale(1)' } },
        urgentPulse: {
          '0%, 100%': { boxShadow: '0 0 0 1px rgba(217, 33, 33, 0.18), 0 4px 18px rgba(217, 33, 33, 0.10)' },
          '50%': { boxShadow: '0 0 0 1px rgba(217, 33, 33, 0.30), 0 6px 24px rgba(217, 33, 33, 0.18)' },
        },
        likePop: {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.35)' },
          '100%': { transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
