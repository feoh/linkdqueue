<script lang="ts">
  import type { LinkdqueueBridge } from '../../api/bridge';
  import type { Bookmark, BookmarkScope, Generation } from '../../api/types';
  import { BookmarkPager } from '../../queries/bookmarks';
  import BookmarkRow from './BookmarkRow.svelte';
  import BookmarkList from './BookmarkList.svelte';

  let {
    bridge,
    generation,
    tag,
    scope = null,
    query = '',
    refreshToken = 0,
  }: {
    bridge: LinkdqueueBridge;
    generation: Generation;
    tag: string;
    scope?: BookmarkScope | null;
    query?: string;
    refreshToken?: number;
  } = $props();

  let allPager = $state<BookmarkPager | null>(null);
  let archivePager = $state<BookmarkPager | null>(null);
  let rows = $state<Bookmark[]>([]);
  let loading = $state(true);
  let error = $state<unknown>(null);
  let requestKey = '';
  let requestNumber = 0;

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
      rows = [...nextAll.snapshot.rows, ...nextArchive.snapshot.rows].filter(
        (bookmark, index, bookmarks) =>
          bookmarks.findIndex((item) => item.id === bookmark.id) === index,
      );
    } catch (cause) {
      if (currentRequest !== requestNumber) return;
      rows = [...nextAll.snapshot.rows, ...nextArchive.snapshot.rows].filter(
        (bookmark, index, bookmarks) =>
          bookmarks.findIndex((item) => item.id === bookmark.id) === index,
      );
      error = cause;
    } finally {
      if (currentRequest === requestNumber) loading = false;
    }
  }

  async function retry() {
    const currentAll = allPager;
    const currentArchive = archivePager;
    if (!currentAll || !currentArchive) return load();
    loading = true;
    error = null;
    try {
      await Promise.all([loadEverything(currentAll), loadEverything(currentArchive)]);
      rows = [...currentAll.snapshot.rows, ...currentArchive.snapshot.rows].filter(
        (bookmark, index, bookmarks) =>
          bookmarks.findIndex((item) => item.id === bookmark.id) === index,
      );
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
  <BookmarkList {bridge} {generation} {scope} {query} {tag} {refreshToken} />
{:else}
  <section class="bookmark-list" aria-label="All bookmarks tagged {tag}">
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
            <BookmarkRow {bookmark} {generation} openExternalUrl={bridge.openExternalUrl} />
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
