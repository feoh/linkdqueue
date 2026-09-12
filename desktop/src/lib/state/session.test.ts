import { QueryClient } from '@tanstack/svelte-query';
import { describe, expect, it } from 'vitest';

import type { LinkdqueueBridge } from '../api/bridge';
import type { Settings } from '../api/types';
import { accountQueryKey } from './queryClient';
import { createSessionController, type SessionState } from './session';

const readySettings = (generation: number): Settings => ({
  status: 'ready',
  canonicalBaseUrl: 'https://linkding.invalid',
  credentialStatus: 'available',
  errorCode: null,
  allowInsecureHttp: false,
  pendingCleanup: false,
  display: { theme: 'system', textScale: 1 },
  generation,
});

const unusedCommand = async (): Promise<never> => {
  throw new Error('unused command in session test');
};

function bridgeWith(overrides: Partial<LinkdqueueBridge>): LinkdqueueBridge {
  return {
    getSettings: async () => readySettings(1),
    testConnection: unusedCommand,
    saveConnection: unusedCommand,
    clearConnection: unusedCommand,
    setDisplayPreferences: unusedCommand,
    listBookmarks: unusedCommand,
    listTags: unusedCommand,
    createBookmark: unusedCommand,
    markRead: unusedCommand,
    replaceBookmarkTags: unusedCommand,
    archiveBookmark: unusedCommand,
    unarchiveBookmark: unusedCommand,
    deleteBookmark: unusedCommand,
    openExternalUrl: unusedCommand,
    ...overrides,
  };
}

function observe(controller: ReturnType<typeof createSessionController>) {
  let current: SessionState | undefined;
  const unsubscribe = controller.subscribe((next) => {
    current = next;
  });
  return {
    get current() {
      return current;
    },
    unsubscribe,
  };
}

describe('session bootstrap state', () => {
  it('waits through initializing settings before exposing the ready session', async () => {
    let calls = 0;
    const bridge = bridgeWith({
      getSettings: async () => {
        calls += 1;
        return calls === 1 ? { ...readySettings(0), status: 'initializing' } : readySettings(7);
      },
    });
    const controller = createSessionController(bridge, new QueryClient());
    const observed = observe(controller);

    const result = await controller.bootstrap();

    expect(calls).toBe(2);
    expect(result).toMatchObject({ kind: 'ready', generation: 7 });
    expect(observed.current).toMatchObject({ kind: 'ready', generation: 7 });

    observed.unsubscribe();
    controller.destroy();
  });

  it('classifies rejected credential access without exposing its message', async () => {
    const bridge = bridgeWith({
      getSettings: async () => {
        throw {
          code: 'keyring_locked',
          message: 'secret-backend-detail',
          retryable: true,
        };
      },
    });
    const controller = createSessionController(bridge, new QueryClient());

    const result = await controller.bootstrap();

    expect(result).toMatchObject({
      kind: 'error',
      source: 'credential',
      error: { code: 'keyring_locked', message: 'Secure credential storage is locked.' },
    });
    expect(JSON.stringify(result)).not.toContain('secret-backend-detail');
    controller.destroy();
  });

  it('retires account queries when a new credential generation is saved', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(accountQueryKey(1, 'bookmarks'), ['old-account']);
    const bridge = bridgeWith({
      saveConnection: async () => ({ settings: readySettings(2), warning: null }),
    });
    const controller = createSessionController(bridge, queryClient);

    await controller.saveConnection({ baseUrl: 'https://new.invalid', newToken: 'draft-token' });

    expect(queryClient.getQueryData(accountQueryKey(1, 'bookmarks'))).toBeUndefined();
    controller.destroy();
  });
});
