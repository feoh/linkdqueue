<script lang="ts">
  /* global HTMLElement, document, queueMicrotask */
  import type { LinkdqueueBridge } from '../../api/bridge';
  import type { Bookmark, BookmarkScope, Generation } from '../../api/types';
  import { BookmarkPager } from '../../queries/bookmarks';
  import type { BookmarkActionMutations } from './bookmarkActions';
  import BookmarkRow from './BookmarkRow.svelte';
  import BookmarkList from './BookmarkList.svelte';

  let {
    bridge,
    generation,
    tag,
    scope = null,
    query = '',
    mutations,
    openTagEditor,
    onOpenTagEditor,
    refreshToken = 0,
  }: {
    bridge: LinkdqueueBridge;
    generation: Generation;
    tag: string;
    scope?: BookmarkScope | null;
    query?: string;
    mutations?: BookmarkActionMutations;
    openTagEditor?: (bookmark: Bookmark) => void;
    onOpenTagEditor?: (bookmark: Bookmark) => void;
    refreshToken?: number;
  } = $props();

  let allPager = $state<BookmarkPager | null>(null);
  let archivePager = $state<BookmarkPager | null>(null);
  let rows = $state<Bookmark[]>([]);
  let loading = $state(true);
  let error = $state<unknown>(null);
  let requestKey = '';
  let requestNumber = 0;
  let listHeading = $state<HTMLElement>();
  let focusAfterDeleteId = $state<number | null>(null);
  let mutationAnnouncement = $state('');

  async function loadEverything(pager: BookmarkPager) {
    while (pager.snapshot.failedOffset !== null) await pager.retryFailedPage();
    while (pager.snapshot.nextOffset !== null) await pager.loadMore();
  }

  async function load() {
    const currentRequest = ++requestNumber;
    const nextAll = new BookmarkPager(bridge, {
      generation,
      scope: 'all',
      query: query || undefined,
      tag,
    });
    const nextArchive = new BookmarkPager(bridge, {
      generation,
      scope: 'archive',
      query: query || undefined,
      tag,
    });
    allPager = nextAll;
    archivePager = nextArchive;
    rows = [];
    loading = true;
    error = null;
    try {
      await Promise.all([nextAll.refresh(), nextArchive.refresh()]);
      await Promise.all([loadEverything(nextAll), loadEverything(nextArchive)]);
      if (currentRequest !== requestNumber) return;
      rows = mergedRows(nextAll, nextArchive);
    } catch (cause) {
      if (currentRequest !== requestNumber) return;
      rows = mergedRows(nextAll, nextArchive);
      error = cause;
    } finally {
      if (currentRequest === requestNumber) loading = false;
    }
  }

  function mergedRows(all: BookmarkPager, archive: BookmarkPager): Bookmark[] {
    return [...all.snapshot.rows, ...archive.snapshot.rows].filter(
      (bookmark, index, bookmarks) =>
        bookmarks.findIndex((item) => item.id === bookmark.id) === index,
    );
  }

  function focusDeletedRowSuccessor() {
    const nextId = focusAfterDeleteId;
    focusAfterDeleteId = null;
    if (nextId !== null) {
      const nextRow = document.querySelector<HTMLElement>(`[data-bookmark-id="${nextId}"]`);
      if (nextRow) {
        nextRow.focus();
        return;
      }
    }
    listHeading?.focus();
  }

  async function handleDeleted(bookmarkId: number, message: string) {
    mutationAnnouncement = message;
    const deletedIndex = rows.findIndex((row) => row.id === bookmarkId);
    focusAfterDeleteId = rows[deletedIndex + 1]?.id ?? null;
    await load();
    queueMicrotask(focusDeletedRowSuccessor);
  }

  function handleMutationSuccess(_bookmarkId: number, message: string) {
    mutationAnnouncement = message;
    void load();
  }

  async function retry() {
    const currentAll = allPager;
    const currentArchive = archivePager;
    if (!currentAll || !currentArchive) return load();
    loading = true;
    error = null;
    try {
      await Promise.all([loadEverything(currentAll), loadEverything(currentArchive)]);
      rows = mergedRows(currentAll, currentArchive);
    } catch (cause) {
      error = cause;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (scope === null && generation >= 0 && tag.length > 0) {
      const nextKey = `${generation}|${tag}|${query}|${refreshToken}`;
      if (nextKey !== requestKey) {
        requestKey = nextKey;
        void load();
      }
    }
  });
</script>

{#if scope !== null}
  <BookmarkList
    {bridge}
    {generation}
    {scope}
    {query}
    {tag}
    {mutations}
    {openTagEditor}
    {onOpenTagEditor}
    {refreshToken}
  />
{:else}
  <section class="bookmark-list" aria-label="All bookmarks tagged {tag}">
    <h2 bind:this={listHeading} class="bookmark-list-heading" tabindex="-1">
      All bookmarks tagged “{tag}”
    </h2>
    {#if mutationAnnouncement}<p class="bookmark-announcement" role="status" aria-live="polite">
        {mutationAnnouncement}
      </p>{/if}
    {#if loading && rows.length === 0 && error === null}
      <p class="status-message" role="status">Loading all bookmarks tagged “{tag}”…</p>
    {:else if error && rows.length === 0}
      <section class="status-message status-error" role="alert">
        <h2>Could not load tagged bookmarks</h2>
        <p>Bookmarks tagged “{tag}” could not be loaded.</p>
        <button class="primary-button" type="button" onclick={() => void retry()}>Retry</button>
      </section>
    {:else if rows.length === 0}
      <p class="status-message" role="status">No bookmarks use this tag.</p>
    {:else}
      <div class="bookmark-rows" role="list">
        {#each rows as bookmark (bookmark.id)}
          <div role="listitem">
            <BookmarkRow
              {bookmark}
              {generation}
              openExternalUrl={bridge.openExternalUrl}
              {mutations}
              {openTagEditor}
              {onOpenTagEditor}
              onMutationSuccess={handleMutationSuccess}
              onDeleted={(bookmarkId, message) => void handleDeleted(bookmarkId, message)}
            />
          </div>
        {/each}
      </div>
      {#if error}
        <section class="status-message status-error" role="alert">
          <p>Some tagged bookmarks could not be loaded.</p>
          <button class="secondary-button" type="button" onclick={() => void retry()}>Retry</button>
        </section>
      {:else if loading}
        <p class="status-message" role="status">Loading more tagged bookmarks…</p>
      {:else}
        <p class="status-message" role="status">End of list.</p>
      {/if}
    {/if}
  </section>
{/if}
