import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyDisplay,
  clearDisplayListener,
  normalizeDisplay,
  normalizeTextScale,
  normalizeTheme,
  TEXT_SCALES,
  THEMES,
} from './display';

describe('display preferences', () => {
  afterEach(() => {
    clearDisplayListener();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.removeProperty('--text-scale');
  });

  it('accepts exactly the persisted B03 themes and scales', () => {
    expect(THEMES).toEqual([
      'system',
      'catppuccinMocha',
      'catppuccinLatte',
      'dracula',
      'tokyoNight',
      'tokyoDay',
      'gruvbox',
      'oneDark',
    ]);
    expect(TEXT_SCALES).toEqual([0.85, 1, 1.25, 1.5, 1.75, 2]);
  });

  it('fails closed for corrupt stored values', () => {
    expect(normalizeTheme('unknown')).toBe('system');
    expect(normalizeTextScale(1.1)).toBe(1);
    expect(normalizeDisplay({ theme: 'not-a-theme', textScale: 3 })).toEqual({
      theme: 'system',
      textScale: 1,
    });
  });

  it('listens for OS changes only in system mode and cleans up', () => {
    const add = vi.fn();
    const remove = vi.fn();
    const matchMedia = vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: add,
      removeEventListener: remove,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList);
    Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true });

    applyDisplay({ theme: 'dracula', textScale: 2 });
    expect(add).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.theme).toBe('dracula');
    expect(document.documentElement.style.getPropertyValue('--text-scale')).toBe('2');

    applyDisplay({ theme: 'system', textScale: 1 });
    expect(add).toHaveBeenCalledOnce();
    clearDisplayListener();
    expect(remove).toHaveBeenCalledOnce();
  });
});
