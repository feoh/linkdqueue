import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

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

const bridge: LinkdqueueBridge = {
  getSettings: async () => settings,
  testConnection: unusedCommand,
  saveConnection: unusedCommand,
  clearConnection: unusedCommand,
  setDisplayPreferences: unusedCommand,
  listBookmarks: unusedCommand,
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
