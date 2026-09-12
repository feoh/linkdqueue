import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import type { LinkdqueueBridge } from './lib/api/bridge';
import type { Settings } from './lib/api/types';
import App from './App.svelte';

const settings: Settings = {
  status: 'ready',
  canonicalBaseUrl: 'https://linkding.invalid',
  credentialStatus: 'available',
  errorCode: null,
  allowInsecureHttp: false,
  pendingCleanup: false,
  display: { theme: 'system', textScale: 1 },
  generation: 1,
};

const unusedCommand = async (): Promise<never> => {
  throw new Error('unused command in App test');
};

const emptyBookmarks = async () => ({
  generation: settings.generation,
  data: { count: 0, next: null, previous: null, results: [] },
});

const bridge: LinkdqueueBridge = {
  getSettings: async () => settings,
  testConnection: unusedCommand,
  saveConnection: unusedCommand,
  clearConnection: unusedCommand,
  setDisplayPreferences: unusedCommand,
  listBookmarks: emptyBookmarks,
  listTags: unusedCommand,
  createBookmark: unusedCommand,
  markRead: unusedCommand,
  replaceBookmarkTags: unusedCommand,
  archiveBookmark: unusedCommand,
  unarchiveBookmark: unusedCommand,
  deleteBookmark: unusedCommand,
  openExternalUrl: unusedCommand,
};

describe('desktop shell bootstrap and navigation', () => {
  it('keeps loading visible until stored display settings are applied', async () => {
    let resolveSettings: (value: Settings) => void = () => undefined;
    const pending = new Promise<Settings>((resolve) => {
      resolveSettings = resolve;
    });
    const delayedBridge = { ...bridge, getSettings: () => pending };
    render(App, { props: { bridge: delayedBridge } });

    expect(screen.getByText('Loading your desktop settings')).toBeInTheDocument();
    expect(screen.queryByText('A calm place for your reading queue')).not.toBeInTheDocument();

    resolveSettings({ ...settings, display: { theme: 'dracula', textScale: 1.5 } });
    await waitFor(() =>
      expect(screen.getByText('Your reading queue is empty.')).toBeInTheDocument(),
    );
    expect(document.documentElement.dataset.theme).toBe('dracula');
    expect(document.documentElement.style.getPropertyValue('--text-scale')).toBe('1.5');
  });

  it('uses the current generation and recovers visibly when display persistence fails', async () => {
    const setDisplayPreferences = vi.fn().mockRejectedValue({ code: 'preferences_write_failed' });
    const failingBridge = { ...bridge, setDisplayPreferences };
    render(App, { props: { bridge: failingBridge } });
    await waitFor(() =>
      expect(screen.getByText('Your reading queue is empty.')).toBeInTheDocument(),
    );

    await fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const theme = screen.getByRole('combobox', { name: 'Color theme' });
    await fireEvent.change(theme, { target: { value: 'dracula' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save display preferences' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('previous settings remain active'),
    );
    expect(setDisplayPreferences).toHaveBeenCalledWith({
      generation: 1,
      theme: 'dracula',
      textScale: 1,
    });
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('system');
  });
  it('routes New bookmark through the shared mutation flow with the active generation', async () => {
    const createBookmark = vi.fn().mockResolvedValue({
      generation: 1,
      data: {} as never,
    });
    const appBridge = {
      ...bridge,
      createBookmark,
      listTags: vi.fn().mockResolvedValue({
        generation: 1,
        data: { results: [], next: null },
      }),
    } as unknown as LinkdqueueBridge;
    render(App, { props: { bridge: appBridge } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'New bookmark' })).toBeEnabled());
    await fireEvent.click(screen.getByRole('button', { name: 'New bookmark' }));
    await fireEvent.input(screen.getByLabelText(/URL/), {
      target: { value: 'https://example.test/item' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save bookmark' }));
    await waitFor(() =>
      expect(createBookmark).toHaveBeenCalledWith({
        generation: 1,
        url: 'https://example.test/item',
      }),
    );
  });

  it('changes the active section through the sidebar', async () => {
    render(App, { props: { bridge } });

    await fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Archive');
    expect(screen.getByRole('button', { name: 'Archive' })).toHaveClass('active');
  });

  it('keeps search as an ephemeral draft in the current shell', async () => {
    render(App, { props: { bridge } });
    const search = screen.getByRole('searchbox', { name: 'Search bookmarks' });

    await fireEvent.input(search, { target: { value: 'design systems' } });

    expect(screen.getByText('Search draft:')).toBeInTheDocument();
    expect(screen.getByText('design systems')).toBeInTheDocument();
  });
});
