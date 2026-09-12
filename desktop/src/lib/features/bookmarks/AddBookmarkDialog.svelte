<script lang="ts">
  import Dialog from '../../components/Dialog.svelte';
  import TagInput from '../../components/TagInput.svelte';
  import { normalizeIpcError } from '../../api/errors';
  import type { Bookmark, CreateBookmarkInput, AppError } from '../../api/types';
  import type { MutationResult } from '../../queries/mutations';

  type CreateBookmark = (
    input: Omit<CreateBookmarkInput, 'generation'>,
  ) => Promise<MutationResult<Bookmark>>;

  type Props = {
    open?: boolean;
    createBookmark: CreateBookmark;
    suggestions?: string[];
    onClose?: () => void;
  };

  let { open = false, createBookmark, suggestions = [], onClose }: Props = $props();
  let url = $state('');
  let title = $state('');
  let description = $state('');
  let tags = $state<string[]>([]);
  let isRead = $state(false);
  let submitting = $state(false);
  let error = $state<AppError | null>(null);
  let fieldError = $state('');
  let announcement = $state('');
  let attempted = $state(false);

  const dirty = $derived(Boolean(url || title || description || tags.length || isRead));

  function validateBookmarkUrl(value: string): string | null {
    const candidate = value.trim();
    if (!candidate) return 'URL is required.';
    if (
      [...candidate].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      })
    )
      return 'Enter a valid HTTP or HTTPS URL.';
    try {
      const parsed = new globalThis.URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
        return 'Enter an HTTP or HTTPS URL.';
      if (!parsed.hostname || parsed.username || parsed.password)
        return 'Enter a valid HTTP or HTTPS URL without credentials.';
    } catch {
      return 'Enter a valid HTTP or HTTPS URL.';
    }
    return null;
  }

  function resetDraft() {
    url = '';
    title = '';
    description = '';
    tags = [];
    isRead = false;
    error = null;
    fieldError = '';
    attempted = false;
  }

  function closeRequested() {
    if (submitting) return;
    if (dirty && !globalThis.confirm('Discard this bookmark draft?')) return;
    resetDraft();
    onClose?.();
  }

  function changeTags(next: string[]) {
    tags = next;
    error = null;
    fieldError = '';
  }

  async function save() {
    if (submitting) return;
    attempted = true;
    const invalidUrl = validateBookmarkUrl(url);
    if (invalidUrl) {
      fieldError = invalidUrl;
      error = null;
      return;
    }
    submitting = true;
    error = null;
    fieldError = '';
    announcement = '';
    const input: Omit<CreateBookmarkInput, 'generation'> = {
      url: url.trim(),
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(tags.length ? { tagNames: [...tags] } : {}),
      ...(isRead ? { isRead: true } : {}),
    };
    try {
      const result = await createBookmark(input);
      if (result.status === 'confirmed') {
        announcement = isRead
          ? 'Bookmark saved as read; it will not enter the unread queue.'
          : 'Bookmark saved and added to the unread queue.';
        url = '';
        title = '';
        description = '';
        tags = [];
        isRead = false;
        attempted = false;
        onClose?.();
      } else if (result.status === 'sync-failed') {
        error = result.error;
        announcement =
          'Bookmark was saved, but refreshing the bookmark list failed. Do not submit again.';
      } else if (result.status === 'unknown-outcome') {
        error = result.error;
        announcement = result.error.message;
      } else if (result.status === 'stale') {
        error = {
          code: 'stale_generation',
          message: 'The connection changed; retry with current settings.',
          retryable: false,
        };
      } else {
        error = result.error;
        if (result.error.code === 'bad_request' || result.error.status === 400)
          fieldError = 'Linkding rejected one or more bookmark fields.';
      }
    } catch (rejected: unknown) {
      error = normalizeIpcError(rejected);
      if (error.code === 'bad_request' || error.status === 400)
        fieldError = 'Linkding rejected one or more bookmark fields.';
    } finally {
      submitting = false;
    }
  }
</script>

<Dialog
  id="add-bookmark-dialog"
  {open}
  title="Add bookmark"
  description="Save a link to your Linkding reading queue."
  onClose={closeRequested}
>
  <div class="bookmark-form" aria-busy={submitting}>
    <label for="bookmark-url">URL <span aria-hidden="true">*</span></label>
    <input
      id="bookmark-url"
      type="url"
      required
      data-autofocus
      autocomplete="url"
      value={url}
      oninput={(event) => (url = event.currentTarget.value)}
      aria-invalid={Boolean(attempted && fieldError)}
      aria-describedby={fieldError ? 'bookmark-url-error' : undefined}
    />
    {#if attempted && fieldError}<p id="bookmark-url-error" class="field-error" role="alert">
        {fieldError}
      </p>{/if}

    <label for="bookmark-title">Title <span class="optional">(optional)</span></label>
    <input
      id="bookmark-title"
      type="text"
      value={title}
      oninput={(event) => (title = event.currentTarget.value)}
    />

    <label for="bookmark-description">Description <span class="optional">(optional)</span></label>
    <textarea
      id="bookmark-description"
      rows="3"
      value={description}
      oninput={(event) => (description = event.currentTarget.value)}></textarea>

    <TagInput {suggestions} selectedNames={tags} onChange={changeTags} />

    <label class="read-option">
      <input
        type="checkbox"
        checked={isRead}
        onchange={(event) => (isRead = event.currentTarget.checked)}
      />
      Mark as read
    </label>

    {#if error}<p class="field-error" role="alert">{error.message}</p>{/if}
    {#if announcement}<p class="dialog-announcement" role="status">{announcement}</p>{/if}
  </div>
  {#snippet actions()}
    <button type="button" class="secondary-button" disabled={submitting} onclick={closeRequested}
      >Cancel</button
    >
    <button type="button" class="primary-button" disabled={submitting} onclick={() => void save()}>
      {submitting ? 'Saving…' : 'Save bookmark'}
    </button>
  {/snippet}
</Dialog>
