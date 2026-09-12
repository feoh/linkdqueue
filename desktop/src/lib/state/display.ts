import type { DisplayPreferences } from '../api/types';

export const THEMES = [
  'system',
  'catppuccinMocha',
  'catppuccinLatte',
  'dracula',
  'tokyoNight',
  'tokyoDay',
  'gruvbox',
  'oneDark',
] as const;
export type Theme = (typeof THEMES)[number];
export const TEXT_SCALES = [0.85, 1, 1.25, 1.5, 1.75, 2] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

export function normalizeTheme(value: string): Theme {
  return (THEMES as readonly string[]).includes(value) ? (value as Theme) : 'system';
}
export function normalizeTextScale(value: number): TextScale {
  return (TEXT_SCALES as readonly number[]).includes(value) ? (value as TextScale) : 1;
}
export function normalizeDisplay(
  display: DisplayPreferences,
): DisplayPreferences & { theme: Theme; textScale: TextScale } {
  return { theme: normalizeTheme(display.theme), textScale: normalizeTextScale(display.textScale) };
}

let mediaQuery: MediaQueryList | null = null;
let mediaListener: (() => void) | null = null;

export function applyDisplay(display: DisplayPreferences): void {
  const normalized = normalizeDisplay(display);
  const root = document.documentElement;
  root.dataset.theme = normalized.theme;
  root.style.setProperty('--text-scale', String(normalized.textScale));
  if (mediaQuery && mediaListener) mediaQuery.removeEventListener('change', mediaListener);
  mediaQuery = null;
  mediaListener = null;
  if (normalized.theme === 'system' && typeof window.matchMedia === 'function') {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaListener = () => {
      root.dataset.theme = 'system';
    };
    mediaQuery.addEventListener('change', mediaListener);
  }
}

export function clearDisplayListener(): void {
  if (mediaQuery && mediaListener) mediaQuery.removeEventListener('change', mediaListener);
  mediaQuery = null;
  mediaListener = null;
}
