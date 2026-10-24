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

export const ANSI_INDUSTRIAL: Record<number, string> = {
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

export const ANSI_GRUVBOX: Record<number, string> = {
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

export const ANSI_NORD: Record<number, string> = {
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

export const ANSI_TOKYO: Record<number, string> = {
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

export const ANSI_CATPPUCCIN: Record<number, string> = {
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

export const ANSI_KANAGAWA: Record<number, string> = {
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
