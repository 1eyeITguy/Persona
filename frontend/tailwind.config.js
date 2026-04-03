/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#6474e5',
          accent: '#7c3aed',
        },
        surface: '#1a1d27',
        'app-bg': '#0f1117',
        'border-subtle': '#2d3148',
        success: '#4ade80',
        warning: '#f59e0b',
        danger: '#f87171',
      },
    },
  },
  plugins: [],
}
