/* ============================================================
   THEME SYSTEM
   Every theme is a flat map of CSS custom properties applied to
   :root. Components only ever reference var(--token-name) —
   never a hardcoded color — so adding a theme is one object here,
   zero component changes.
   ============================================================ */

const THEMES = {
  iron: {
    label: 'Iron (Dark)',
    swatch: '#E8542E',
    tokens: {
      '--bg': '#0E0F12',
      '--bg-elevated': '#17181C',
      '--card': '#1C1E23',
      '--border': '#3A3D42',
      '--text': '#F5F3EF',
      '--text-muted': '#9A9CA3',
      '--accent-suggest': '#E8542E',   /* AI suggestion — load-red, used ONLY here */
      '--accent-logged': '#5FA8D3',    /* logged/actual data — chalk-blue, used ONLY here */
      '--accent-success': '#5FA870',
      '--accent-warn': '#E8B23A',
      '--shadow': '0 8px 24px rgba(0,0,0,0.4)',
    },
  },
  light: {
    label: 'Chalk (Light)',
    swatch: '#D64E2A',
    tokens: {
      '--bg': '#F5F3EF',
      '--bg-elevated': '#FFFFFF',
      '--card': '#FFFFFF',
      '--border': '#DAD6CE',
      '--text': '#1A1A1A',
      '--text-muted': '#6B6B6B',
      '--accent-suggest': '#D64E2A',
      '--accent-logged': '#2E6E9E',
      '--accent-success': '#3F8F5C',
      '--accent-warn': '#C6890F',
      '--shadow': '0 4px 16px rgba(0,0,0,0.08)',
    },
  },
  crimson: {
    label: 'Crimson',
    swatch: '#FF3B4E',
    tokens: {
      '--bg': '#120A0C',
      '--bg-elevated': '#1C1013',
      '--card': '#221417',
      '--border': '#4A2A30',
      '--text': '#F5EDEE',
      '--text-muted': '#B08A8E',
      '--accent-suggest': '#FF3B4E',
      '--accent-logged': '#5FC7D3',
      '--accent-success': '#5FA870',
      '--accent-warn': '#E8B23A',
      '--shadow': '0 8px 24px rgba(0,0,0,0.5)',
    },
  },
  forest: {
    label: 'Forest',
    swatch: '#4E9A5A',
    tokens: {
      '--bg': '#0D1410',
      '--bg-elevated': '#141C17',
      '--card': '#19221D',
      '--border': '#2E3D33',
      '--text': '#EDF3EF',
      '--text-muted': '#96A69C',
      '--accent-suggest': '#E8942E',
      '--accent-logged': '#4E9A5A',
      '--accent-success': '#4E9A5A',
      '--accent-warn': '#E8B23A',
      '--shadow': '0 8px 24px rgba(0,0,0,0.45)',
    },
  },
};

function applyTheme(themeKey) {
  const theme = THEMES[themeKey] || THEMES.iron;
  const root = document.documentElement;
  Object.entries(theme.tokens).forEach(([k, v]) => root.style.setProperty(k, v));
  root.setAttribute('data-theme', themeKey);
}

function initTheme() {
  const settings = Storage.getSettings();
  applyTheme(settings.theme);
}

window.Themes = { THEMES, applyTheme, initTheme };
