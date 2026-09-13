import { writable, type Readable } from 'svelte/store';

import type { BookmarkScope } from '../api/types';
import { BOOKMARK_SEARCH_DEBOUNCE_MS } from './bookmarkFilters';

export type NavigationView = 'queue' | 'archive' | 'tags' | 'all-tagged' | 'settings';

export type NavigationState = {
  view: NavigationView;
  scope: BookmarkScope | null;
  tag: string | null;
  search: string;
};

const DEFAULT_NAVIGATION: NavigationState = {
  view: 'queue',
  scope: 'queue',
  tag: null,
  search: '',
};

const validViews = new Set<NavigationView>(['queue', 'archive', 'tags', 'all-tagged', 'settings']);

function viewScope(view: NavigationView): BookmarkScope | null {
  if (view === 'queue') return 'queue';
  if (view === 'archive') return 'archive';
  return null;
}

export function encodeNavigationHash(
  state: Pick<NavigationState, 'view' | 'scope' | 'tag'> & Partial<Pick<NavigationState, 'search'>>,
): string {
  const params = new URLSearchParams();
  const scope = viewScope(state.view) ?? state.scope;
  if (scope) params.set('scope', scope);
  if (state.tag) params.set('tag', state.tag);
  if (state.search) params.set('q', state.search);

  const query = params.toString();
  return `#/${state.view}${query ? `?${query}` : ''}`;
}

export function decodeNavigationHash(hash: string): NavigationState {
  const normalized = hash.startsWith('#') ? hash.slice(1) : hash;
  const [path, query = ''] = normalized.split('?', 2);
  const candidate = path.replace(/^\/+/, '') as NavigationView;
  const view = validViews.has(candidate) ? candidate : DEFAULT_NAVIGATION.view;
  const params = new URLSearchParams(query);
  const requestedScope = params.get('scope');
  const scope =
    viewScope(view) ??
    (requestedScope === 'archive' ? 'archive' : requestedScope === 'queue' ? 'queue' : null);
  const tag = params.get('tag');
  const search = params.get('q') ?? '';

  return { view, scope, tag, search };
}

export function createNavigationState(initialHash = ''): Readable<NavigationState> & {
  set: (next: Pick<NavigationState, 'view' | 'scope' | 'tag'>) => void;
  setSearch: (search: string) => void;
  resetSearch: () => void;
  destroy: () => void;
} {
  const initial = initialHash ? decodeNavigationHash(initialHash) : DEFAULT_NAVIGATION;
  const state = writable<NavigationState>(initial);
  let current = initial;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelSearch = () => {
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = null;
  };

  const unsubscribe = state.subscribe((next) => {
    current = next;
  });

  function publishHash(next: Pick<NavigationState, 'view' | 'scope' | 'tag'>) {
    cancelSearch();
    const nextState = { ...current, ...next, search: current.search };
    state.set(nextState);
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', encodeNavigationHash(nextState));
    }
  }

  function syncHash() {
    if (typeof window !== 'undefined') cancelSearch();
    state.set(decodeNavigationHash(window.location.hash));
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', syncHash);
    window.addEventListener('popstate', syncHash);
  }

  return {
    subscribe: state.subscribe,
    set: publishHash,
    setSearch: (search) => {
      cancelSearch();
      searchTimer = setTimeout(() => {
        searchTimer = null;
        const next = { ...current, search: search.trim() };
        state.set(next);
        if (typeof window !== 'undefined')
          window.history.pushState({}, '', encodeNavigationHash(next));
      }, BOOKMARK_SEARCH_DEBOUNCE_MS);
    },
    resetSearch: () => {
      cancelSearch();
      state.set({ ...current, search: '' });
    },
    destroy: () => {
      unsubscribe();
      cancelSearch();
      if (typeof window !== 'undefined') {
        window.removeEventListener('hashchange', syncHash);
        window.removeEventListener('popstate', syncHash);
      }
    },
  };
}

export const defaultNavigationState = DEFAULT_NAVIGATION;
