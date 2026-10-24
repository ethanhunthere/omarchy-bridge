// ==========================================
// Theme tokens — one flat token set per theme.
// Layout never changes between themes; only these values do.
// ==========================================

export interface ThemeTokens {
  id: string;
  name: string;
  /** App background */
  bg: string;
  /** Cards / raised blocks */
  surface: string;
  /** Modal + dialog card */
  surfaceElevated: string;
  /** Text inputs / keycaps */
  inputBg: string;
  border: string;
  borderStrong: string;
  divider: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  /** Default terminal glyph color */
  terminalText: string;
  /** Primary action (filled button) */
  accent: string;
  /** Text/glyph color on accent fills */
  accentText: string;
  /** Focus ring / active input border */
  focus: string;
  success: string;
  successBg: string;
  successBorder: string;
  warning: string;
  danger: string;
  dangerBg: string;
  dangerBorder: string;
  promptPath: string;
  promptArrow: string;
  promptFail: string;
  logo: string;
  /** Segmented control shell + active segment */
  chipBg: string;
  chipActiveBg: string;
  keycapBg: string;
  keycapBorder: string;
  keycapText: string;
  /** ANSI 30-37 / 90-97 */
  ansi: Record<number, string>;
}

const ANSI_INDUSTRIAL: Record<number, string> = {
  30: '#71717a',
  31: '#ef4444',
  32: '#22c55e',
  33: '#eab308',
  34: '#3b82f6',
  35: '#a855f7',
  36: '#06b6d4',
  37: '#f4f4f5',
  90: '#52525b',
  91: '#f87171',
  92: '#4ade80',
  93: '#fde047',
  94: '#60a5fa',
  95: '#c084fc',
  96: '#22d3ee',
  97: '#ffffff',
};

const ANSI_GRUVBOX: Record<number, string> = {
  30: '#928374',
  31: '#fb4934',
  32: '#b8bb26',
  33: '#fabd2f',
  34: '#83a598',
  35: '#d3869b',
  36: '#8ec07c',
  37: '#ebdbb2',
  90: '#928374',
  91: '#fb4934',
  92: '#b8bb26',
  93: '#fabd2f',
  94: '#83a598',
  95: '#d3869b',
  96: '#8ec07c',
  97: '#fbf1c7',
};

const ANSI_NORD: Record<number, string> = {
  30: '#4c566a',
  31: '#bf616a',
  32: '#a3be8c',
  33: '#ebcb8b',
  34: '#81a1c1',
  35: '#b48ead',
  36: '#88c0d0',
  37: '#e5e9f0',
  90: '#616e88',
  91: '#bf616a',
  92: '#a3be8c',
  93: '#ebcb8b',
  94: '#81a1c1',
  95: '#b48ead',
  96: '#8fbcbb',
  97: '#eceff4',
};

const ANSI_TOKYO: Record<number, string> = {
  30: '#414868',
  31: '#f7768e',
  32: '#9ece6a',
  33: '#e0af68',
  34: '#7aa2f7',
  35: '#bb9af7',
  36: '#7dcfff',
  37: '#a9b1d6',
  90: '#414868',
  91: '#f7768e',
  92: '#9ece6a',
  93: '#e0af68',
  94: '#7aa2f7',
  95: '#bb9af7',
  96: '#7dcfff',
  97: '#c0caf5',
};

const ANSI_CATPPUCCIN: Record<number, string> = {
  30: '#45475a',
  31: '#f38ba8',
  32: '#a6e3a1',
  33: '#f9e2af',
  34: '#89b4fa',
  35: '#f5c2e7',
  36: '#94e2d5',
  37: '#bac2de',
  90: '#585b70',
  91: '#f38ba8',
  92: '#a6e3a1',
  93: '#f9e2af',
  94: '#89b4fa',
  95: '#f5c2e7',
  96: '#94e2d5',
  97: '#a6adc8',
};

const ANSI_KANAGAWA: Record<number, string> = {
  30: '#727169',
  31: '#e82424',
  32: '#98bb6c',
  33: '#e6c384',
  34: '#7e9cd8',
  35: '#957fb8',
  36: '#7fb4ca',
  37: '#c8c093',
  90: '#727169',
  91: '#e82424',
  92: '#98bb6c',
  93: '#e6c384',
  94: '#7e9cd8',
  95: '#957fb8',
  96: '#7fb4ca',
  97: '#dcd7ba',
};

export const THEMES: ThemeTokens[] = [
  {
    id: 'industrial',
    name: 'Industrial',
    bg: '#0a0b0d',
    surface: '#111319',
    surfaceElevated: '#12141a',
    inputBg: '#161820',
    border: '#1d222e',
    borderStrong: '#262936',
    divider: '#3f3f46',
    textPrimary: '#ffffff',
    textSecondary: '#d4d4d8',
    textMuted: '#71717a',
    terminalText: '#e4e4e7',
    accent: '#f4f4f5',
    accentText: '#0a0b0d',
    focus: '#3b82f6',
    success: '#22c55e',
    successBg: '#111814',
    successBorder: '#1e3828',
    warning: '#fbbf24',
    danger: '#f87171',
    dangerBg: '#181214',
    dangerBorder: '#351c21',
    promptPath: '#38bdf8',
    promptArrow: '#22c55e',
    promptFail: '#f87171',
    logo: '#818cf8',
    chipBg: 'rgba(24, 27, 36, 0.75)',
    chipActiveBg: '#282b37',
    keycapBg: '#161820',
    keycapBorder: '#262936',
    keycapText: '#d4d4d8',
    ansi: ANSI_INDUSTRIAL,
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    bg: '#1d2021',
    surface: '#282828',
    surfaceElevated: '#32302f',
    inputBg: '#32302f',
    border: '#3c3836',
    borderStrong: '#504945',
    divider: '#504945',
    textPrimary: '#ebdbb2',
    textSecondary: '#d5c4a1',
    textMuted: '#a89984',
    terminalText: '#ebdbb2',
    accent: '#fabd2f',
    accentText: '#1d2021',
    focus: '#83a598',
    success: '#b8bb26',
    successBg: '#1e2318',
    successBorder: '#3a3d1e',
    warning: '#fe8019',
    danger: '#ff7a68',
    dangerBg: '#26141a',
    dangerBorder: '#4a2428',
    promptPath: '#83a598',
    promptArrow: '#b8bb26',
    promptFail: '#fb4934',
    logo: '#d3869b',
    chipBg: 'rgba(40, 40, 40, 0.75)',
    chipActiveBg: '#3c3836',
    keycapBg: '#32302f',
    keycapBorder: '#504945',
    keycapText: '#d5c4a1',
    ansi: ANSI_GRUVBOX,
  },
  {
    id: 'nord',
    name: 'Nord',
    bg: '#2e3440',
    surface: '#343b48',
    surfaceElevated: '#3b4252',
    inputBg: '#3b4252',
    border: '#434c5e',
    borderStrong: '#4c566a',
    divider: '#4c566a',
    textPrimary: '#eceff4',
    textSecondary: '#d8dee9',
    textMuted: '#a9b3c8',
    terminalText: '#e5e9f0',
    accent: '#88c0d0',
    accentText: '#2e3440',
    focus: '#81a1c1',
    success: '#a3be8c',
    successBg: '#2b3b2f',
    successBorder: '#3f5340',
    warning: '#ebcb8b',
    danger: '#e5a1a9',
    dangerBg: '#3a2b31',
    dangerBorder: '#573f47',
    promptPath: '#81a1c1',
    promptArrow: '#a3be8c',
    promptFail: '#bf616a',
    logo: '#b48ead',
    chipBg: 'rgba(59, 66, 82, 0.75)',
    chipActiveBg: '#434c5e',
    keycapBg: '#3b4252',
    keycapBorder: '#4c566a',
    keycapText: '#d8dee9',
    ansi: ANSI_NORD,
  },
  {
    id: 'tokyo',
    name: 'Tokyo Night',
    bg: '#1a1b26',
    surface: '#1f2335',
    surfaceElevated: '#292e42',
    inputBg: '#292e42',
    border: '#2f334d',
    borderStrong: '#3b4261',
    divider: '#3b4261',
    textPrimary: '#c0caf5',
    textSecondary: '#a9b1d6',
    textMuted: '#8f97bd',
    terminalText: '#c0caf5',
    accent: '#7aa2f7',
    accentText: '#16161e',
    focus: '#7dcfff',
    success: '#9ece6a',
    successBg: '#1c2b1f',
    successBorder: '#2f4630',
    warning: '#e0af68',
    danger: '#f7768e',
    dangerBg: '#2a1a26',
    dangerBorder: '#4a2940',
    promptPath: '#7aa2f7',
    promptArrow: '#9ece6a',
    promptFail: '#f7768e',
    logo: '#bb9af7',
    chipBg: 'rgba(41, 46, 66, 0.75)',
    chipActiveBg: '#3b4261',
    keycapBg: '#292e42',
    keycapBorder: '#3b4261',
    keycapText: '#a9b1d6',
    ansi: ANSI_TOKYO,
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    bg: '#11111b',
    surface: '#181825',
    surfaceElevated: '#1e1e2e',
    inputBg: '#1e1e2e',
    border: '#313244',
    borderStrong: '#45475a',
    divider: '#45475a',
    textPrimary: '#cdd6f4',
    textSecondary: '#bac2de',
    textMuted: '#a6adc8',
    terminalText: '#cdd6f4',
    accent: '#cba6f7',
    accentText: '#11111b',
    focus: '#89b4fa',
    success: '#a6e3a1',
    successBg: '#1b2a1e',
    successBorder: '#2f4632',
    warning: '#f9e2af',
    danger: '#f38ba8',
    dangerBg: '#2a1a2a',
    dangerBorder: '#4a2a42',
    promptPath: '#89b4fa',
    promptArrow: '#a6e3a1',
    promptFail: '#f38ba8',
    logo: '#cba6f7',
    chipBg: 'rgba(30, 30, 46, 0.75)',
    chipActiveBg: '#313244',
    keycapBg: '#1e1e2e',
    keycapBorder: '#45475a',
    keycapText: '#bac2de',
    ansi: ANSI_CATPPUCCIN,
  },
  {
    id: 'kanagawa',
    name: 'Kanagawa',
    bg: '#1f1f28',
    surface: '#2a2a37',
    surfaceElevated: '#363646',
    inputBg: '#363646',
    border: '#3a3a4c',
    borderStrong: '#54546d',
    divider: '#54546d',
    textPrimary: '#dcd7ba',
    textSecondary: '#c8c093',
    textMuted: '#a8a592',
    terminalText: '#dcd7ba',
    accent: '#91abe0',
    accentText: '#1f1f28',
    focus: '#7e9cd8',
    success: '#98bb6c',
    successBg: '#1f2a1c',
    successBorder: '#35452c',
    warning: '#ff9e3b',
    danger: '#ff8589',
    dangerBg: '#2a1a1d',
    dangerBorder: '#4a2a30',
    promptPath: '#7e9cd8',
    promptArrow: '#98bb6c',
    promptFail: '#ff8589',
    logo: '#957fb8',
    chipBg: 'rgba(54, 54, 70, 0.75)',
    chipActiveBg: '#3a3a4c',
    keycapBg: '#363646',
    keycapBorder: '#54546d',
    keycapText: '#c8c093',
    ansi: ANSI_KANAGAWA,
  },
];

export const DEFAULT_THEME_ID = 'industrial';

export function getTheme(id: string): ThemeTokens {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}
