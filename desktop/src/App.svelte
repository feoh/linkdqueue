<script lang="ts">
  import { onMount } from 'svelte';

  import { createTauriBridge, type LinkdqueueBridge } from './lib/api/bridge';
  import AppShell from './lib/components/AppShell.svelte';
  import AddBookmarkDialog from './lib/features/bookmarks/AddBookmarkDialog.svelte';
  import BookmarkList from './lib/features/bookmarks/BookmarkList.svelte';
  import AllTaggedBookmarkList from './lib/features/bookmarks/AllTaggedBookmarkList.svelte';
  import TagCatalogueView from './lib/features/tags/TagCatalogueView.svelte';
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
  import { unsupportedTagMessage } from './lib/state/bookmarkFilters';
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
  let searchDraft = $state('');
  let addDialogOpen = $state(false);
  let displayError = $state('');
  let connectionWarning = $state('');
  let filterError = $state('');
  let refreshToken = $state(0);
  let lastClearGeneration = $state<number | null>(null);

  const navigationItems: Array<{ id: NavigationView; label: string }> = [
    { id: 'queue', label: 'Queue' },
    { id: 'archive', label: 'Archive' },
    { id: 'tags', label: 'Tags' },
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
      if (next.kind === 'ready' && tagCatalogue) {
        void tagCatalogue
          .load(next.generation)
          .then((snapshot) => {
            tagSuggestions = snapshot.tags.map((tag) => tag.name);
          })
          .catch(() => {
            tagSuggestions = [];
          });
      }
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
      searchDraft = next.search;
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
      tag: nextView === 'tags' ? null : navigationState.tag,
    });
  }

  function chooseTag(tag: string) {
    const message = unsupportedTagMessage(tag);
    if (message) {
      filterError = `${message} Choose another tag from the catalogue.`;
      return;
    }
    filterError = '';
    navigation.set({ ...navigationState, view: 'all-tagged', scope: null, tag });
  }

  function clearTag() {
    filterError = '';
    navigation.set({ ...navigationState, tag: null });
  }

  function activeTitle() {
    if (navigationState.view === 'all-tagged' && navigationState.tag)
      return `All tagged: ${navigationState.tag}`;
    return navigationItems.find((item) => item.id === navigationState.view)?.label ?? 'Queue';
  }

  async function clearConfiguredConnection() {
    if (!session || sessionState.kind !== 'ready') throw new Error('Not connected');
    lastClearGeneration = sessionState.generation;
    const result = await session.clearConnection({ generation: sessionState.generation });
    if (result.warning) {
      connectionWarning =
        result.warning === 'old_state_may_return'
          ? 'Cleanup is incomplete: old data may return after restart. Retry clear.'
          : 'Disconnected, but cleanup was incomplete. Retry clear.';
    }
    return result;
  }

  async function retryClear() {
    if (!session || lastClearGeneration === null) return;
    try {
      const result = await session.clearConnection({ generation: lastClearGeneration });
      if (!result.warning) {
        connectionWarning = '';
        lastClearGeneration = null;
      }
    } catch {
      /* leave the warning visible for another retry */
    }
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
    searchValue={searchDraft}
    searchLabel={navigationState.view === 'tags' ? 'Search tags' : 'Search bookmarks'}
    searchPlaceholder={navigationState.view === 'tags' ? 'Search tags' : 'Search bookmarks'}
    onSearch={(search) => {
      searchDraft = search;
      navigation.setSearch(search);
    }}
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

  {#if navigationState.view === 'all-tagged' && navigationState.tag}
    <nav class="filter-controls" aria-label="Tagged bookmark scope">
      <button
        class="secondary-button"
        type="button"
        aria-label="Set scope to All tagged"
        onclick={() => navigation.set({ ...navigationState, scope: null })}
        aria-pressed={navigationState.scope === null}>All tagged</button
      >
      <button
        class="secondary-button"
        type="button"
        aria-label="Set scope to Queue"
        onclick={() => navigation.set({ ...navigationState, scope: 'queue' })}
        aria-pressed={navigationState.scope === 'queue'}>Queue</button
      >
      <button
        class="secondary-button"
        type="button"
        aria-label="Set scope to Archive"
        onclick={() => navigation.set({ ...navigationState, scope: 'archive' })}
        aria-pressed={navigationState.scope === 'archive'}>Archive</button
      >
      <button class="secondary-button" type="button" onclick={() => selectView('tags')}
        >Back to Tags</button
      >
      <button class="secondary-button" type="button" onclick={() => (refreshToken += 1)}
        >Refresh</button
      >
    </nav>
  {:else if navigationState.scope}
    <nav class="filter-controls" aria-label="Bookmark filters">
      <button
        class="secondary-button"
        type="button"
        aria-label="Set scope to Queue"
        onclick={() => navigation.set({ ...navigationState, scope: 'queue' })}
        aria-pressed={navigationState.scope === 'queue'}>Queue</button
      >
      <button
        class="secondary-button"
        type="button"
        aria-label="Set scope to Archive"
        onclick={() => navigation.set({ ...navigationState, scope: 'archive' })}
        aria-pressed={navigationState.scope === 'archive'}>Archive</button
      >
      {#if navigationState.tag}
        <button class="tag-chip" type="button" onclick={clearTag}
          >Tag: {navigationState.tag} ×</button
        >
      {/if}
      {#if tagSuggestions.length}
        <select
          aria-label="Filter by tag"
          value={navigationState.tag ?? ''}
          onchange={(event) => event.currentTarget.value && chooseTag(event.currentTarget.value)}
        >
          <option value="">All tags</option>
          {#each tagSuggestions as tag (tag)}<option value={tag}>{tag}</option>{/each}
        </select>
      {/if}
      <button class="secondary-button" type="button" onclick={() => (refreshToken += 1)}
        >Refresh</button
      >
    </nav>
  {/if}
  {#if filterError}<p class="preference-error" role="alert">{filterError}</p>{/if}

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
        settings={sessionState.settings}
        saveConnection={session.saveConnection}
        onConfigured={(settings) => {
          if (settings.status === 'ready' && sessionState.kind === 'unconfigured')
            selectView('queue');
        }}
      />
    {/if}
  {:else}
    {#if navigationState.view === 'settings' && sessionState.settings}
      <ConnectionForm
        {bridge}
        settings={sessionState.settings}
        saveConnection={session!.saveConnection}
        clearConnection={clearConfiguredConnection}
      />
      <DisplayPreferences settings={sessionState.settings} onSave={saveDisplay} />
    {:else if sessionState.kind === 'ready' && navigationState.view === 'tags' && tagCatalogue}
      <TagCatalogueView
        catalogue={tagCatalogue}
        generation={sessionState.generation}
        search={navigationState.search}
        onSelect={chooseTag}
      />
    {:else if sessionState.kind === 'ready' && navigationState.view === 'all-tagged' && navigationState.tag}
      <AllTaggedBookmarkList
        {bridge}
        generation={sessionState.generation}
        tag={navigationState.tag}
        scope={navigationState.scope}
        query={navigationState.search}
        {refreshToken}
      />
    {:else if navigationState.view === 'all-tagged'}
      <StatusMessage
        variant="info"
        title="Choose a tag"
        message="All tagged results are available after selecting a tag from the Tags catalogue."
      />
    {:else if sessionState.kind === 'ready' && navigationState.scope}
      <BookmarkList
        {bridge}
        generation={sessionState.generation}
        scope={navigationState.scope}
        query={navigationState.search}
        tag={navigationState.tag ?? undefined}
        {refreshToken}
      />
    {:else}
      <StatusMessage
        variant="info"
        title="A calm place for your reading queue"
        message="Choose a section to browse your Linkding bookmarks."
      />
    {/if}
  {/if}

  {#if connectionWarning}
    <p class="preference-error" role="alert">{connectionWarning}</p>
    <button class="secondary-button" type="button" onclick={() => void retryClear()}
      >Retry clear</button
    >
  {/if}

  {#if displayError}
    <p class="preference-error" role="alert">{displayError}</p>
  {/if}

  {#if searchDraft}
    <p class="draft-note" role="status">Search draft: <strong>{searchDraft}</strong></p>
  {/if}
</AppShell>

<AddBookmarkDialog
  open={addDialogOpen}
  createBookmark={(input) => bookmarkMutations!.createBookmark(input)}
  suggestions={tagSuggestions}
  onClose={() => (addDialogOpen = false)}
/>
