<script lang="ts">
  import type { Snippet } from 'svelte';

  export type ShellNavigationItem = { id: string; label: string };

  let {
    brand = 'Linkdqueue',
    items,
    activeId,
    onNavigate,
    children,
  }: {
    brand?: string;
    items: ShellNavigationItem[];
    activeId: string;
    onNavigate: (id: string) => void;
    children?: Snippet;
  } = $props();
</script>

<div class="app-shell">
  <aside class="sidebar" aria-label="Primary navigation">
    <a
      class="brand"
      href="#/queue?scope=queue"
      onclick={(event) => {
        event.preventDefault();
        onNavigate(items[0]?.id ?? activeId);
      }}
    >
      <span class="brand-mark" aria-hidden="true">L</span>
      <span>{brand}</span>
    </a>

    <nav aria-label="Sections">
      <ul>
        {#each items as item (item.id)}
          <li>
            <button
              class:active={activeId === item.id}
              aria-current={activeId === item.id ? 'page' : undefined}
              type="button"
              onclick={() => onNavigate(item.id)}
            >
              {item.label}
            </button>
          </li>
        {/each}
      </ul>
    </nav>
  </aside>

  <main id="main-content" class="content" tabindex="-1">
    {@render children?.()}
  </main>
</div>
