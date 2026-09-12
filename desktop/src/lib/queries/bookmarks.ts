import type { LinkdqueueBridge } from '../api/bridge';
import type {
  Bookmark,
  BookmarkScope,
  CommandEnvelope,
  Generation,
  ListBookmarksInput,
  Page,
} from '../api/types';
import { accountQueryKey, type AccountQueryKey } from '../state/queryClient';

export const BOOKMARK_PAGE_LIMIT = 20;

export type BookmarkFilter = {
  generation: Generation;
  scope: BookmarkScope;
  query?: string;
  tag?: string;
};

export type BookmarkPage = CommandEnvelope<Page<Bookmark>>;
export type BookmarkQueryData = { pages: BookmarkPage[]; pageParams: number[] };

export function bookmarkQueryKey(filter: BookmarkFilter): AccountQueryKey {
  return accountQueryKey(
    filter.generation,
    'bookmarks',
    filter.scope,
    filter.query ?? null,
    filter.tag ?? null,
  );
}

export class BookmarkPaginationError extends Error {
  readonly code = 'pagination_protocol';

  constructor(message: string) {
    super(message);
    this.name = 'BookmarkPaginationError';
  }
}

function nextOffset(
  page: BookmarkPage,
  offset: number,
  previousPages: readonly BookmarkPage[],
): number | null {
  const rawCount = page.data.results.length;
  if (rawCount === 0 || page.data.next === null) return null;

  const candidate = offset + rawCount;
  if (candidate <= offset || previousPages.some((previous) => previous.data.results.length === 0)) {
    throw new BookmarkPaginationError('Linkding returned a non-advancing page offset.');
  }
  return candidate;
}

function hasNewBookmarkIds(page: BookmarkPage, previousPages: readonly BookmarkPage[]): boolean {
  const seen = new Set<number>();
  for (const previous of previousPages) {
    for (const { id } of previous.data.results) seen.add(id);
  }
  return page.data.results.some(({ id }) => !seen.has(id));
}

export class StaleBookmarkResponseError extends Error {
  constructor() {
    super('The bookmark response is no longer current.');
    this.name = 'StaleBookmarkResponseError';
  }
}

function ensureGeneration(page: BookmarkPage, generation: Generation): BookmarkPage {
  if (page.generation !== generation) throw new StaleBookmarkResponseError();
  return page;
}

/** Options for useInfiniteQuery; page parameters are always numeric offsets. */
export function createBookmarkQueryOptions(
  bridge: LinkdqueueBridge,
  filter: BookmarkFilter,
  enabled: boolean,
) {
  return {
    queryKey: bookmarkQueryKey(filter),
    queryFn: async ({ pageParam }: { pageParam: number }) =>
      ensureGeneration(
        await bridge.listBookmarks({
          generation: filter.generation,
          scope: filter.scope,
          query: filter.query,
          tag: filter.tag,
          offset: pageParam,
          limit: BOOKMARK_PAGE_LIMIT,
        }),
        filter.generation,
      ),
    initialPageParam: 0,
    getNextPageParam: (
      lastPage: BookmarkPage,
      allPages: BookmarkPage[],
      lastPageParam: number,
    ): number | undefined => {
      if (lastPage.data.results.length > 0 && !hasNewBookmarkIds(lastPage, allPages.slice(0, -1))) {
        throw new BookmarkPaginationError('Linkding returned no new bookmark IDs.');
      }
      return nextOffset(lastPage, lastPageParam, allPages.slice(0, -1)) ?? undefined;
    },
    enabled: enabled && Number.isSafeInteger(filter.generation) && filter.generation >= 0,
    retry: false,
  };
}

export type BookmarkPagerSnapshot = {
  pages: BookmarkPage[];
  rows: Bookmark[];
  nextOffset: number | null;
  failedOffset: number | null;
  error: unknown;
  revision: number;
};

/**
 * A small imperative seam for tests and non-component consumers. It gives the
 * same offset and race rules as the infinite-query options without requiring a
 * Tauri runtime or a mounted Svelte component.
 */
export class BookmarkPager {
  private filter: BookmarkFilter;
  private pages: Array<{ offset: number; page: BookmarkPage }> = [];
  private inFlight: Promise<BookmarkPage> | null = null;
  private failedOffset: number | null = null;
  private currentError: unknown = null;
  private revision = 0;

  constructor(
    private readonly bridge: LinkdqueueBridge,
    filter: BookmarkFilter,
  ) {
    this.filter = filter;
  }

  get snapshot(): BookmarkPagerSnapshot {
    const seen = new Set<number>();
    const rows: Bookmark[] = [];
    for (const { page } of this.pages) {
      for (const bookmark of page.data.results) {
        if (seen.has(bookmark.id)) continue;
        seen.add(bookmark.id);
        rows.push(bookmark);
      }
    }
    return {
      pages: this.pages.map(({ page }) => page),
      rows,
      nextOffset: this.nextPageOffset(),
      failedOffset: this.failedOffset,
      error: this.currentError,
      revision: this.revision,
    };
  }

  async refresh(): Promise<BookmarkPage> {
    this.revision += 1;
    this.pages = [];
    this.failedOffset = null;
    this.currentError = null;
    return this.requestPage(0, this.revision);
  }

  async setFilter(filter: BookmarkFilter): Promise<BookmarkPage> {
    this.filter = filter;
    return this.refresh();
  }

  loadMore(): Promise<BookmarkPage | null> {
    if (this.currentError || this.inFlight) return this.inFlight ?? Promise.resolve(null);
    const offset = this.nextPageOffset();
    if (offset === null) return Promise.resolve(null);
    return this.requestPage(offset, this.revision);
  }

  retryFailedPage(): Promise<BookmarkPage | null> {
    if (this.inFlight) return this.inFlight;
    if (this.failedOffset === null) return Promise.resolve(null);
    return this.requestPage(this.failedOffset, this.revision);
  }

  private nextPageOffset(): number | null {
    if (this.pages.length === 0) return 0;
    const last = this.pages[this.pages.length - 1];
    return nextOffset(
      last.page,
      last.offset,
      this.pages.map(({ page }) => page),
    );
  }

  private requestPage(offset: number, revision: number): Promise<BookmarkPage> {
    const request = this.bridge.listBookmarks({
      generation: this.filter.generation,
      scope: this.filter.scope,
      query: this.filter.query,
      tag: this.filter.tag,
      offset,
      limit: BOOKMARK_PAGE_LIMIT,
    });
    const result = request
      .then((page) => {
        if (revision !== this.revision) throw new StaleBookmarkResponseError();
        ensureGeneration(page, this.filter.generation);
        const previousPages = this.pages.map(({ page: previous }) => previous);
        if (page.data.results.length > 0 && !hasNewBookmarkIds(page, previousPages)) {
          throw new BookmarkPaginationError('Linkding returned no new bookmark IDs.');
        }
        nextOffset(page, offset, previousPages);
        this.pages = [
          ...this.pages.filter((entry) => entry.offset !== offset),
          { offset, page },
        ].sort((left, right) => left.offset - right.offset);
        this.failedOffset = null;
        this.currentError = null;
        return page;
      })
      .catch((error: unknown) => {
        if (revision === this.revision && !(error instanceof StaleBookmarkResponseError)) {
          this.failedOffset = offset;
          this.currentError = error;
        }
        throw error;
      })
      .then(
        (page) => {
          if (this.inFlight === result) this.inFlight = null;
          return page;
        },
        (error: unknown) => {
          if (this.inFlight === result) this.inFlight = null;
          throw error;
        },
      );
    this.inFlight = result;
    return result;
  }
}

export type BookmarkListInput = ListBookmarksInput;
