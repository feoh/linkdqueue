<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import type { LinkdqueueBridge } from '../../api/bridge';
  import type { Bookmark, BookmarkScope, Generation } from '../../api/types';
  import { BookmarkPager, type BookmarkPagerSnapshot } from '../../queries/bookmarks';
  import BookmarkRow from './BookmarkRow.svelte';

  let {
    bridge,
    generation,
    scope,
    query = '',
    tag,
    actions,
    refreshToken = 0,
  }: {
    bridge: LinkdqueueBridge;
    generation: Generation;
    scope: BookmarkScope;
    query?: string;
    tag?: string;
    actions?: Snippet<[Bookmark]>;
    refreshToken?: number;
  } = $props();

  let pager = $state<BookmarkPager | null>(null);
  let snapshot = $state<BookmarkPagerSnapshot>({
    pages: [],
    rows: [],
    nextOffset: 0,
    failedOffset: null,
    error: null,
    revision: 0,
  });
  let loading = $state(false);
  let requestError = $state<unknown>(null);
  let sentinel: globalThis.Element;
  let observer: InstanceType<typeof globalThis.IntersectionObserver> | undefined;
  let filterKey = '';
  let seenRefreshToken = $state(0);

  function refreshPager(
    nextGeneration = generation,
    nextScope = scope,
    nextQuery = query,
    nextTag = tag,
  ) {
    const next = new BookmarkPager(bridge, {
      generation: nextGeneration,
      scope: nextScope,
      query: nextQuery || undefined,
      tag: nextTag,
    });
    pager = next;
    loading = true;
    requestError = null;
    snapshot = next.snapshot;
    void next.refresh().then(
      () => {
        if (pager !== next) return;
        snapshot = next.snapshot;
        requestError = null;
        loading = false;
      },
      (error: unknown) => {
        if (pager !== next) return;
        snapshot = next.snapshot;
        requestError = error;
        loading = false;
      },
    );
  }

  $effect(() => {
    const nextKey = `${generation}|${scope}|${query}|${tag ?? ''}`;
    if (nextKey !== filterKey) {
      filterKey = nextKey;
      refreshPager(generation, scope, query, tag);
    } else if (refreshToken !== seenRefreshToken) {
      seenRefreshToken = refreshToken;
      void pager?.refresh().then(
        () => {
          if (pager) {
            snapshot = pager.snapshot;
            requestError = null;
          }
        },
        (error: unknown) => {
          if (pager) {
            snapshot = pager.snapshot;
            requestError = error;
          }
        },
      );
    }
  });

  async function loadMore() {
    const current = pager;
    if (!current || loading) return;
    if (current.snapshot.failedOffset !== null) {
      loading = true;
      try {
        await current.retryFailedPage();
        requestError = null;
      } catch (error: unknown) {
        requestError = error;
      } finally {
        snapshot = current.snapshot;
        loading = false;
      }
      return;
    }
    if (current.snapshot.nextOffset === null) return;
    loading = true;
    try {
      await current.loadMore();
      requestError = null;
    } catch (error: unknown) {
      requestError = error;
    } finally {
      snapshot = current.snapshot;
      loading = false;
    }
  }

  onMount(() => {
    if (typeof globalThis.IntersectionObserver === 'undefined') return;
    observer = new globalThis.IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    });
    if (sentinel) observer.observe(sentinel);
    return () => observer?.disconnect();
  });

  const errorMessage = $derived(
    requestError instanceof Error ? requestError.message : 'Bookmarks could not be loaded.',
  );
  const initialFailure = $derived(!snapshot.rows.length && !loading && requestError !== null);
  const emptyMessage = $derived(
    query ? 'No bookmarks match your search.' : 'Your reading queue is empty.',
  );
</script>

<section class="bookmark-list" aria-label="Bookmarks">
  {#if loading && snapshot.rows.length === 0 && requestError === null}
    <p class="status-message" role="status">Loading bookmarks…</p>
  {:else if initialFailure}
    <section class="status-message status-error" role="alert">
      <h2>Could not load bookmarks</h2>
      <p>{errorMessage}</p>
      <button class="primary-button" type="button" onclick={() => void refreshPager()}>Retry</button
      >
    </section>
  {:else if snapshot.rows.length === 0}
    <p class="status-message" role="status">{emptyMessage}</p>
  {:else}
    <div class="bookmark-rows" role="list">
      {#each snapshot.rows as bookmark (bookmark.id)}
        <div role="listitem">
          <BookmarkRow {bookmark} {generation} openExternalUrl={bridge.openExternalUrl} {actions} />
        </div>
      {/each}
    </div>
    {#if requestError && snapshot.rows.length > 0}
      <section class="status-message status-error" role="alert">
        <p>{errorMessage}</p>
        <button class="secondary-button" type="button" onclick={() => void loadMore()}
          >Retry loading</button
        >
      </section>
    {:else if loading}
      <p class="status-message" role="status">Loading more bookmarks…</p>
    {:else if snapshot.nextOffset !== null}
      <button class="primary-button" type="button" onclick={() => void loadMore()}>Load more</button
      >
    {:else}
      <p class="status-message" role="status">End of list.</p>
    {/if}
  {/if}
  <div bind:this={sentinel} class="bookmark-sentinel" aria-hidden="true"></div>
</section>
