import { QueryClient } from '@tanstack/svelte-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConfirmedMutation, LinkdqueueBridge } from './api/bridge';
import type { Bookmark, ListBookmarksInput, Settings } from './api/types';
import { BookmarkMutations } from './queries/mutations';
import { BookmarkPager, type BookmarkPage, StaleBookmarkResponseError } from './queries/bookmarks';
import { accountQueryKey } from './state/queryClient';
import { createSessionController } from './state/session';

const generation = 7;

const bookmark = (id: number, changes: Partial<Bookmark> = {}): Bookmark => ({
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
  tag_names: ['reading'],
  date_added: '2026-01-01T00:00:00Z',
  date_modified: null,
  website_title: null,
  website_description: null,
  ...changes,
});

const page = (ids: number[], next: string | null, pageGeneration = generation): BookmarkPage => ({
  generation: pageGeneration,
  data: {
    count: 45,
    next,
    previous: null,
    results: ids.map((id) => bookmark(id)),
  },
});

const unusedCommand = async (): Promise<never> => {
  throw new Error('unused command in regression test');
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

function readySettings(value: number): Settings {
  return {
    status: 'ready',
    canonicalBaseUrl: 'https://linkding.invalid',
    credentialStatus: 'available',
    errorCode: null,
    allowInsecureHttp: false,
    pendingCleanup: false,
    display: { theme: 'system', textScale: 1 },
    generation: value,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function pageForRecords(records: readonly Bookmark[], input: ListBookmarksInput): BookmarkPage {
  const limit = input.limit ?? 20;
  const results = records.slice(input.offset, input.offset + limit);
  const next =
    input.offset + results.length < records.length
      ? `/ignored/${input.offset + results.length}`
      : null;
  return {
    generation: input.generation,
    data: { count: records.length, next, previous: null, results },
  };
}

function ids(rows: readonly Bookmark[]) {
  return rows.map(({ id }) => id);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Q01 deterministic cross-layer regressions', () => {
  it('waits through delayed bootstrap without issuing a protected read', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const bridge = bridgeWith({
      getSettings: async () => {
        calls += 1;
        return calls === 1 ? { ...readySettings(0), status: 'initializing' } : readySettings(7);
      },
      listBookmarks: async () => {
        throw new Error('bookmark read must wait for bootstrap');
      },
    });
    const controller = createSessionController(bridge, new QueryClient());

    const bootstrap = controller.bootstrap();
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(25);

    await expect(bootstrap).resolves.toMatchObject({ kind: 'ready', generation: 7 });
    expect(calls).toBe(2);
    controller.destroy();
  });

  it('retires A-to-B-to-A and same-key refresh responses by revision', async () => {
    const pending: Array<{ query: string; finish: (result: BookmarkPage) => void }> = [];
    const bridge = bridgeWith({
      listBookmarks: (input) =>
        new Promise<BookmarkPage>((resolve) =>
          pending.push({ query: input.query ?? '', finish: resolve }),
        ),
    });
    const pager = new BookmarkPager(bridge, { generation, scope: 'queue', query: 'A' });

    const firstA = pager.refresh();
    const b = pager.setFilter({ generation, scope: 'queue', query: 'B' });
    const secondA = pager.setFilter({ generation, scope: 'queue', query: 'A' });
    pending[0]?.finish(page([1], null));
    pending[1]?.finish(page([2], null));
    pending[2]?.finish(page([3], null));

    await expect(firstA).rejects.toBeInstanceOf(StaleBookmarkResponseError);
    await expect(b).rejects.toBeInstanceOf(StaleBookmarkResponseError);
    await expect(secondA).resolves.toMatchObject({ data: { results: [bookmark(3)] } });
    expect(ids(pager.snapshot.rows)).toEqual([3]);

    const sameKeyFirst = pager.refresh();
    const sameKeySecond = pager.refresh();
    pending[3]?.finish(page([4], null));
    pending[4]?.finish(page([5], null));
    await expect(sameKeyFirst).rejects.toBeInstanceOf(StaleBookmarkResponseError);
    await expect(sameKeySecond).resolves.toMatchObject({ data: { results: [bookmark(5)] } });
    expect(ids(pager.snapshot.rows)).toEqual([5]);
  });

  it('discards a delayed page two after a same-identity refresh', async () => {
    const firstPage = deferred<BookmarkPage>();
    const delayedPageTwo = deferred<BookmarkPage>();
    const refreshedPage = deferred<BookmarkPage>();
    const calls: number[] = [];
    const bridge = bridgeWith({
      listBookmarks: (input) => {
        calls.push(input.offset);
        if (calls.length === 1) return firstPage.promise;
        if (calls.length === 2) return delayedPageTwo.promise;
        return refreshedPage.promise;
      },
    });
    const pager = new BookmarkPager(bridge, { generation, scope: 'queue' });

    const initial = pager.refresh();
    firstPage.resolve(
      page(
        Array.from({ length: 20 }, (_, index) => index + 1),
        '/next/20',
      ),
    );
    await initial;
    const pageTwo = pager.loadMore();
    const refreshed = pager.refresh();
    refreshedPage.resolve(page([101], null));
    await refreshed;
    delayedPageTwo.resolve(
      page(
        Array.from({ length: 20 }, (_, index) => index + 21),
        '/next/40',
      ),
    );

    await expect(pageTwo).rejects.toBeInstanceOf(StaleBookmarkResponseError);
    expect(calls).toEqual([0, 20, 0]);
    expect(ids(pager.snapshot.rows)).toEqual([101]);
  });

  it.each([
    ['delete', 40, 'delete'] as const,
    ['read', 45, 'markRead'] as const,
    ['archive', 40, 'archive'] as const,
    ['unarchive', 45, 'unarchive'] as const,
    ['tag removal', 45, 'replaceBookmarkTags'] as const,
  ])('refreshes every page after %s at the page boundary', async (_name, target, operation) => {
    let records = Array.from({ length: 45 }, (_, index) => bookmark(index + 1));
    const calls: number[] = [];
    const bridge = bridgeWith({
      listBookmarks: async (input) => {
        calls.push(input.offset);
        return pageForRecords(records, input);
      },
      deleteBookmark: async (input) => {
        records = records.filter(({ id }) => id !== input.bookmarkId);
        return {
          generation: input.generation,
          data: { confirmed: true } satisfies ConfirmedMutation,
        };
      },
      markRead: async (input) => {
        const updated = bookmark(input.bookmarkId, { unread: !input.isRead });
        records = records.filter(({ id }) => id !== input.bookmarkId);
        return { generation: input.generation, data: updated };
      },
      archiveBookmark: async (input) => {
        records = records.filter(({ id }) => id !== input.bookmarkId);
        return {
          generation: input.generation,
          data: { confirmed: true } satisfies ConfirmedMutation,
        };
      },
      unarchiveBookmark: async (input) => {
        records = records.filter(({ id }) => id !== input.bookmarkId);
        return {
          generation: input.generation,
          data: { confirmed: true } satisfies ConfirmedMutation,
        };
      },
      replaceBookmarkTags: async (input) => {
        records =
          input.tagNames.length === 0
            ? records.filter(({ id }) => id !== input.bookmarkId)
            : records.map((item) =>
                item.id === input.bookmarkId ? { ...item, tag_names: input.tagNames } : item,
              );
        return {
          generation: input.generation,
          data: bookmark(input.bookmarkId, { tag_names: input.tagNames }),
        };
      },
    });
    const pager = new BookmarkPager(bridge, { generation, scope: 'queue', tag: 'reading' });
    const queryClient = new QueryClient();
    const mutations = new BookmarkMutations(
      bridge,
      queryClient,
      () => generation,
      async () => {
        await pager.refresh();
      },
    );

    await pager.refresh();
    while (pager.snapshot.nextOffset !== null) await pager.loadMore();
    const beforeMutation = calls.length;
    const result =
      operation === 'delete'
        ? await mutations.delete(target)
        : operation === 'markRead'
          ? await mutations.markRead(target, true)
          : operation === 'archive'
            ? await mutations.archive(target)
            : operation === 'unarchive'
              ? await mutations.unarchive(target)
              : await mutations.replaceBookmarkTags(target, []);

    expect(result.status).toBe('confirmed');
    while (pager.snapshot.nextOffset !== null) await pager.loadMore();
    const expected = records.map(({ id }) => id);
    expect(ids(pager.snapshot.rows)).toEqual(expected);
    expect(pager.snapshot.rows).toHaveLength(expected.length);
    expect(new Set(ids(pager.snapshot.rows)).size).toBe(expected.length);
    expect(calls.slice(beforeMutation)).toEqual([0, 20, 40]);
  });

  it('clears the authenticated cache before a controlled account disconnect completes', async () => {
    const clear = deferred<{
      disconnected: true;
      durable: true;
      cleanupPending: false;
      warning: null;
    }>();
    let settingsCalls = 0;
    const queryClient = new QueryClient();
    let cacheWasRetiredBeforeNativeClear = false;
    const bridge = bridgeWith({
      getSettings: async () => {
        settingsCalls += 1;
        return settingsCalls === 1
          ? readySettings(1)
          : {
              ...readySettings(2),
              status: 'unconfigured',
              canonicalBaseUrl: null,
              credentialStatus: null,
            };
      },
      clearConnection: async () => {
        cacheWasRetiredBeforeNativeClear =
          queryClient.getQueryData(accountQueryKey(1, 'bookmarks')) === undefined;
        return clear.promise;
      },
    });
    queryClient.setQueryData(accountQueryKey(1, 'bookmarks'), ['old-account']);
    const controller = createSessionController(bridge, queryClient);
    await controller.bootstrap();

    const disconnecting = controller.clearConnection({ generation: 1 });
    clear.resolve({ disconnected: true, durable: true, cleanupPending: false, warning: null });

    await expect(disconnecting).resolves.toMatchObject({ disconnected: true, durable: true });
    expect(cacheWasRetiredBeforeNativeClear).toBe(true);
    expect(settingsCalls).toBe(2);
    controller.destroy();
  });

  it('keeps the current account cache clean when old-account writes finish or reject late', async () => {
    let activeGeneration: number | null = 1;
    const success = deferred<{ generation: number; data: Bookmark }>();
    const failure = deferred<{ generation: number; data: Bookmark }>();
    let writes = 0;
    const bridge = bridgeWith({
      markRead: () => {
        writes += 1;
        return writes === 1 ? success.promise : failure.promise;
      },
    });
    const queryClient = new QueryClient();
    queryClient.setQueryData(accountQueryKey(2, 'bookmarks'), ['current-account']);
    const refetchActive = vi.fn(async () => undefined);
    const mutations = new BookmarkMutations(
      bridge,
      queryClient,
      () => activeGeneration,
      refetchActive,
    );

    const oldSuccess = mutations.markRead(1, true);
    activeGeneration = 2;
    success.resolve({ generation: 1, data: bookmark(1, { unread: false }) });
    await expect(oldSuccess).resolves.toMatchObject({ status: 'stale' });
    expect(refetchActive).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(accountQueryKey(2, 'bookmarks'))).toEqual(['current-account']);

    activeGeneration = 1;
    const oldError = mutations.markRead(2, true);
    activeGeneration = 2;
    failure.reject({ code: 'network_error', message: 'old account failed', retryable: true });
    await expect(oldError).resolves.toMatchObject({ status: 'failed' });
    expect(refetchActive).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(accountQueryKey(2, 'bookmarks'))).toEqual(['current-account']);
  });

  it('distinguishes confirmed-write refresh failure, rejection, and unknown timeout', async () => {
    const syncFailed = new BookmarkMutations(
      bridgeWith({
        archiveBookmark: async () => ({
          generation,
          data: { confirmed: true } satisfies ConfirmedMutation,
        }),
      }),
      new QueryClient(),
      () => generation,
      async () => {
        throw { code: 'network_error', message: 'refresh failed', retryable: true };
      },
    );
    await expect(syncFailed.archive(1)).resolves.toMatchObject({ status: 'sync-failed' });

    const rejected = new BookmarkMutations(
      bridgeWith({
        markRead: async () => {
          throw { code: 'auth_failed', message: 'rejected', retryable: false };
        },
      }),
      new QueryClient(),
      () => generation,
    );
    await expect(rejected.markRead(1, true)).resolves.toMatchObject({ status: 'failed' });

    const unknown = new BookmarkMutations(
      bridgeWith({
        deleteBookmark: async () => {
          throw { code: 'timeout_unknown_outcome', message: 'timed out', retryable: true };
        },
      }),
      new QueryClient(),
      () => generation,
    );
    await expect(unknown.delete(1)).resolves.toMatchObject({ status: 'unknown-outcome' });
  });

  it('uses a controlled bootstrap retry and keeps settings reachable after display changes', async () => {
    const displayWrite = deferred<Settings>();
    const bridge = bridgeWith({
      getSettings: async () => readySettings(generation),
      setDisplayPreferences: async () => displayWrite.promise,
    });
    const queryClient = new QueryClient();
    const controller = createSessionController(bridge, queryClient);
    await controller.bootstrap();
    const pendingDisplay = controller.setDisplayPreferences({
      generation,
      theme: 'dracula',
      textScale: 1.5,
    });
    displayWrite.resolve({
      ...readySettings(generation),
      display: { theme: 'dracula', textScale: 1.5 },
    });
    await expect(pendingDisplay).resolves.toMatchObject({
      display: { theme: 'dracula', textScale: 1.5 },
    });
    controller.destroy();
  });
});
