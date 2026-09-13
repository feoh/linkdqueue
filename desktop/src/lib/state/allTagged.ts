import type { Bookmark } from '../api/types';

/** Merge server-filtered queue/archive results without exposing an unscoped request. */
export function mergeTaggedBookmarks(batches: readonly (readonly Bookmark[])[]): Bookmark[] {
  const seen = new Set<number>();
  const merged: Bookmark[] = [];
  for (const batch of batches) {
    for (const bookmark of batch) {
      if (seen.has(bookmark.id)) continue;
      seen.add(bookmark.id);
      merged.push(bookmark);
    }
  }
  return merged;
}
