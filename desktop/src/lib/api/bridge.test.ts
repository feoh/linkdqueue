import { describe, expect, it } from 'vitest';

import { createTauriBridge, type Invoke } from './bridge';
import type { BookmarkIdInput, Generation } from './types';

const generation: Generation = 9;
const bookmarkInput: BookmarkIdInput = { generation, bookmarkId: 42 };

function recordingInvoke() {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const invoke: Invoke = async <T>(command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    return {} as T;
  };
  return { calls, invoke };
}

describe('typed Tauri bridge', () => {
  it('uses the exact Rust command names and camelCase arguments', async () => {
    const { calls, invoke } = recordingInvoke();
    const bridge = createTauriBridge(invoke);

    await bridge.getSettings();
    await bridge.testConnection({ baseUrl: 'https://example.invalid', newToken: 'draft-token' });
    await bridge.saveConnection({ baseUrl: 'https://example.invalid', retainExistingToken: true });
    await bridge.clearConnection({ generation });
    await bridge.setDisplayPreferences({ generation, theme: 'system', textScale: 1 });
    await bridge.listBookmarks({ generation, scope: 'queue', offset: 0 });
    await bridge.listTags({ generation, offset: 0 });
    await bridge.createBookmark({ generation, url: 'https://bookmark.invalid', tagNames: ['tag'] });
    await bridge.markRead({ ...bookmarkInput, isRead: true });
    await bridge.replaceBookmarkTags({ ...bookmarkInput, tagNames: ['tag'] });
    await bridge.archiveBookmark(bookmarkInput);
    await bridge.unarchiveBookmark(bookmarkInput);
    await bridge.deleteBookmark(bookmarkInput);
    await bridge.openExternalUrl({ generation, url: 'https://bookmark.invalid/article#part' });

    expect(calls.map(({ command }) => command)).toEqual([
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
    ]);
    expect(calls[7]?.args).toEqual({
      generation,
      url: 'https://bookmark.invalid',
      tagNames: ['tag'],
    });
    expect(calls[13]?.args).toEqual({
      generation,
      url: 'https://bookmark.invalid/article#part',
    });
  });

  it('normalizes rejected payloads without exposing the rejected message', async () => {
    const invoke: Invoke = async () => {
      throw {
        code: 'auth_failed',
        message: 'token-sentinel-must-not-escape',
        retryable: false,
        status: 401,
      };
    };
    const bridge = createTauriBridge(invoke);

    const error = await bridge.getSettings().then(
      () => null,
      (rejected: unknown) => rejected,
    );
    expect(error).toEqual({
      code: 'auth_failed',
      message: 'Linkding authentication failed.',
      retryable: false,
      status: 401,
    });
    expect(JSON.stringify(error)).not.toContain('token-sentinel');
  });
});
