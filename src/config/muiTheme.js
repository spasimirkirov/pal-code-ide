import { createTheme } from '@mui/material/styles';

const midnight = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#2bd1ff', light: '#70e0ff', dark: '#1fa3cc' },
    secondary: { main: '#69a8ff', light: '#8fc0ff', dark: '#4a7acc' },
    info: { main: '#69a8ff' },
    success: { main: '#4ade80', light: '#86efac', dark: '#22c55e' },
    warning: { main: '#fbbf24', light: '#fcd34d', dark: '#f59e0b' },
    error: { main: '#fb7185', light: '#fda4af', dark: '#f43f5e' },
    background: {
      default: '#070b14',
      paper: '#0d1225',
    },
    text: {
      primary: '#e2e8f0',
      secondary: '#8892b0',
      disabled: '#475569',
    },
    divider: 'rgba(43, 209, 255, 0.12)',
    action: {
      active: '#2bd1ff',
      hover: 'rgba(43, 209, 255, 0.08)',
      selected: 'rgba(43, 209, 255, 0.14)',
      disabled: 'rgba(148, 163, 184, 0.3)',
      disabledBackground: 'rgba(148, 163, 184, 0.08)',
    },
  },
  typography: {
    fontFamily: '"Space Grotesk", "Inter", "Segoe UI", system-ui, sans-serif',
    fontFamilyMonospace: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
    h6: { fontWeight: 600, letterSpacing: '0.02em' },
    subtitle2: { fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '0.7rem' },
    body2: { fontSize: '0.8125rem' },
    caption: { fontSize: '0.7rem', letterSpacing: '0.03em' },
  },
  shape: { borderRadius: 8 },
  spacing: (factor) => `${0.25 * factor}rem`,
});

export default midnight;
