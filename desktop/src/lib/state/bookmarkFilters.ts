import type { BookmarkFilter } from '../queries/bookmarks';
import type { BookmarkScope, Generation } from '../api/types';

export const BOOKMARK_SEARCH_DEBOUNCE_MS = 300;

export function unsupportedTagMessage(tag: string): string | null {
  return /[\s(),"]/.test(tag)
    ? `Tag “${tag}” cannot be searched because tags may not contain spaces, commas, parentheses, or quotes.`
    : null;
}

export function sameBookmarkFilter(left: BookmarkFilter, right: BookmarkFilter): boolean {
  return (
    left.generation === right.generation &&
    left.scope === right.scope &&
    (left.query ?? '') === (right.query ?? '') &&
    (left.tag ?? '') === (right.tag ?? '')
  );
}

/** Debounced filter controller. Navigation remains the owner of settled values. */
export function createBookmarkFilters(
  initial: { generation: Generation; scope: BookmarkScope; query?: string; tag?: string },
  onSettled: (filter: BookmarkFilter) => void,
) {
  let filter: BookmarkFilter = { ...initial, query: initial.query || undefined };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const publish = (next: BookmarkFilter) => {
    if (sameBookmarkFilter(filter, next)) return;
    filter = next;
    onSettled(next);
  };
  return {
    get filter() {
      return filter;
    },
    setQuery(query: string) {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        publish({ ...filter, query: query.trim() || undefined });
      }, BOOKMARK_SEARCH_DEBOUNCE_MS);
    },
    setContext(generation: Generation, scope: BookmarkScope, tag?: string) {
      cancel();
      publish({ ...filter, generation, scope, tag });
    },
    setTag(tag?: string) {
      const message = tag ? unsupportedTagMessage(tag) : null;
      if (message) throw new Error(message);
      publish({ ...filter, tag });
    },
    clearTag() {
      publish({ ...filter, tag: undefined });
    },
    cancel,
    destroy: cancel,
  };
}
