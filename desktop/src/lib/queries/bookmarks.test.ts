import { describe, expect, it } from 'vitest';

import type { LinkdqueueBridge } from '../api/bridge';
import type { Bookmark } from '../api/types';
import type { BookmarkPage } from './bookmarks';
import {
  BOOKMARK_PAGE_LIMIT,
  BookmarkPager,
  BookmarkPaginationError,
  StaleBookmarkResponseError,
  createBookmarkQueryOptions,
} from './bookmarks';

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

const page = (ids: number[], next: string | null): BookmarkPage => ({
  generation: 7,
  data: { count: 45, next, previous: null, results: ids.map(bookmark) },
});

const filter = { generation: 7, scope: 'queue' as const };
const unusedCommand = async (): Promise<never> => {
  throw new Error('unused command in query test');
};

function bridgeFor(listBookmarks: LinkdqueueBridge['listBookmarks']): LinkdqueueBridge {
  return {
    getSettings: unusedCommand,
    testConnection: unusedCommand,
    saveConnection: unusedCommand,
    clearConnection: unusedCommand,
    setDisplayPreferences: unusedCommand,
    listBookmarks,
    listTags: unusedCommand,
    createBookmark: unusedCommand,
    markRead: unusedCommand,
    replaceBookmarkTags: unusedCommand,
    archiveBookmark: unusedCommand,
    unarchiveBookmark: unusedCommand,
    deleteBookmark: unusedCommand,
    openExternalUrl: unusedCommand,
  };
}

describe('bookmark pagination', () => {
  it('uses raw offsets and flattens overlaps without changing page requests', async () => {
    const calls: number[] = [];
    const bridge = bridgeFor(async (input) => {
      calls.push(input.offset);
      if (input.offset === 0)
        return page(
          Array.from({ length: 20 }, (_, id) => id + 1),
          '/next/20',
        );
      if (input.offset === 20) {
        return page(
          Array.from({ length: 20 }, (_, id) => id + 20),
          '/next/40',
        );
      }
      return page([41, 42, 43, 44, 45], null);
    });
    const pager = new BookmarkPager(bridge, filter);

    await pager.refresh();
    await pager.loadMore();
    await pager.loadMore();

    expect(calls).toEqual([0, 20, 40]);
    expect(pager.snapshot.rows).toHaveLength(44);
    expect(pager.snapshot.nextOffset).toBeNull();
  });

  it('allows only one in-flight next-page request', async () => {
    let resolvePage: ((value: BookmarkPage) => void) | undefined;
    const request = new Promise<BookmarkPage>((resolve) => {
      resolvePage = resolve;
    });
    let calls = 0;
    const bridge = bridgeFor(async () => {
      calls += 1;
      return request;
    });
    const pager = new BookmarkPager(bridge, filter);
    const first = pager.refresh();
    const duplicate = pager.loadMore();

    expect(calls).toBe(1);
    resolvePage?.(page([1], null));
    await first;
    await expect(duplicate).resolves.toMatchObject({ data: { results: [bookmark(1)] } });
  });

  it('retains loaded rows after a later-page failure and retries that offset', async () => {
    let attempts = 0;
    const bridge = bridgeFor(async (input) => {
      if (input.offset === 0) return page([1, 2], '/next/2');
      attempts += 1;
      if (attempts === 1) throw { code: 'network_error', message: 'hidden', retryable: true };
      return page([3], null);
    });
    const pager = new BookmarkPager(bridge, filter);

    await pager.refresh();
    await expect(pager.loadMore()).rejects.toMatchObject({ code: 'network_error' });
    expect(pager.snapshot.rows.map(({ id }) => id)).toEqual([1, 2]);
    expect(pager.snapshot.failedOffset).toBe(2);

    await pager.retryFailedPage();
    expect(pager.snapshot.rows.map(({ id }) => id)).toEqual([1, 2, 3]);
    expect(pager.snapshot.error).toBeNull();
  });

  it('retires responses across A-to-B-to-A filters', async () => {
    const pending: Array<{ query: string; resolve: (page: BookmarkPage) => void }> = [];
    const bridge = bridgeFor(
      (input) =>
        new Promise<BookmarkPage>((resolve) => {
          pending.push({ query: input.query ?? '', resolve });
        }),
    );
    const pager = new BookmarkPager(bridge, { ...filter, query: 'A' });
    const firstA = pager.refresh();
    const b = pager.setFilter({ ...filter, query: 'B' });
    const secondA = pager.setFilter({ ...filter, query: 'A' });

    pending[0]?.resolve(page([1], null));
    pending[1]?.resolve(page([2], null));
    pending[2]?.resolve(page([3], null));

    await expect(firstA).rejects.toBeInstanceOf(StaleBookmarkResponseError);
    await expect(b).rejects.toBeInstanceOf(StaleBookmarkResponseError);
    await secondA;
    expect(pager.snapshot.rows.map(({ id }) => id)).toEqual([3]);
  });

  it('disables queries until a valid ready generation and fixes the page limit', async () => {
    let received: number | undefined;
    const bridge = bridgeFor(async (input) => {
      received = input.limit;
      return page([], null);
    });
    const options = createBookmarkQueryOptions(bridge, filter, true);
    const disabled = createBookmarkQueryOptions(bridge, { ...filter, generation: 0 }, false);

    await options.queryFn({ pageParam: 0 });

    expect(received).toBe(BOOKMARK_PAGE_LIMIT);
    expect(options.queryKey).toEqual(['account', 7, 'bookmarks', 'queue', null, null]);
    expect(options.enabled).toBe(true);
    expect(disabled.enabled).toBe(false);
    expect(options.retry).toBe(false);
  });

  it('retires a response whose envelope belongs to another generation', async () => {
    const bridge = bridgeFor(async () => ({ ...page([1], null), generation: 8 }));
    const options = createBookmarkQueryOptions(bridge, filter, true);

    await expect(options.queryFn({ pageParam: 0 })).rejects.toBeInstanceOf(
      StaleBookmarkResponseError,
    );
  });

  it('reports a page containing no new IDs instead of looping', async () => {
    const bridge = bridgeFor(async (input) => {
      if (input.offset === 0) return page([1], '/next/1');
      return page([1], '/next/2');
    });
    const pager = new BookmarkPager(bridge, filter);

    await pager.refresh();
    await expect(pager.loadMore()).rejects.toBeInstanceOf(BookmarkPaginationError);
    expect(pager.snapshot.rows.map(({ id }) => id)).toEqual([1]);
    expect(pager.snapshot.failedOffset).toBe(1);
  });
});
