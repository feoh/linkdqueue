import type { QueryClient } from '@tanstack/svelte-query';

import type { ConfirmedMutation, LinkdqueueBridge } from '../api/bridge';
import { normalizeIpcError } from '../api/errors';
import type {
  AppError,
  Bookmark,
  BookmarkIdInput,
  CreateBookmarkInput,
  MarkReadInput,
  ReplaceTagsInput,
} from '../api/types';
import { ACCOUNT_QUERY_KEY } from '../state/queryClient';

export type MutationResult<T> =
  | { status: 'confirmed'; data: T }
  | { status: 'failed'; error: AppError }
  | { status: 'unknown-outcome'; error: AppError }
  | { status: 'sync-failed'; data: T; error: AppError }
  | { status: 'stale'; data: T };

type ReconcileEffects = { invalidateTags?: boolean };
type RefetchActive = (generation: number) => Promise<void>;

function isUnknownOutcome(error: AppError): boolean {
  return error.code === 'timeout_unknown_outcome';
}

function confirmedMutation(data: ConfirmedMutation): boolean {
  return data.confirmed === true;
}

export class BookmarkMutations {
  private readonly pendingBookmarks = new Map<number, Promise<MutationResult<unknown>>>();
  private createPending: Promise<MutationResult<Bookmark>> | null = null;

  constructor(
    private readonly bridge: LinkdqueueBridge,
    private readonly queryClient: QueryClient,
    private readonly activeGeneration: () => number | null,
    private readonly refetchActive: RefetchActive = async () => {},
  ) {}

  markRead(bookmarkId: number, isRead: boolean): Promise<MutationResult<Bookmark>> {
    return this.runBookmark(bookmarkId, (generation) =>
      this.bridge.markRead({ generation, bookmarkId, isRead }),
    );
  }

  replaceBookmarkTags(bookmarkId: number, tagNames: string[]): Promise<MutationResult<Bookmark>> {
    return this.runBookmark(
      bookmarkId,
      (generation) => this.bridge.replaceBookmarkTags({ generation, bookmarkId, tagNames }),
      { invalidateTags: true },
    );
  }

  archive(bookmarkId: number): Promise<MutationResult<ConfirmedMutation>> {
    return this.runConfirmedBookmark(bookmarkId, (input) => this.bridge.archiveBookmark(input));
  }

  unarchive(bookmarkId: number): Promise<MutationResult<ConfirmedMutation>> {
    return this.runConfirmedBookmark(bookmarkId, (input) => this.bridge.unarchiveBookmark(input));
  }

  delete(bookmarkId: number): Promise<MutationResult<ConfirmedMutation>> {
    return this.runConfirmedBookmark(bookmarkId, (input) => this.bridge.deleteBookmark(input));
  }

  createBookmark(
    input: Omit<CreateBookmarkInput, 'generation'>,
  ): Promise<MutationResult<Bookmark>> {
    if (this.createPending) return this.createPending;
    const promise = this.executeMutation(
      (generation) => this.bridge.createBookmark({ ...input, generation }),
      { invalidateTags: true },
    ) as Promise<MutationResult<Bookmark>>;
    this.createPending = promise;
    void promise.then(
      () => {
        if (this.createPending === promise) this.createPending = null;
      },
      () => {
        if (this.createPending === promise) this.createPending = null;
      },
    );
    return promise;
  }

  private runBookmark<T extends Bookmark | ConfirmedMutation>(
    bookmarkId: number,
    write: (generation: number) => Promise<{ generation: number; data: T }>,
    effects: ReconcileEffects = {},
  ): Promise<MutationResult<T>> {
    const existing = this.pendingBookmarks.get(bookmarkId);
    if (existing) return existing as Promise<MutationResult<T>>;
    const promise = this.executeMutation(write, effects);
    this.pendingBookmarks.set(bookmarkId, promise as Promise<MutationResult<unknown>>);
    void promise.then(
      () => {
        if (this.pendingBookmarks.get(bookmarkId) === promise)
          this.pendingBookmarks.delete(bookmarkId);
      },
      () => {
        if (this.pendingBookmarks.get(bookmarkId) === promise)
          this.pendingBookmarks.delete(bookmarkId);
      },
    );
    return promise;
  }

  private runConfirmedBookmark(
    bookmarkId: number,
    write: (input: BookmarkIdInput) => Promise<{ generation: number; data: ConfirmedMutation }>,
  ): Promise<MutationResult<ConfirmedMutation>> {
    return this.runBookmark(bookmarkId, (generation) => write({ generation, bookmarkId }));
  }

  private async executeMutation<T extends Bookmark | ConfirmedMutation>(
    write: (generation: number) => Promise<{ generation: number; data: T }>,
    effects: ReconcileEffects,
  ): Promise<MutationResult<T>> {
    const generation = this.activeGeneration();
    if (generation === null) {
      return { status: 'failed', error: normalizeIpcError({ code: 'stale_generation' }) };
    }

    let response: { generation: number; data: T };
    try {
      response = await write(generation);
    } catch (rejected: unknown) {
      const error = normalizeIpcError(rejected);
      return { status: isUnknownOutcome(error) ? 'unknown-outcome' : 'failed', error };
    }

    if (response.generation !== generation || this.activeGeneration() !== generation) {
      return { status: 'stale', data: response.data };
    }
    if ('confirmed' in response.data && !confirmedMutation(response.data)) {
      return {
        status: 'failed',
        error: normalizeIpcError({ code: 'internal_error' }),
      };
    }

    try {
      await this.reconcile(generation, effects);
    } catch (rejected: unknown) {
      return { status: 'sync-failed', data: response.data, error: normalizeIpcError(rejected) };
    }
    return { status: 'confirmed', data: response.data };
  }

  private async reconcile(generation: number, effects: ReconcileEffects): Promise<void> {
    const bookmarksKey = [ACCOUNT_QUERY_KEY, generation, 'bookmarks'];
    await this.queryClient.cancelQueries({ queryKey: bookmarksKey });
    this.queryClient.removeQueries({ queryKey: bookmarksKey });
    if (effects.invalidateTags) {
      this.queryClient.removeQueries({ queryKey: [ACCOUNT_QUERY_KEY, generation, 'tags'] });
    }
    await this.refetchActive(generation);
  }
}

export type BookmarkMutationInput =
  MarkReadInput | ReplaceTagsInput | BookmarkIdInput | CreateBookmarkInput;
