import { QueryClient } from '@tanstack/svelte-query';
import { describe, expect, it } from 'vitest';

import type { ConfirmedMutation, LinkdqueueBridge } from '../api/bridge';
import type { Bookmark } from '../api/types';
import { accountQueryKey } from '../state/queryClient';
import { BookmarkMutations, type MutationResult } from './mutations';

const bookmark = (id: number): Bookmark => ({
  id,
  url: `https://bookmark.invalid/${id}`,
  title: `Bookmark ${id}`,
  description: '',
  notes: '',
  web_archive_snapshot_url: null,
  favicon_url: null,
  preview_image_url: null,
  is_archived: false,
  unread: true,
  shared: false,
  tag_names: [],
  date_added: '2026-01-01T00:00:00Z',
  date_modified: null,
  website_title: null,
  website_description: null,
});

const bookmarkResponse = (generation: number, id = 1) => ({ generation, data: bookmark(id) });
const confirmedResponse = (generation: number, confirmed = true) => ({
  generation,
  data: { confirmed } satisfies ConfirmedMutation,
});
const unusedCommand = async (): Promise<never> => {
  throw new Error('unused command in mutation test');
};

function bridgeWith(overrides: Partial<LinkdqueueBridge>): LinkdqueueBridge {
  return {
    getSettings: unusedCommand,
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
    ...overrides,
  };
}

describe('confirmed bookmark mutations', () => {
  it('deduplicates two clicks and reconciles bookmark and tag caches', async () => {
    let calls = 0;
    let resolveWrite: ((value: ReturnType<typeof bookmarkResponse>) => void) | undefined;
    const bridge = bridgeWith({
      replaceBookmarkTags: () => {
        calls += 1;
        return new Promise((resolve) => {
          resolveWrite = resolve;
        });
      },
    });
    const queryClient = new QueryClient();
    queryClient.setQueryData(accountQueryKey(1, 'bookmarks'), ['old']);
    queryClient.setQueryData(accountQueryKey(1, 'tags'), ['old']);
    let refetches = 0;
    const mutations = new BookmarkMutations(
      bridge,
      queryClient,
      () => 1,
      async () => {
        refetches += 1;
      },
    );

    const first = mutations.replaceBookmarkTags(4, ['reading']);
    const duplicate = mutations.replaceBookmarkTags(4, ['different']);
    expect(calls).toBe(1);
    resolveWrite?.(bookmarkResponse(1, 4));

    const result = await first;
    expect(duplicate).toBe(first);
    expect(result).toMatchObject({ status: 'confirmed', data: { id: 4 } });
    expect(refetches).toBe(1);
    expect(queryClient.getQueryData(accountQueryKey(1, 'bookmarks'))).toBeUndefined();
    expect(queryClient.getQueryData(accountQueryKey(1, 'tags'))).toBeUndefined();
  });

  it('does not report success after a failed or unknown-outcome write', async () => {
    const queryClient = new QueryClient();
    const failed = new BookmarkMutations(
      bridgeWith({
        markRead: async () => {
          throw { code: 'auth_failed', message: 'secret', retryable: false };
        },
      }),
      queryClient,
      () => 1,
    );
    const unknown = new BookmarkMutations(
      bridgeWith({
        markRead: async () => {
          throw { code: 'timeout_unknown_outcome', message: 'secret', retryable: true };
        },
      }),
      queryClient,
      () => 1,
    );

    await expect(failed.markRead(1, false)).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'auth_failed' },
    });
    await expect(unknown.markRead(1, false)).resolves.toMatchObject({
      status: 'unknown-outcome',
      error: { code: 'timeout_unknown_outcome' },
    });
  });

  it('ignores an old-account completion without touching current caches', async () => {
    let generation = 1;
    let resolveWrite: ((value: ReturnType<typeof bookmarkResponse>) => void) | undefined;
    let refetches = 0;
    const bridge = bridgeWith({
      markRead: () =>
        new Promise((resolve) => {
          resolveWrite = resolve;
        }),
    });
    const queryClient = new QueryClient();
    queryClient.setQueryData(accountQueryKey(2, 'bookmarks'), ['current']);
    const mutations = new BookmarkMutations(
      bridge,
      queryClient,
      () => generation,
      async () => {
        refetches += 1;
      },
    );

    const pending = mutations.markRead(1, false);
    generation = 2;
    resolveWrite?.(bookmarkResponse(1));

    await expect(pending).resolves.toMatchObject({ status: 'stale' });
    expect(refetches).toBe(0);
    expect(queryClient.getQueryData(accountQueryKey(2, 'bookmarks'))).toEqual(['current']);
  });

  it('labels confirmed write plus failed refetch as sync failure', async () => {
    const mutations = new BookmarkMutations(
      bridgeWith({
        archiveBookmark: async () => confirmedResponse(1),
      }),
      new QueryClient(),
      () => 1,
      async () => {
        throw { code: 'network_error', message: 'hidden', retryable: true };
      },
    );

    const result = await mutations.archive(1);

    expect(result).toMatchObject({ status: 'sync-failed', data: { confirmed: true } });
    expect(
      (result as Extract<MutationResult<ConfirmedMutation>, { status: 'sync-failed' }>).error.code,
    ).toBe('network_error');
  });
});
