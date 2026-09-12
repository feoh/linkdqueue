<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    eyebrow,
    title,
    searchValue = '',
    searchLabel = 'Search bookmarks',
    searchPlaceholder = 'Search bookmarks',
    onSearch,
    children,
  }: {
    eyebrow: string;
    title: string;
    searchValue?: string;
    searchLabel?: string;
    searchPlaceholder?: string;
    onSearch?: (value: string) => void;
    children?: Snippet;
  } = $props();
</script>

<header class="toolbar" aria-labelledby="toolbar-title">
  <div class="toolbar-heading">
    <p class="eyebrow">{eyebrow}</p>
    <h1 id="toolbar-title">{title}</h1>
  </div>

  <div class="toolbar-controls">
    <label class="search-field">
      <span class="sr-only">{searchLabel}</span>
      <input
        value={searchValue}
        oninput={(event) => onSearch?.(event.currentTarget.value)}
        type="search"
        placeholder={searchPlaceholder}
        aria-label={searchLabel}
      />
    </label>
    {#if children}
      <div class="toolbar-actions">
        {@render children()}
      </div>
    {/if}
  </div>
</header>
