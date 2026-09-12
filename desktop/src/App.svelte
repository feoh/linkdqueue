<script lang="ts">
  import { onMount } from 'svelte';

  import { createTauriBridge, type LinkdqueueBridge } from './lib/api/bridge';
  import AppShell from './lib/components/AppShell.svelte';
  import Dialog from './lib/components/Dialog.svelte';
  import StatusMessage from './lib/components/StatusMessage.svelte';
  import Toolbar from './lib/components/Toolbar.svelte';
  import {
    createNavigationState,
    defaultNavigationState,
    type NavigationState,
    type NavigationView,
  } from './lib/state/navigation';
  import { createAppQueryClient } from './lib/state/queryClient';
  import {
    createSessionController,
    initialSessionState,
    type SessionController,
    type SessionState,
  } from './lib/state/session';

  let { bridge = createTauriBridge() }: { bridge?: LinkdqueueBridge } = $props();

  const queryClient = createAppQueryClient();
  let session: SessionController | null = $state(null);
  const navigation = createNavigationState(
    typeof globalThis.window === 'undefined' ? '' : globalThis.window.location.hash,
  );

  let sessionState: SessionState = $state(initialSessionState);
  let navigationState: NavigationState = $state(defaultNavigationState);
  let addDialogOpen = $state(false);

  const navigationItems: Array<{ id: NavigationView; label: string }> = [
    { id: 'queue', label: 'Queue' },
    { id: 'archive', label: 'Archive' },
    { id: 'tags', label: 'Tags' },
    { id: 'all-tagged', label: 'All tagged' },
    { id: 'settings', label: 'Settings' },
  ];

  onMount(() => {
    const controller = createSessionController(bridge, queryClient);
    session = controller;
    let lastGeneration: number | null = null;
    const unsubscribeSession = controller.subscribe((next) => {
      sessionState = next;
      const generation = next.kind === 'ready' ? next.generation : null;
      if (
        next.kind === 'unconfigured' ||
        next.kind === 'error' ||
        (generation !== null && lastGeneration !== null && generation !== lastGeneration)
      ) {
        navigation.resetSearch();
      }
      if (generation !== null) lastGeneration = generation;
    });
    const unsubscribeNavigation = navigation.subscribe((next) => {
      navigationState = next;
    });
    void controller.bootstrap();

    return () => {
      unsubscribeSession();
      unsubscribeNavigation();
      controller.destroy();
      navigation.destroy();
    };
  });

  function selectView(view: string) {
    const nextView = view as NavigationView;
    navigation.set({
      view: nextView,
      scope: nextView === 'queue' ? 'queue' : nextView === 'archive' ? 'archive' : null,
      tag: null,
    });
  }

  function activeTitle() {
    return navigationItems.find((item) => item.id === navigationState.view)?.label ?? 'Queue';
  }
</script>

<svelte:head>
  <meta name="description" content="A focused desktop reading queue for Linkding." />
</svelte:head>

<AppShell items={navigationItems} activeId={navigationState.view} onNavigate={selectView}>
  <Toolbar
    eyebrow={sessionState.kind === 'ready' ? 'Connected' : 'Desktop preview'}
    title={activeTitle()}
    searchValue={navigationState.search}
    onSearch={(search) => navigation.setSearch(search)}
  >
    <button
      class="secondary-button"
      type="button"
      disabled={sessionState.kind !== 'ready'}
      onclick={() => (addDialogOpen = true)}
    >
      New bookmark
    </button>
  </Toolbar>

  {#if sessionState.kind === 'loading'}
    <StatusMessage
      variant="loading"
      title="Loading your desktop settings"
      message="Checking the local connection state before showing your bookmarks."
    />
  {:else if sessionState.kind === 'unconfigured'}
    <StatusMessage
      variant="info"
      title="Connect Linkdqueue to Linkding"
      message="Your saved connection is not configured. Enter it in Settings to begin."
    >
      <button class="secondary-button" type="button" onclick={() => selectView('settings')}>
        Open Settings
      </button>
    </StatusMessage>
  {:else if sessionState.kind === 'error'}
    <StatusMessage
      variant="error"
      title="Desktop settings need attention"
      message={sessionState.error.message}
      retry={() => session && void session.retry()}
    />
  {:else}
    <StatusMessage
      variant="info"
      title="A calm place for your reading queue"
      message="Choose a section to browse your Linkding bookmarks."
    />
  {/if}

  {#if navigationState.search}
    <p class="draft-note" role="status">Search draft: <strong>{navigationState.search}</strong></p>
  {/if}
</AppShell>

<Dialog
  id="new-bookmark-dialog"
  open={addDialogOpen}
  title="New bookmark"
  description="Bookmark creation will be available from this dialog."
  onClose={() => (addDialogOpen = false)}
>
  <p class="dialog-placeholder">The connection is ready. The bookmark form is coming next.</p>
</Dialog>
