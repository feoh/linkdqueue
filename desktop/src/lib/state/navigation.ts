import { writable, type Readable } from 'svelte/store';

import type { BookmarkScope } from '../api/types';

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
  state: Pick<NavigationState, 'view' | 'scope' | 'tag'>,
): string {
  const params = new URLSearchParams();
  const scope = viewScope(state.view) ?? state.scope;
  if (scope) params.set('scope', scope);
  if (state.tag && state.view === 'all-tagged') params.set('tag', state.tag);

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
  const tag = view === 'all-tagged' ? params.get('tag') : null;

  return { view, scope, tag, search: '' };
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

  const unsubscribe = state.subscribe((next) => {
    current = next;
  });

  function publishHash(next: Pick<NavigationState, 'view' | 'scope' | 'tag'>) {
    const nextState = { ...current, ...next, search: current.search };
    state.set(nextState);
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', encodeNavigationHash(nextState));
    }
  }

  function syncHash() {
    if (typeof window !== 'undefined')
      state.set({ ...decodeNavigationHash(window.location.hash), search: current.search });
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', syncHash);
    window.addEventListener('popstate', syncHash);
  }

  return {
    subscribe: state.subscribe,
    set: publishHash,
    setSearch: (search) => state.set({ ...current, search }),
    resetSearch: () => state.set({ ...current, search: '' }),
    destroy: () => {
      unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('hashchange', syncHash);
        window.removeEventListener('popstate', syncHash);
      }
    },
  };
}

export const defaultNavigationState = DEFAULT_NAVIGATION;
