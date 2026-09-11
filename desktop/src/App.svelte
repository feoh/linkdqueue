<script lang="ts">
  type View = 'queue' | 'archive' | 'tags' | 'settings';

  let activeView: View = 'queue';
  let search = '';

  const navigation: Array<{ id: View; label: string }> = [
    { id: 'queue', label: 'Queue' },
    { id: 'archive', label: 'Archive' },
    { id: 'tags', label: 'Tags' },
    { id: 'settings', label: 'Settings' },
  ];

  function selectView(view: View) {
    activeView = view;
  }
</script>

<svelte:head>
  <meta name="description" content="A focused desktop reading queue for Linkding." />
</svelte:head>

<div class="app-shell">
  <aside class="sidebar" aria-label="Primary navigation">
    <a
      class="brand"
      href="/"
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
        {#each navigation as item (item.id)}
          <li>
            <button
              class:active={activeView === item.id}
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
        <p class="eyebrow">Desktop preview</p>
        <h1>{navigation.find((item) => item.id === activeView)?.label}</h1>
      </div>
      <label class="search-field">
        <span class="sr-only">Search bookmarks</span>
        <input bind:value={search} type="search" placeholder="Search bookmarks" />
      </label>
    </header>

    <section class="welcome-card" aria-labelledby="welcome-heading">
      <p class="status-badge">Foundation ready</p>
      <h2 id="welcome-heading">A calm place for your reading queue.</h2>
      <p>
        The desktop workspace is connected to local bundled assets only. Linkding connection and
        bookmark workflows arrive in the next implementation tasks.
      </p>
      {#if search}
        <p class="draft-note">Search draft: <strong>{search}</strong></p>
      {/if}
    </section>
  </main>
</div>
