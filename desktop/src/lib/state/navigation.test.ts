import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createNavigationState, decodeNavigationHash, encodeNavigationHash } from './navigation';

describe('navigation state', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('round-trips Unicode and URL punctuation in tag filters', () => {
    const tag = 'Café #1 & design';
    const hash = encodeNavigationHash({ view: 'all-tagged', scope: null, tag });

    expect(hash).toContain('tag=Caf%C3%A9+%231+%26+design');
    expect(decodeNavigationHash(hash)).toEqual({
      view: 'all-tagged',
      scope: null,
      tag,
      search: '',
    });
  });

  it('restores the effective search when navigating back', () => {
    const navigation = createNavigationState('#/queue?scope=queue&q=first');
    const values: string[] = [];
    const unsubscribe = navigation.subscribe((value) => values.push(value.search));
    window.history.pushState({}, '', '#/queue?scope=queue&q=second');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(values[values.length - 1]).toBe('second');
    unsubscribe();
    navigation.destroy();
  });

  it('debounces search and persists settled filter state', () => {
    const navigation = createNavigationState('#/archive?scope=archive');
    const values = [] as Array<ReturnType<typeof decodeNavigationHash>>;
    const unsubscribe = navigation.subscribe((value) => values.push(value));

    navigation.setSearch('temporary query');
    expect(values[values.length - 1]!.search).toBe('');
    vi.advanceTimersByTime(300);
    expect(values[values.length - 1]).toEqual({
      view: 'archive',
      scope: 'archive',
      tag: null,
      search: 'temporary query',
    });
    expect(encodeNavigationHash(values[values.length - 1]!)).toBe(
      '#/archive?scope=archive&q=temporary+query',
    );

    navigation.set({ view: 'tags', scope: null, tag: null });
    expect(values[values.length - 1]).toEqual({
      view: 'tags',
      scope: null,
      tag: null,
      search: 'temporary query',
    });

    unsubscribe();
    navigation.destroy();
  });
});
