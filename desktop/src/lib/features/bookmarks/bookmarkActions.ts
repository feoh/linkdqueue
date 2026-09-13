import type { BookmarkMutations } from '../../queries/mutations';

export type BookmarkActionMutations = Pick<
  BookmarkMutations,
  'markRead' | 'archive' | 'unarchive' | 'delete'
>;
