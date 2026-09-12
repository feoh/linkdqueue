import { describe, expect, it } from 'vitest';

import { createNavigationState, decodeNavigationHash, encodeNavigationHash } from './navigation';

describe('navigation state', () => {
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

  it('keeps search ephemeral while route filters are hash-backed', () => {
    const navigation = createNavigationState('#/archive?scope=archive');
    const values = [] as Array<ReturnType<typeof decodeNavigationHash>>;
    const unsubscribe = navigation.subscribe((value) => values.push(value));

    navigation.setSearch('temporary query');
    expect(values[values.length - 1]).toEqual({
      view: 'archive',
      scope: 'archive',
      tag: null,
      search: 'temporary query',
    });
    expect(encodeNavigationHash(values[values.length - 1]!)).toBe('#/archive?scope=archive');

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
