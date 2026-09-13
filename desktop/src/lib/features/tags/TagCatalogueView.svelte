<script lang="ts">
  import type { Generation } from '../../api/types';
  import { TagCatalogue, type TagCatalogueSnapshot } from '../../queries/tags';

  let {
    catalogue,
    generation,
    search = '',
    onSelect,
  }: {
    catalogue: TagCatalogue;
    generation: Generation;
    search?: string;
    onSelect: (tag: string) => void;
  } = $props();

  let snapshot = $state<TagCatalogueSnapshot>({
    generation: null,
    status: 'idle',
    tags: [],
    selectedNames: [],
    failedOffset: null,
    error: null,
    revision: 0,
  });
  let loadingAction = $state(false);

  async function load() {
    snapshot = catalogue.snapshot;
    try {
      snapshot = await catalogue.load(generation);
    } catch {
      snapshot = catalogue.snapshot;
    }
  }

  async function retry() {
    loadingAction = true;
    try {
      snapshot = await (catalogue.snapshot.failedOffset === null
        ? catalogue.refresh()
        : catalogue.retry());
    } catch {
      snapshot = catalogue.snapshot;
    } finally {
      loadingAction = false;
    }
  }

  async function refresh() {
    loadingAction = true;
    try {
      snapshot = await catalogue.refresh();
    } catch {
      snapshot = catalogue.snapshot;
    } finally {
      loadingAction = false;
    }
  }

  $effect(() => {
    if (generation >= 0) void load();
  });

  const visibleTags = $derived.by(() => {
    const needle = search.trim().toLocaleLowerCase('en-US');
    return needle
      ? snapshot.tags.filter((tag) => tag.name.toLocaleLowerCase('en-US').includes(needle))
      : snapshot.tags;
  });
</script>

<section class="tag-catalogue" aria-label="Tag catalogue">
  <div class="tag-catalogue-header">
    <p class="tag-catalogue-summary">
      {#if snapshot.status === 'ready'}{snapshot.tags.length} tags{:else}Tags{/if}
    </p>
    <button class="secondary-button" type="button" onclick={() => void refresh()}>Refresh</button>
  </div>

  {#if snapshot.status === 'loading' && snapshot.tags.length === 0}
    <p class="status-message" role="status">Loading tags…</p>
  {:else if snapshot.status === 'error' && snapshot.tags.length === 0}
    <section class="status-message status-error" role="alert">
      <h2>Could not load tags</h2>
      <p>Tags could not be loaded. Try again.</p>
      <button
        class="primary-button"
        type="button"
        disabled={loadingAction}
        onclick={() => void retry()}
      >
        {loadingAction ? 'Working…' : 'Retry'}
      </button>
    </section>
  {:else if visibleTags.length === 0}
    <p class="status-message" role="status">
      {search.trim() ? 'No tags match your search.' : 'No tags yet.'}
    </p>
  {:else}
    <div class="tag-rows" role="list">
      {#each visibleTags as tag (tag.id)}
        <div class="tag-row" role="listitem">
          <button
            class="tag-select"
            type="button"
            aria-label={`Show all bookmarks tagged ${tag.name}`}
            onclick={() => onSelect(tag.name)}
          >
            <span aria-hidden="true">#</span>{tag.name}
          </button>
        </div>
      {/each}
    </div>
    {#if snapshot.status === 'error'}
      <section class="status-message status-error" role="alert">
        <p>Some tags could not be loaded.</p>
        <button
          class="secondary-button"
          type="button"
          disabled={loadingAction}
          onclick={() => void retry()}
        >
          {loadingAction ? 'Working…' : 'Retry'}
        </button>
      </section>
    {:else if snapshot.status === 'loading'}
      <p class="status-message" role="status">Loading more tags…</p>
    {/if}
  {/if}
</section>
