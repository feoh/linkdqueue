import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import BookmarkRow from './lib/features/bookmarks/BookmarkRow.svelte';
import type { Bookmark } from './lib/api/types';
import permissionSource from '../src-tauri/permissions/linkdqueue.toml?raw';

import tauriConfig from '../src-tauri/tauri.conf.json';
import mainCapability from '../src-tauri/capabilities/main.json';

const bundledOrigins = ['tauri://localhost', 'http://tauri.localhost/', 'https://tauri.localhost/'];
const allowedCommands = [
  'get_settings',
  'test_connection',
  'save_connection',
  'clear_connection',
  'set_display_preferences',
  'list_bookmarks',
  'list_tags',
  'create_bookmark',
  'mark_read',
  'replace_bookmark_tags',
  'archive_bookmark',
  'unarchive_bookmark',
  'delete_bookmark',
  'open_external_url',
];

function isBundledOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'tauri:' && url.hostname === 'localhost') ||
      ((url.protocol === 'http:' || url.protocol === 'https:') &&
        url.hostname === 'tauri.localhost')
    );
  } catch {
    return false;
  }
}

describe('packaged security assumptions', () => {
  it('recognizes only the bundled application origins', () => {
    for (const origin of bundledOrigins) expect(isBundledOrigin(origin)).toBe(true);

    expect(isBundledOrigin('https://example.com/')).toBe(false);
    expect(isBundledOrigin('http://127.0.0.1:1420/')).toBe(false);
  });

  it('does not treat external Linkding URLs as renderer network origins', () => {
    expect(isBundledOrigin('https://bookmarks.example/api/')).toBe(false);
    expect(isBundledOrigin('http://localhost:9090/linkding/')).toBe(false);
  });

  it('pins the packaged policy to the narrow main capability', () => {
    const security = tauriConfig.app.security;
    expect(security.capabilities).toEqual(['main-capability']);
    expect(mainCapability.windows).toEqual(['main']);
    expect(mainCapability).not.toHaveProperty('urls');
    expect(mainCapability.permissions).toEqual([
      'allow-linkdqueue-commands',
      'core:event:allow-listen',
      'core:event:allow-unlisten',
    ]);
    expect(mainCapability.permissions).not.toContain('core:default');
    expect(security.csp).not.toContain('unsafe-eval');
    expect(security.csp).not.toContain('unsafe-inline');
    expect(security.csp).not.toContain('https:');
    expect(security.csp).not.toContain('filesystem:');
    expect(security.csp).toContain('ipc:');
    expect(security.devCsp).toContain('http://127.0.0.1:1420');
    expect(security.devCsp).not.toEqual(security.csp);
  });

  it('authorizes exactly the typed commands and no generic capabilities', () => {
    const commands = (permissionSource.match(/^\s{2}"([a-z_]+)",?$/gm) ?? []).map(
      (line) => line.trim().split('"')[1],
    );
    expect(commands).toEqual(allowedCommands);
    expect(permissionSource).not.toMatch(/(shell|fs|http|sql|opener|default)/i);
  });

  it('renders hostile bookmark fields as inert text without remote resources', async () => {
    const hostile = '<img src="https://attacker.invalid/pixel" onerror="alert(1)">';
    const bookmark: Bookmark = {
      id: 99,
      url: 'https://bookmark.invalid/article',
      title: hostile,
      description: hostile,
      notes: hostile,
      website_title: hostile,
      website_description: hostile,
      web_archive_snapshot_url: 'https://attacker.invalid/archive',
      favicon_url: 'https://attacker.invalid/favicon.ico',
      preview_image_url: 'https://attacker.invalid/preview.png',
      is_archived: false,
      unread: true,
      shared: false,
      tag_names: [hostile, 'safe'],
      date_added: '2026-01-01',
      date_modified: null,
    };
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(BookmarkRow, { props: { bookmark, generation: 7, openExternalUrl } });

    expect(screen.getByRole('heading', { name: hostile })).toBeInTheDocument();
    expect(screen.getAllByText(`#${hostile}`)).toHaveLength(1);
    expect(document.querySelectorAll('script, img, iframe, object, embed, a')).toHaveLength(0);
    expect(document.body.textContent).toContain(hostile);
    expect(fetchSpy).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Open bookmark' }));
    expect(openExternalUrl).toHaveBeenCalledWith({ generation: 7, url: bookmark.url });
    fetchSpy.mockRestore();
  });
});
