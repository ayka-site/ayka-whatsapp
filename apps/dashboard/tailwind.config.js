/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)',
        accent: 'var(--color-accent)',
        surface: 'var(--color-background)',
        sidebar: 'var(--color-sidebar)',
        'text-main': 'var(--color-text)',
        'score-hot': '#ef4444',
        'score-warm': '#f59e0b',
        'score-cold': '#64748b',
      },
    },
  },
  plugins: [],
}
