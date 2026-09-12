<script lang="ts">
  import { onMount } from 'svelte';

  import { createTauriBridge, type LinkdqueueBridge } from './lib/api/bridge';
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

  function selectView(view: NavigationView) {
    navigation.set({
      view,
      scope: view === 'queue' ? 'queue' : view === 'archive' ? 'archive' : null,
      tag: null,
    });
  }
</script>

<svelte:head>
  <meta name="description" content="A focused desktop reading queue for Linkding." />
</svelte:head>

<div class="app-shell">
  <aside class="sidebar" aria-label="Primary navigation">
    <a
      class="brand"
      href="#/queue?scope=queue"
      aria-label="Linkdqueue Desktop home"
      onclick={(event) => {
        event.preventDefault();
        selectView('queue');
      }}
    >
      <span class="brand-mark" aria-hidden="true">L</span>
      <span>Linkdqueue</span>
    </a>

    <nav>
      <ul>
        {#each navigationItems as item (item.id)}
          <li>
            <button
              class:active={navigationState.view === item.id}
              type="button"
              onclick={() => selectView(item.id)}
            >
              {item.label}
            </button>
          </li>
        {/each}
      </ul>
    </nav>
  </aside>

  <main class="content">
    <header class="toolbar">
      <div>
        <p class="eyebrow">{sessionState.kind === 'ready' ? 'Connected' : 'Desktop preview'}</p>
        <h1>{navigationItems.find((item) => item.id === navigationState.view)?.label}</h1>
      </div>
      <label class="search-field">
        <span class="sr-only">Search bookmarks</span>
        <input
          value={navigationState.search}
          oninput={(event) => navigation.setSearch(event.currentTarget.value)}
          type="search"
          placeholder="Search bookmarks"
        />
      </label>
    </header>

    {#if sessionState.kind === 'loading'}
      <p class="welcome-card" role="status">Loading desktop settings…</p>
    {:else if sessionState.kind === 'unconfigured'}
      <section class="welcome-card" aria-labelledby="welcome-heading">
        <p class="status-badge">Setup required</p>
        <h2 id="welcome-heading">Connect Linkdqueue to Linkding.</h2>
        <p>Your saved connection is not configured. Enter it in Settings to begin.</p>
      </section>
    {:else if sessionState.kind === 'error'}
      <section class="welcome-card" aria-labelledby="error-heading">
        <p class="status-badge">
          {sessionState.source === 'credential' ? 'Credential error' : 'Storage error'}
        </p>
        <h2 id="error-heading">Desktop settings need attention.</h2>
        <p>{sessionState.error.message}</p>
        <button type="button" onclick={() => session && void session.retry()}>Retry</button>
      </section>
    {:else}
      <section class="welcome-card" aria-labelledby="welcome-heading">
        <p class="status-badge">Foundation ready</p>
        <h2 id="welcome-heading">A calm place for your reading queue.</h2>
        <p>Choose a section to browse your Linkding bookmarks.</p>
      </section>
    {/if}

    {#if navigationState.search}
      <p class="draft-note">Search draft: <strong>{navigationState.search}</strong></p>
    {/if}
  </main>
</div>
