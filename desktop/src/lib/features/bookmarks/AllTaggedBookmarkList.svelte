<script lang="ts">
  import { mergeTaggedBookmarks } from '../../state/allTagged';
  import type { LinkdqueueBridge } from '../../api/bridge';
  import type { Bookmark, BookmarkScope, Generation } from '../../api/types';
  import BookmarkRow from './BookmarkRow.svelte';

  let {
    bridge,
    generation,
    tag,
    refreshToken = 0,
  }: {
    bridge: LinkdqueueBridge;
    generation: Generation;
    tag: string;
    refreshToken?: number;
  } = $props();
  let rows = $state<Bookmark[]>([]);
  let loading = $state(true);
  let error = $state<unknown>(null);
  let loadedToken = $state(0);

  async function load() {
    loading = true;
    error = null;
    try {
      const results = await Promise.all(
        (['queue', 'archive'] as BookmarkScope[]).map(async (scope) => {
          const collected: Bookmark[] = [];
          let offset = 0;
          while (true) {
            const page = await bridge.listBookmarks({ generation, scope, tag, offset, limit: 100 });
            collected.push(...page.data.results);
            if (!page.data.next || page.data.results.length === 0) break;
            offset += page.data.results.length;
          }
          return collected;
        }),
      );
      rows = mergeTaggedBookmarks(results);
    } catch (cause) {
      error = cause;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (refreshToken !== loadedToken) loadedToken = refreshToken;
    if (generation >= 0 && tag.length > 0) void load();
  });
</script>

<section class="bookmark-list" aria-label="Bookmarks with tag {tag}">
  {#if loading}<p class="status-message" role="status">Loading tagged bookmarks…</p>
  {:else if error}<p class="status-message status-error" role="alert">
      Could not load tagged bookmarks. {error instanceof Error ? error.message : ''}
    </p>
  {:else if !rows.length}<p class="status-message" role="status">No bookmarks use this tag.</p>
  {:else}
    <div class="bookmark-rows" role="list">
      {#each rows as bookmark (bookmark.id)}
        <div role="listitem">
          <BookmarkRow {bookmark} {generation} openExternalUrl={bridge.openExternalUrl} />
        </div>
      {/each}
    </div>
  {/if}
</section>
