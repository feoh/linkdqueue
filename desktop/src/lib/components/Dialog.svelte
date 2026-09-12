<script lang="ts">
  /* global HTMLDialogElement, HTMLElement, KeyboardEvent, MouseEvent, document, queueMicrotask */
  import type { Snippet } from 'svelte';

  let {
    id = 'app-dialog',
    open = false,
    title,
    description,
    onClose,
    children,
    actions,
  }: {
    id?: string;
    open?: boolean;
    title: string;
    description?: string;
    onClose?: () => void;
    children?: Snippet;
    actions?: Snippet;
  } = $props();

  let dialog: HTMLDialogElement;
  let lastFocused: HTMLElement | null = null;
  const titleId = $derived(`${id}-title`);
  const descriptionId = $derived(`${id}-description`);

  $effect(() => {
    if (!dialog) return;

    if (open && !dialog.open) {
      lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
      queueMicrotask(() => {
        const autofocus = dialog.querySelector<HTMLElement>('[autofocus]');
        (autofocus ?? dialog).focus();
      });
    } else if (!open && dialog.open) {
      closeDialog();
    }
  });

  function restoreFocus() {
    queueMicrotask(() => {
      if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
      lastFocused = null;
    });
  }

  function handleNativeClose() {
    onClose?.();
    restoreFocus();
  }

  function closeDialog() {
    if (!dialog) return;
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
      handleNativeClose();
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === dialog) closeDialog();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
    }
  }
</script>

<dialog
  bind:this={dialog}
  {id}
  aria-labelledby={titleId}
  aria-describedby={description ? descriptionId : undefined}
  aria-modal="true"
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
  onclose={handleNativeClose}
>
  <form class="dialog-panel" method="dialog">
    <header class="dialog-header">
      <h2 id={titleId}>{title}</h2>
      <button class="icon-button" type="button" aria-label="Close dialog" onclick={closeDialog}
        >×</button
      >
    </header>
    {#if description}
      <p id={descriptionId} class="dialog-description">{description}</p>
    {/if}
    <div class="dialog-body">
      {@render children?.()}
    </div>
    {#if actions}
      <footer class="dialog-actions">
        {@render actions()}
      </footer>
    {/if}
  </form>
</dialog>
