import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBookmarkFilters, unsupportedTagMessage } from './bookmarkFilters';

describe('BookmarkFilters', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('settles search after 300ms and cancels superseded/context changes', () => {
    const settled: string[] = [];
    const filters = createBookmarkFilters({ generation: 1, scope: 'queue' }, (filter) => {
      settled.push(filter.query ?? '');
    });
    filters.setQuery('old');
    filters.setQuery('new');
    vi.advanceTimersByTime(299);
    expect(settled).toEqual([]);
    filters.setContext(2, 'archive');
    vi.advanceTimersByTime(1);
    expect(settled).toEqual(['']);
    filters.destroy();
  });

  it('rejects unrepresentable tags with an actionable message', () => {
    expect(unsupportedTagMessage('design systems')).toContain('cannot be searched');
    expect(unsupportedTagMessage('design')).toBeNull();
  });
});
