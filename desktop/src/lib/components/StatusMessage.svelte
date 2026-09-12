<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    variant = 'info',
    title,
    message,
    retry,
    retryLabel = 'Retry',
    busy = false,
    children,
  }: {
    variant?: 'loading' | 'info' | 'empty' | 'error';
    title: string;
    message: string;
    retry?: () => void;
    retryLabel?: string;
    busy?: boolean;
    children?: Snippet;
  } = $props();

  const role = $derived(variant === 'error' ? 'alert' : 'status');
</script>

<section class:status-error={variant === 'error'} class="status-message" {role} aria-live="polite">
  <p class="status-badge">{variant === 'loading' ? 'Loading' : variant}</p>
  <h2>{title}</h2>
  <p>{message}</p>
  <div class="status-actions">
    {#if retry}
      <button
        class="primary-button"
        type="button"
        disabled={busy}
        onclick={() => {
          if (!busy) retry?.();
        }}
      >
        {busy ? 'Working…' : retryLabel}
      </button>
    {/if}
    {@render children?.()}
  </div>
</section>
