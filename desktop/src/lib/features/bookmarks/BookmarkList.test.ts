import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LinkdqueueBridge } from '../../api/bridge';
import type { Bookmark, CommandEnvelope, Page } from '../../api/types';
import BookmarkList from './BookmarkList.svelte';
import type { BookmarkActionMutations } from './bookmarkActions';

type BookmarkPage = CommandEnvelope<Page<Bookmark>>;

const bookmark: Bookmark = {
  id: 1,
  url: 'https://example.test/article',
  title: 'Article',
  description: 'Description',
  website_title: null,
  website_description: null,
  notes: '',
  web_archive_snapshot_url: null,
  favicon_url: null,
  preview_image_url: null,
  is_archived: false,
  unread: true,
  shared: false,
  tag_names: ['tag'],
  date_added: '2026-01-01',
  date_modified: null,
};

function page(results: Bookmark[], next: string | null = null): BookmarkPage {
  return { generation: 1, data: { count: results.length, next, previous: null, results } };
}

function bridge(listBookmarks: LinkdqueueBridge['listBookmarks']): LinkdqueueBridge {
  return { listBookmarks } as LinkdqueueBridge;
}

let observer: { trigger: () => void };

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void;
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        this.callback = callback;
        observer = { trigger: () => callback([{ isIntersecting: true }]) };
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

const actionMutations = (): BookmarkActionMutations => ({
  markRead: vi.fn().mockResolvedValue({ status: 'confirmed', data: bookmark }),
  archive: vi.fn().mockResolvedValue({ status: 'confirmed', data: { confirmed: true } }),
  unarchive: vi.fn().mockResolvedValue({ status: 'confirmed', data: { confirmed: true } }),
  delete: vi.fn().mockResolvedValue({ status: 'confirmed', data: { confirmed: true } }),
});

describe('BookmarkList', () => {
  it('shows distinct initial loading and true-empty/no-match states', async () => {
    let resolve: (value: BookmarkPage) => void = () => undefined;
    const pending = new Promise<BookmarkPage>((next) => (resolve = next));
    const listBookmarks = vi.fn().mockReturnValue(pending);
    const { unmount } = render(BookmarkList, {
      props: { bridge: bridge(listBookmarks), generation: 1, scope: 'queue' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Loading bookmarks');
    resolve(page([]));
    await waitFor(() =>
      expect(screen.getByText('Your reading queue is empty.')).toBeInTheDocument(),
    );
    unmount();

    render(BookmarkList, {
      props: {
        bridge: bridge(vi.fn().mockResolvedValue(page([]))),
        generation: 1,
        scope: 'queue',
        query: 'missing',
      },
    });
    await waitFor(() =>
      expect(screen.getByText('No bookmarks match your search.')).toBeInTheDocument(),
    );
  });

  it('shows an accessible initial-load error and retries successfully into rows', async () => {
    const listBookmarks = vi
      .fn()
      .mockRejectedValueOnce(new Error('initial page failed'))
      .mockResolvedValueOnce(page([bookmark]));
    render(BookmarkList, {
      props: { bridge: bridge(listBookmarks), generation: 1, scope: 'queue' },
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('initial page failed');
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry).toBeInTheDocument();
    await fireEvent.click(retry);
    await screen.findByRole('heading', { name: 'Article' });
    expect(listBookmarks).toHaveBeenCalledTimes(2);
  });

  it('renders semantic rows, accessible opener controls, and an end-of-list state', async () => {
    const listBookmarks = vi.fn().mockResolvedValue(page([bookmark]));
    render(BookmarkList, {
      props: { bridge: bridge(listBookmarks), generation: 1, scope: 'queue' },
    });
    await screen.findByRole('heading', { name: 'Article' });
    expect(screen.getByRole('region', { name: 'Bookmarks' })).toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open bookmark' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('End of list.');
  });

  it('preserves rows during later-page loading and error, then retries', async () => {
    let rejectSecond: (error: Error) => void = () => undefined;
    let resolveRetry: (value: BookmarkPage) => void = () => undefined;
    const second = new Promise<BookmarkPage>((_, reject) => (rejectSecond = reject));
    const retry = new Promise<BookmarkPage>((resolve) => (resolveRetry = resolve));
    const listBookmarks = vi
      .fn()
      .mockResolvedValueOnce(page([bookmark], '/next'))
      .mockReturnValueOnce(second)
      .mockReturnValueOnce(retry);
    render(BookmarkList, {
      props: { bridge: bridge(listBookmarks), generation: 1, scope: 'queue' },
    });
    await screen.findByRole('heading', { name: 'Article' });
    await fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading more bookmarks');
    rejectSecond(new Error('page failed'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('page failed'));
    expect(screen.getByRole('heading', { name: 'Article' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    resolveRetry(page([{ ...bookmark, id: 2, title: 'Retried article' }]));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('End of list.'));
    expect(listBookmarks).toHaveBeenCalledTimes(3);
  });

  it('shows Queue and Archive action matrices for their bookmark states', async () => {
    const listBookmarks = vi.fn().mockResolvedValue(page([bookmark]));
    const queue = render(BookmarkList, {
      props: {
        bridge: bridge(listBookmarks),
        generation: 1,
        scope: 'queue',
        mutations: actionMutations(),
      },
    });
    await screen.findByRole('heading', { name: 'Article' });
    expect(screen.getByRole('button', { name: 'Mark as read' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unarchive' })).not.toBeInTheDocument();
    queue.unmount();

    render(BookmarkList, {
      props: {
        bridge: bridge(vi.fn().mockResolvedValue(page([{ ...bookmark, is_archived: true }]))),
        generation: 1,
        scope: 'archive',
        mutations: actionMutations(),
      },
    });
    await screen.findByRole('heading', { name: 'Article' });
    expect(screen.getByRole('button', { name: 'Mark as read' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unarchive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit tags' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete bookmark' })).toBeInTheDocument();
  });

  it('shares one guarded load between the sentinel and keyboard Load more', async () => {
    let resolveSecond: (value: BookmarkPage) => void = () => undefined;
    const second = new Promise<BookmarkPage>((resolve) => (resolveSecond = resolve));
    const listBookmarks = vi
      .fn()
      .mockResolvedValueOnce(page([bookmark], '/next'))
      .mockReturnValueOnce(second);
    render(BookmarkList, {
      props: { bridge: bridge(listBookmarks), generation: 1, scope: 'queue' },
    });
    await screen.findByRole('heading', { name: 'Article' });

    await fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    observer.trigger();
    expect(listBookmarks).toHaveBeenCalledTimes(2);
    resolveSecond(page([{ ...bookmark, id: 2, title: 'Second article' }]));
    await screen.findByRole('heading', { name: 'Second article' });
  });
});
