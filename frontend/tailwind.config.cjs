/** @type {import('tailwindcss').Config} */
// As cores mapeiam para CSS vars aplicadas por src/config/theme.js (applyTheme),
// mantendo theme.js como fonte única — nenhum hex é duplicado aqui.
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  prefix: 'tw-',
  corePlugins: {
    preflight: false,
    container: false,
  },
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'var(--brand)',
          light: 'var(--brand-light)',
          deep: 'var(--brand-deep)',
          100: 'var(--brand-100)',
          200: 'var(--brand-200)',
        },
        lav: 'var(--bg-lav)',
        wa: 'var(--wa-green)',
        ink: 'var(--ink)',
        status: {
          'aguardando-bg': 'var(--status-aguardando_sinal-bg)',
          'aguardando-fg': 'var(--status-aguardando_sinal-fg)',
          'confirmado-bg': 'var(--status-confirmado-bg)',
          'confirmado-fg': 'var(--status-confirmado-fg)',
          'concluido-bg': 'var(--status-concluido-bg)',
          'concluido-fg': 'var(--status-concluido-fg)',
          'cancelado-bg': 'var(--status-cancelado-bg)',
          'cancelado-fg': 'var(--status-cancelado-fg)',
          'naoshow-bg': 'var(--status-nao_compareceu-bg)',
          'naoshow-fg': 'var(--status-nao_compareceu-fg)',
        },
      },
      boxShadow: {
        soft: '0 10px 30px -12px rgba(30, 27, 75, 0.18)',
        card: '0 4px 16px -8px rgba(30, 27, 75, 0.16)',
      },
      minHeight: {
        touch: '44px',
      },
      minWidth: {
        touch: '44px',
      },
    },
  },
  plugins: [],
};
