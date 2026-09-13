<script lang="ts">
  import Dialog from '../../components/Dialog.svelte';
  import TagInput from '../../components/TagInput.svelte';
  import { normalizeIpcError } from '../../api/errors';
  import type { AppError, Bookmark, Generation } from '../../api/types';
  import { TagCatalogue } from '../../queries/tags';
  import type { MutationResult } from '../../queries/mutations';

  type ReplaceBookmarkTags = (
    bookmarkId: number,
    tagNames: string[],
  ) => Promise<MutationResult<Bookmark>>;

  type Props = {
    open?: boolean;
    bookmark: Bookmark;
    generation: Generation;
    replaceBookmarkTags?: ReplaceBookmarkTags;
    mutations?: { replaceBookmarkTags: ReplaceBookmarkTags };
    catalogue?: TagCatalogue;
    suggestions?: string[];
    onClose?: () => void;
    onSaved?: (bookmark: Bookmark) => void;
  };

  let {
    open = false,
    bookmark,
    generation,
    replaceBookmarkTags,
    mutations,
    catalogue,
    suggestions = [],
    onClose,
    onSaved,
  }: Props = $props();

  let tags = $state<string[]>([]);
  let initialTags = $state<string[]>([]);
  let submitting = $state(false);
  let error = $state<AppError | null>(null);
  let announcement = $state('');
  let wasOpen = false;
  let draftKey = '';
  let catalogueRequest = 0;
  let saveRequest = 0;
  let availableSuggestions = $state<string[]>([]);

  const dirty = $derived(
    tags.length !== initialTags.length || tags.some((tag, index) => tag !== initialTags[index]),
  );

  function mergeSuggestions(names: readonly string[]): string[] {
    return [...new Set([...tags, ...names])];
  }

  function resetDraft() {
    initialTags = [...bookmark.tag_names];
    tags = [...bookmark.tag_names];
    catalogue?.setSelectedNames(bookmark.tag_names);
    error = null;
    announcement = '';
    availableSuggestions = mergeSuggestions(suggestions);
  }

  function isCurrentRequest(request: number, key: string): boolean {
    return request === saveRequest && open && key === `${generation}:${bookmark.id}`;
  }

  async function loadSuggestions(key: string, request: number) {
    if (!catalogue) return;
    try {
      const snapshot = await catalogue.load(generation);
      if (request !== catalogueRequest || !open || key !== `${generation}:${bookmark.id}`) return;
      availableSuggestions = mergeSuggestions(snapshot.tags.map((tag) => tag.name));
    } catch {
      // A partial catalogue is still useful; the current bookmark names remain available.
      if (request !== catalogueRequest || !open || key !== `${generation}:${bookmark.id}`) return;
      availableSuggestions = mergeSuggestions(catalogue.snapshot.tags.map((tag) => tag.name));
    }
  }

  $effect(() => {
    const key = `${generation}:${bookmark.id}`;
    if (open && (!wasOpen || draftKey !== key)) {
      draftKey = key;
      saveRequest += 1;
      resetDraft();
      catalogueRequest += 1;
      void loadSuggestions(key, catalogueRequest);
    } else if (!open && wasOpen) {
      saveRequest += 1;
      catalogueRequest += 1;
    }
    wasOpen = open;
  });

  function changeTags(next: string[]) {
    tags = next;
    catalogue?.setSelectedNames(next);
    error = null;
    announcement = '';
  }

  function clearAll() {
    if (submitting) return;
    tags = [];
    catalogue?.setSelectedNames([]);
    error = null;
    announcement = '';
  }

  function closeRequested(): boolean {
    if (submitting) return false;
    if (dirty && !globalThis.confirm('Discard these tag changes?')) return false;
    saveRequest += 1;
    onClose?.();
    return true;
  }

  function rejectedError(result: MutationResult<Bookmark>): AppError {
    if (result.status === 'stale') return normalizeIpcError({ code: 'stale_generation' });
    if ('error' in result) return normalizeIpcError(result.error);
    return normalizeIpcError({ code: 'internal_error' });
  }

  async function save() {
    if (submitting || !dirty) return;
    const key = `${generation}:${bookmark.id}`;
    const request = ++saveRequest;
    submitting = true;
    error = null;
    announcement = '';
    try {
      const replace = replaceBookmarkTags ?? mutations?.replaceBookmarkTags;
      if (!replace) {
        error = normalizeIpcError({ code: 'internal_error' });
        announcement = 'Tags were not saved. Your changes are still here; try again.';
        return;
      }
      const result = await replace(bookmark.id, [...tags]);
      if (!isCurrentRequest(request, key)) return;
      if (result.status === 'confirmed') {
        initialTags = [...tags];
        onSaved?.(result.data);
        onClose?.();
      } else {
        error = rejectedError(result);
        announcement = 'Tags were not saved. Your changes are still here; try again.';
      }
    } catch (rejected: unknown) {
      if (!isCurrentRequest(request, key)) return;
      error = normalizeIpcError(rejected);
      announcement = 'Tags were not saved. Your changes are still here; try again.';
    } finally {
      if (request === saveRequest) submitting = false;
    }
  }
</script>

<Dialog
  id="edit-tags-dialog"
  {open}
  title="Edit tags"
  description={`Choose the complete set of tags for “${bookmark.title.trim() || bookmark.url}”.`}
  onClose={closeRequested}
>
  <div class="bookmark-form" aria-busy={submitting}>
    <TagInput
      id="edit-bookmark-tags"
      selectedNames={tags}
      suggestions={availableSuggestions}
      onChange={changeTags}
    />
    <button
      class="secondary-button"
      type="button"
      disabled={submitting || tags.length === 0}
      onclick={clearAll}>Clear all tags</button
    >
    {#if error}<p class="field-error" role="alert">{error.message}</p>{/if}
    {#if announcement}<p class="dialog-announcement" role="status">{announcement}</p>{/if}
  </div>
  {#snippet actions()}
    <button type="button" class="secondary-button" disabled={submitting} onclick={closeRequested}
      >Cancel</button
    >
    <button
      type="button"
      class="primary-button"
      disabled={submitting || !dirty}
      onclick={() => void save()}
    >
      {submitting ? 'Saving…' : 'Save tags'}
    </button>
  {/snippet}
</Dialog>
