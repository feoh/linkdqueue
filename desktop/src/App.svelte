<script lang="ts">
  import { onMount } from 'svelte';

  import { createTauriBridge, type LinkdqueueBridge } from './lib/api/bridge';
  import AppShell from './lib/components/AppShell.svelte';
  import AddBookmarkDialog from './lib/features/bookmarks/AddBookmarkDialog.svelte';
  import DisplayPreferences from './lib/components/DisplayPreferences.svelte';
  import ConnectionForm from './lib/features/settings/ConnectionForm.svelte';
  import StatusMessage from './lib/components/StatusMessage.svelte';
  import Toolbar from './lib/components/Toolbar.svelte';
  import {
    createNavigationState,
    defaultNavigationState,
    type NavigationState,
    type NavigationView,
  } from './lib/state/navigation';
  import { BookmarkMutations } from './lib/queries/mutations';
  import { TagCatalogue } from './lib/queries/tags';
  import { ACCOUNT_QUERY_KEY, createAppQueryClient } from './lib/state/queryClient';
  import { applyDisplay, clearDisplayListener } from './lib/state/display';
  import {
    createSessionController,
    initialSessionState,
    type SessionController,
    type SessionState,
  } from './lib/state/session';

  let { bridge = createTauriBridge() }: { bridge?: LinkdqueueBridge } = $props();

  const queryClient = createAppQueryClient();
  let session: SessionController | null = $state(null);
  let bookmarkMutations = $state<BookmarkMutations | null>(null);
  let tagCatalogue = $state<TagCatalogue | null>(null);
  let tagSuggestions = $state<string[]>([]);
  const navigation = createNavigationState(
    typeof globalThis.window === 'undefined' ? '' : globalThis.window.location.hash,
  );

  let sessionState: SessionState = $state(initialSessionState);
  let navigationState: NavigationState = $state(defaultNavigationState);
  let addDialogOpen = $state(false);
  let displayError = $state('');

  const navigationItems: Array<{ id: NavigationView; label: string }> = [
    { id: 'queue', label: 'Queue' },
    { id: 'archive', label: 'Archive' },
    { id: 'tags', label: 'Tags' },
    { id: 'all-tagged', label: 'All tagged' },
    { id: 'settings', label: 'Settings' },
  ];

  onMount(() => {
    bookmarkMutations = new BookmarkMutations(
      bridge,
      queryClient,
      () => (sessionState.kind === 'ready' ? sessionState.generation : null),
      async (generation) => {
        await queryClient.refetchQueries({ queryKey: [ACCOUNT_QUERY_KEY, generation] });
      },
    );
    tagCatalogue = new TagCatalogue(bridge);
    const controller = createSessionController(bridge, queryClient);
    session = controller;
    let lastGeneration: number | null = null;
    const unsubscribeSession = controller.subscribe((next) => {
      sessionState = next;
      if (next.kind === 'ready' || next.kind === 'unconfigured')
        applyDisplay(next.settings.display);
      if (next.kind === 'ready' || next.kind === 'unconfigured') displayError = '';
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
      clearDisplayListener();
      navigation.destroy();
    };
  });

  function openAddBookmark() {
    if (sessionState.kind !== 'ready' || !tagCatalogue) return;
    addDialogOpen = true;
    void tagCatalogue
      .load(sessionState.generation)
      .then((snapshot) => {
        tagSuggestions = snapshot.tags.map((tag) => tag.name);
      })
      .catch(() => {
        tagSuggestions = [];
      });
  }

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

  async function saveDisplay(theme: string, textScale: number) {
    if (!session || (sessionState.kind !== 'ready' && sessionState.kind !== 'unconfigured')) return;
    const previous = sessionState.settings;
    try {
      applyDisplay({ theme, textScale });
      await session.setDisplayPreferences({ generation: previous.generation, theme, textScale });
    } catch {
      displayError =
        'Preferences could not be saved. Your previous settings remain active; try again.';
      applyDisplay(previous.display);
      throw new Error('display preferences save failed');
    }
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
      onclick={openAddBookmark}
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
  {:else if sessionState.kind === 'unconfigured' || sessionState.kind === 'error'}
    {#if sessionState.kind === 'error'}
      <StatusMessage
        variant="error"
        title="Desktop settings need attention"
        message={sessionState.error.message}
        retry={() => session && void session.retry()}
      />
    {/if}
    {#if session}
      <ConnectionForm
        {bridge}
        saveConnection={session.saveConnection}
        onConfigured={(settings) => {
          if (settings.status === 'ready') selectView('queue');
        }}
      />
    {/if}
  {:else}
    {#if navigationState.view === 'settings' && sessionState.settings}
      <DisplayPreferences settings={sessionState.settings} onSave={saveDisplay} />
    {:else}
      <StatusMessage
        variant="info"
        title="A calm place for your reading queue"
        message="Choose a section to browse your Linkding bookmarks."
      />
    {/if}
  {/if}

  {#if displayError}
    <p class="preference-error" role="alert">{displayError}</p>
  {/if}

  {#if navigationState.search}
    <p class="draft-note" role="status">Search draft: <strong>{navigationState.search}</strong></p>
  {/if}
</AppShell>

<AddBookmarkDialog
  open={addDialogOpen}
  createBookmark={(input) => bookmarkMutations!.createBookmark(input)}
  suggestions={tagSuggestions}
  onClose={() => (addDialogOpen = false)}
/>
