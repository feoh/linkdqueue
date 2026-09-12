<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Bookmark, Generation } from '../../api/types';

  let {
    bookmark,
    generation,
    openExternalUrl,
    actions,
  }: {
    bookmark: Bookmark;
    generation: Generation;
    openExternalUrl: (input: { generation: Generation; url: string }) => Promise<void>;
    actions?: Snippet<[Bookmark]>;
  } = $props();

  let openError = $state('');
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
</script>

<article class="bookmark-row" aria-labelledby={`bookmark-title-${bookmark.id}`}>
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
  {#if actions}{@render actions(bookmark)}{/if}
  {#if openError}<p class="bookmark-error" role="alert">{openError}</p>{/if}
</article>
