<script lang="ts">
  import type { Snippet } from 'svelte';
  import Dialog from '../../components/Dialog.svelte';
  import { normalizeIpcError } from '../../api/errors';
  import type { AppError, Bookmark, BookmarkScope, Generation } from '../../api/types';
  import type { MutationResult } from '../../queries/mutations';
  import type { BookmarkActionMutations } from './bookmarkActions';
  type Action = 'mark-read' | 'archive' | 'unarchive' | 'delete';

  let {
    bookmark,
    generation,
    openExternalUrl,
    mutations,
    openTagEditor,
    onOpenTagEditor,
    onMutationSuccess,
    onDeleted,
    actions,
  }: {
    bookmark: Bookmark;
    generation: Generation;
    scope?: BookmarkScope;
    openExternalUrl: (input: { generation: Generation; url: string }) => Promise<void>;
    mutations?: BookmarkActionMutations;
    openTagEditor?: (bookmark: Bookmark) => void;
    onOpenTagEditor?: (bookmark: Bookmark) => void;
    onMutationSuccess?: (bookmarkId: number, message: string) => void;
    onDeleted?: (bookmarkId: number, message: string) => void;
    actions?: Snippet<[Bookmark]>;
  } = $props();

  let openError = $state('');
  let actionError = $state<AppError | null>(null);
  let announcement = $state('');
  let pendingAction = $state<Action | null>(null);
  let deleteDialogOpen = $state(false);
  let deleteError = $state<AppError | null>(null);
  let deleteAnnouncement = $state('');
  const title = $derived(bookmark.title.trim() || bookmark.website_title?.trim() || bookmark.url);
  const description = $derived(
    bookmark.description.trim() || bookmark.website_description?.trim() || bookmark.url,
  );
  const hostname = $derived.by(() => {
    try {
      return new globalThis.URL(bookmark.url).hostname;
    } catch {
      return bookmark.url;
    }
  });

  async function open() {
    openError = '';
    try {
      await openExternalUrl({ generation, url: bookmark.url });
    } catch {
      openError = 'This bookmark could not be opened.';
    }
  }

  function safeError(value: unknown): AppError {
    return normalizeIpcError(value);
  }

  function isConfirmed<T>(result: MutationResult<T>): boolean {
    return result.status === 'confirmed' || result.status === 'sync-failed';
  }

  async function runAction(
    action: Exclude<Action, 'delete'>,
    operation: () => Promise<MutationResult<Bookmark | { confirmed: boolean }>>,
    successMessage: string,
  ) {
    if (!mutations || pendingAction !== null) return;
    pendingAction = action;
    actionError = null;
    announcement = '';
    try {
      const result = await operation();
      if (isConfirmed(result)) {
        announcement =
          result.status === 'sync-failed'
            ? `${successMessage} Refreshing the list failed; use Refresh to reconcile.`
            : successMessage;
        onMutationSuccess?.(bookmark.id, announcement);
      } else if (result.status === 'stale') {
        actionError = safeError({ code: 'stale_generation' });
      } else if ('error' in result) {
        actionError = safeError(result.error);
      }
    } catch (rejected: unknown) {
      actionError = safeError(rejected);
    } finally {
      pendingAction = null;
    }
  }

  function requestTagEditor() {
    announcement = '';
    (openTagEditor ?? onOpenTagEditor)?.(bookmark);
  }

  function openDeleteDialog() {
    if (!mutations || pendingAction !== null) return;
    deleteError = null;
    deleteAnnouncement = '';
    deleteDialogOpen = true;
  }

  function closeDeleteDialog() {
    if (pendingAction === 'delete') return;
    deleteDialogOpen = false;
    deleteError = null;
    deleteAnnouncement = '';
  }

  async function confirmDelete() {
    if (!mutations || pendingAction !== null) return;
    pendingAction = 'delete';
    deleteError = null;
    deleteAnnouncement = '';
    try {
      const result = await mutations.delete(bookmark.id);
      if (isConfirmed(result)) {
        deleteDialogOpen = false;
        announcement =
          result.status === 'sync-failed'
            ? 'Bookmark deleted, but refreshing the list failed; use Refresh to reconcile.'
            : 'Bookmark deleted.';
        onDeleted?.(bookmark.id, announcement);
      } else if (result.status === 'stale') {
        deleteError = safeError({ code: 'stale_generation' });
        deleteAnnouncement =
          'The connection changed. Close this dialog and retry with current settings.';
      } else if ('error' in result) {
        deleteError = safeError(result.error);
        deleteAnnouncement =
          result.status === 'unknown-outcome'
            ? `${deleteError.message} Reconcile in Linkding before retrying.`
            : `${deleteError.message} Fix the problem, then choose Delete bookmark to retry.`;
      }
    } catch (rejected: unknown) {
      deleteError = safeError(rejected);
      deleteAnnouncement = `${deleteError.message} Fix the problem, then choose Delete bookmark to retry.`;
    } finally {
      pendingAction = null;
    }
  }
</script>

<article
  class="bookmark-row"
  tabindex="-1"
  data-bookmark-id={bookmark.id}
  aria-labelledby={`bookmark-title-${bookmark.id}`}
  aria-busy={pendingAction !== null}
>
  <div class="bookmark-row-header">
    <div>
      <h2 id={`bookmark-title-${bookmark.id}`}>{title}</h2>
      <p class="bookmark-hostname">{hostname}</p>
    </div>
    <button class="secondary-button" type="button" onclick={() => void open()}>Open bookmark</button
    >
  </div>
  <p class="bookmark-description">{description}</p>
  <div class="bookmark-metadata">
    <span class="bookmark-badge">{bookmark.unread ? 'Unread' : 'Read'}</span>
    {#if bookmark.is_archived}<span class="bookmark-badge">Archived</span>{/if}
    {#each bookmark.tag_names as tag, index (index)}<span class="bookmark-tag">#{tag}</span>{/each}
  </div>
  <div class="bookmark-actions" aria-label={`Actions for ${title}`}>
    {#if bookmark.unread}
      <button
        class="secondary-button"
        type="button"
        disabled={!mutations || pendingAction !== null}
        onclick={() =>
          void runAction(
            'mark-read',
            () => mutations!.markRead(bookmark.id, true),
            'Bookmark marked as read.',
          )}>Mark as read</button
      >
    {/if}
    {#if bookmark.is_archived}
      <button
        class="secondary-button"
        type="button"
        disabled={!mutations || pendingAction !== null}
        onclick={() =>
          void runAction(
            'unarchive',
            () => mutations!.unarchive(bookmark.id),
            'Bookmark unarchived.',
          )}>Unarchive</button
      >
    {:else}
      <button
        class="secondary-button"
        type="button"
        disabled={!mutations || pendingAction !== null}
        onclick={() =>
          void runAction('archive', () => mutations!.archive(bookmark.id), 'Bookmark archived.')}
        >Archive</button
      >
    {/if}
    <button
      class="secondary-button"
      type="button"
      disabled={pendingAction !== null}
      onclick={requestTagEditor}>Edit tags</button
    >
    <button
      class="danger-button"
      type="button"
      disabled={!mutations || pendingAction !== null}
      onclick={openDeleteDialog}>Delete bookmark</button
    >
  </div>
  {#if actionError}<p class="bookmark-error" role="alert">{actionError.message}</p>{/if}
  {#if announcement}<p class="bookmark-announcement" role="status" aria-live="polite">
      {announcement}
    </p>{/if}
  {#if actions}{@render actions(bookmark)}{/if}
  {#if openError}<p class="bookmark-error" role="alert">{openError}</p>{/if}
</article>

<Dialog
  id={`delete-bookmark-dialog-${bookmark.id}`}
  open={deleteDialogOpen}
  title="Delete bookmark"
  description={`Delete “${title}”? This action is irreversible and cannot be undone.`}
  onClose={closeDeleteDialog}
>
  {#if deleteError}<p class="bookmark-error" role="alert">{deleteError.message}</p>{/if}
  {#if deleteAnnouncement}<p class="dialog-announcement" role="status">{deleteAnnouncement}</p>{/if}
  {#snippet actions()}
    <button
      class="secondary-button"
      type="button"
      disabled={pendingAction === 'delete'}
      onclick={closeDeleteDialog}>Cancel</button
    >
    <button
      class="danger-button"
      type="button"
      aria-label="Confirm delete bookmark"
      disabled={pendingAction === 'delete'}
      onclick={() => void confirmDelete()}
    >
      {pendingAction === 'delete' ? 'Deleting…' : 'Delete bookmark'}
    </button>
  {/snippet}
</Dialog>
