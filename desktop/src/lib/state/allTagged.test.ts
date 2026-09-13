import { describe, expect, it } from 'vitest';
import { mergeTaggedBookmarks } from './allTagged';

describe('all-tagged results', () => {
  it('deduplicates bookmarks returned by queue and archive requests', () => {
    const bookmark = { id: 7 } as never;
    const other = { id: 8 } as never;
    expect(mergeTaggedBookmarks([[bookmark], [bookmark, other]])).toEqual([bookmark, other]);
  });
});
