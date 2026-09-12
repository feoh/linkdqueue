import { writable, type Readable } from 'svelte/store';
import type { QueryClient } from '@tanstack/svelte-query';

import type { LinkdqueueBridge } from '../api/bridge';
import { normalizeIpcError } from '../api/errors';
import type {
  AppError,
  ClearConnectionInput,
  ClearConnectionResult,
  ErrorCode,
  SaveConnectionInput,
  SaveConnectionResult,
  Settings,
  SetDisplayPreferencesInput,
} from '../api/types';
import { retireAccountQueries } from './queryClient';

export type SessionState =
  | { kind: 'loading' }
  | { kind: 'unconfigured'; settings: Settings }
  | { kind: 'ready'; generation: number; settings: Settings }
  | { kind: 'error'; source: 'credential' | 'storage'; error: AppError; settings: Settings | null };

const INITIAL_STATE: SessionState = { kind: 'loading' };

const errorMessages: Record<ErrorCode, string> = {
  invalid_input: 'The connection details are invalid.',
  invalid_base_url: 'The Linkding URL is invalid.',
  insecure_http: 'Use HTTPS, or explicitly allow local HTTP.',
  preferences_corrupt: 'Saved preferences could not be read.',
  preferences_write_failed: 'Preferences could not be saved.',
  keyring_unavailable: 'The desktop credential store is unavailable.',
  keyring_locked: 'Unlock the desktop credential store and retry.',
  credential_missing: 'The saved Linkding credential is missing.',
  credential_delete_failed: 'The Linkding credential could not be cleared.',
  auth_failed: 'Linkding authentication failed.',
  permission_denied: 'The desktop credential store denied access.',
  not_found: 'The requested Linkding resource was not found.',
  bad_request: 'Linkding rejected the request.',
  rate_limited: 'Linkding is rate limiting requests.',
  server_error: 'Linkding returned a server error.',
  network_error: 'Linkding could not be reached.',
  timeout_unknown_outcome: 'The request timed out before its result was known.',
  stale_generation: 'This view is out of date; retry it.',
  external_url_rejected: 'The external URL was rejected.',
  internal_error: 'The desktop service could not complete the request.',
};

function errorFromSettings(settings: Settings): AppError {
  const code = settings.errorCode ?? 'internal_error';
  return {
    code,
    message: errorMessages[code],
    retryable: true,
    generation: settings.generation,
  };
}

function errorSource(code: ErrorCode): 'credential' | 'storage' {
  if (
    code === 'keyring_unavailable' ||
    code === 'keyring_locked' ||
    code === 'credential_missing' ||
    code === 'permission_denied'
  ) {
    return 'credential';
  }
  return 'storage';
}

function stateFromSettings(settings: Settings): SessionState {
  if (settings.status === 'initializing') return { kind: 'loading' };
  if (settings.status === 'unconfigured') return { kind: 'unconfigured', settings };
  if (settings.status === 'ready') {
    return { kind: 'ready', generation: settings.generation, settings };
  }
  const error = errorFromSettings(settings);
  return { kind: 'error', source: errorSource(error.code), error, settings };
}

function currentGeneration(state: SessionState): number | null {
  if (state.kind === 'loading') return null;
  if (state.kind === 'ready') return state.generation;
  return state.settings?.generation ?? null;
}

const waitForSettings = () => new Promise<void>((resolve) => setTimeout(resolve, 25));

export type SessionController = Readable<SessionState> & {
  bootstrap: () => Promise<SessionState>;
  retry: () => Promise<SessionState>;
  saveConnection: (input: SaveConnectionInput) => Promise<SaveConnectionResult>;
  clearConnection: (input: ClearConnectionInput) => Promise<ClearConnectionResult>;
  setDisplayPreferences: (input: SetDisplayPreferencesInput) => Promise<Settings>;
  destroy: () => void;
};

export function createSessionController(
  bridge: LinkdqueueBridge,
  queryClient: QueryClient,
): SessionController {
  const state = writable<SessionState>(INITIAL_STATE);
  let current: SessionState = INITIAL_STATE;
  let epoch = 0;
  const unsubscribe = state.subscribe((next) => {
    current = next;
  });

  async function bootstrap(): Promise<SessionState> {
    const attempt = ++epoch;
    state.set({ kind: 'loading' });
    try {
      let settings = await bridge.getSettings();
      while (settings.status === 'initializing' && attempt === epoch) {
        await waitForSettings();
        if (attempt !== epoch) return current;
        settings = await bridge.getSettings();
      }
      if (attempt !== epoch) return current;
      const next = stateFromSettings(settings);
      state.set(next);
      return next;
    } catch (rejected: unknown) {
      if (attempt !== epoch) return current;
      const error = normalizeIpcError(rejected);
      const next: SessionState = {
        kind: 'error',
        source: errorSource(error.code),
        error,
        settings: null,
      };
      state.set(next);
      return next;
    }
  }

  async function retireSessionState(): Promise<void> {
    epoch += 1;
    await retireAccountQueries(queryClient);
  }

  async function saveConnection(input: SaveConnectionInput): Promise<SaveConnectionResult> {
    await retireSessionState();
    try {
      const result = await bridge.saveConnection(input);
      const next = stateFromSettings(result.settings);
      state.set(next);
      return result;
    } catch (rejected: unknown) {
      const error = normalizeIpcError(rejected);
      const generation = currentGeneration(current);
      if (error.generation === undefined || error.generation === generation) {
        state.set({ kind: 'error', source: errorSource(error.code), error, settings: null });
      }
      throw error;
    }
  }

  async function clearConnection(input: ClearConnectionInput): Promise<ClearConnectionResult> {
    await retireSessionState();
    try {
      const result = await bridge.clearConnection(input);
      await bootstrap();
      return result;
    } catch (rejected: unknown) {
      const error = normalizeIpcError(rejected);
      const generation = currentGeneration(current);
      if (error.generation === undefined || error.generation === generation) {
        state.set({ kind: 'error', source: errorSource(error.code), error, settings: null });
      }
      throw error;
    }
  }

  async function setDisplayPreferences(input: SetDisplayPreferencesInput): Promise<Settings> {
    try {
      const settings = await bridge.setDisplayPreferences(input);
      const next = stateFromSettings(settings);
      state.set(next);
      return settings;
    } catch (rejected: unknown) {
      const error = normalizeIpcError(rejected);
      const generation = currentGeneration(current);
      // A display write failure must not discard the usable session or credentials.
      // Keep the previous settings so the picker can offer an inline retry.
      if (error.generation === undefined || error.generation === generation) {
        if (current.kind !== 'loading' && current.settings) {
          state.set(current);
        } else {
          state.set({ kind: 'error', source: errorSource(error.code), error, settings: null });
        }
      }
      throw error;
    }
  }

  return {
    subscribe: state.subscribe,
    bootstrap,
    retry: bootstrap,
    saveConnection,
    clearConnection,
    setDisplayPreferences,
    destroy: () => {
      epoch += 1;
      unsubscribe();
    },
  };
}

export const initialSessionState = INITIAL_STATE;
