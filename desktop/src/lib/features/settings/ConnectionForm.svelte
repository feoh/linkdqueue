<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { LinkdqueueBridge } from '../../api/bridge';
  import { normalizeIpcError } from '../../api/errors';
  import type {
    AppError,
    ClearConnectionResult,
    SaveConnectionResult,
    Settings,
  } from '../../api/types';

  type Props = {
    bridge: LinkdqueueBridge;
    saveConnection: (input: {
      baseUrl: string;
      newToken?: string;
      retainExistingToken?: boolean;
      allowInsecureHttp?: boolean;
    }) => Promise<SaveConnectionResult>;
    clearConnection?: () => Promise<ClearConnectionResult>;
    settings?: Settings | null;
    onConfigured?: (settings: Settings) => void;
  };

  let { bridge, saveConnection, clearConnection, settings, onConfigured }: Props = $props();
  let baseUrl = $state('');
  let newToken = $state('');
  let allowInsecureHttp = $state(false);
  let revision = $state(0);
  let testing = $state(false);
  let saving = $state(false);
  let clearing = $state(false);
  let initialized = $state(false);
  let testResult = $state<{ reachable: boolean; serverVersion: string | null } | null>(null);
  let error = $state<AppError | null>(null);
  let warning = $state<string | null>(null);

  $effect(() => {
    if (settings && !initialized) {
      baseUrl = settings.canonicalBaseUrl ?? '';
      allowInsecureHttp = settings.allowInsecureHttp;
      initialized = true;
    }
  });

  function edit(
    changes: Partial<{ baseUrl: string; newToken: string; allowInsecureHttp: boolean }>,
  ) {
    if (changes.baseUrl !== undefined) baseUrl = changes.baseUrl;
    if (changes.newToken !== undefined) newToken = changes.newToken;
    if (changes.allowInsecureHttp !== undefined) allowInsecureHttp = changes.allowInsecureHttp;
    revision += 1;
    testResult = null;
    error = null;
  }

  function canonicalEndpoint(value: string): string | null {
    try {
      const url = new globalThis.URL(value.trim());
      return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '') || ''}`;
    } catch {
      return null;
    }
  }
  function sameEndpoint() {
    return Boolean(
      settings?.canonicalBaseUrl &&
      canonicalEndpoint(baseUrl) === canonicalEndpoint(settings.canonicalBaseUrl),
    );
  }
  function validate(): string | null {
    if (!baseUrl.trim()) return 'Enter a Linkding URL.';
    try {
      const url = new globalThis.URL(baseUrl.trim());
      if (url.protocol !== 'https:' && url.protocol !== 'http:')
        return 'Enter an HTTP or HTTPS URL.';
      if (url.username || url.password || url.search || url.hash)
        return 'Enter a plain Linkding URL.';
    } catch {
      return 'Enter a valid Linkding URL.';
    }
    if (baseUrl.trim().toLowerCase().startsWith('http://') && !allowInsecureHttp)
      return 'Allow HTTP only when you explicitly trust this local connection.';
    if (!newToken && !sameEndpoint()) return 'Enter a new API token when changing the server URL.';
    return null;
  }

  async function testConnection() {
    if (testing || saving || clearing) return;
    const invalid = validate();
    if (invalid) {
      error = { code: 'invalid_input', message: invalid, retryable: false };
      return;
    }
    if (!newToken) {
      error = {
        code: 'invalid_input',
        message: 'Enter a token to test this connection.',
        retryable: false,
      };
      return;
    }
    const capturedRevision = revision;
    testing = true;
    error = null;
    try {
      const result = await bridge.testConnection({
        baseUrl: baseUrl.trim(),
        newToken,
        ...(allowInsecureHttp ? { allowInsecureHttp: true } : {}),
      });
      if (capturedRevision === revision) testResult = result;
    } catch (rejected: unknown) {
      if (capturedRevision === revision) error = normalizeIpcError(rejected);
    } finally {
      if (capturedRevision === revision) newToken = '';
      testing = false;
    }
  }

  async function save() {
    if (testing || saving || clearing) return;
    const invalid = validate();
    if (invalid) {
      error = { code: 'invalid_input', message: invalid, retryable: false };
      return;
    }
    saving = true;
    error = null;
    warning = null;
    try {
      const result = await saveConnection({
        baseUrl: baseUrl.trim(),
        ...(newToken ? { newToken } : { retainExistingToken: true }),
        ...(allowInsecureHttp ? { allowInsecureHttp: true } : {}),
      });
      if (result.settings.status === 'ready') {
        newToken = '';
        if (result.warning === 'old_credential_cleanup_failed')
          warning = 'The old credential could not be cleaned up. Retry replacement.';
        onConfigured?.(result.settings);
      } else
        error = {
          code: 'internal_error',
          message: 'The connection was not configured.',
          retryable: true,
        };
    } catch (rejected: unknown) {
      error = normalizeIpcError(rejected);
    } finally {
      saving = false;
    }
  }

  async function clear() {
    if (!clearConnection || clearing || saving || testing) return;
    if (!globalThis.confirm('Clear this connection and disconnect?')) return;
    clearing = true;
    error = null;
    warning = null;
    try {
      const result = await clearConnection();
      if (result.warning)
        warning =
          result.warning === 'old_state_may_return'
            ? 'Cleanup is incomplete: old data may return after restart. Retry clear.'
            : 'Disconnected, but cleanup was incomplete. Retry clear.';
    } catch (rejected: unknown) {
      error = normalizeIpcError(rejected);
    } finally {
      clearing = false;
    }
  }
  onDestroy(() => {
    newToken = '';
  });
</script>

<section class="connection-form" aria-labelledby="connection-form-title">
  <h2 id="connection-form-title">
    {settings?.status === 'ready' ? 'Connection' : 'Connect to Linkding'}
  </h2>
  {#if settings?.status === 'ready'}
    <p>Current server: <strong>{settings.canonicalBaseUrl}</strong></p>
    <p role="status">Credential status: {settings.credentialStatus ?? 'unavailable'}</p>
  {:else}<p>Enter your Linkding server address and a personal API token.</p>{/if}
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
  >
    <label for="connection-url"
      >{settings?.status === 'ready' ? 'Server address' : 'Linkding URL'}</label
    >
    <input
      id="connection-url"
      type="url"
      autocomplete="url"
      value={baseUrl}
      oninput={(event) => edit({ baseUrl: event.currentTarget.value })}
      placeholder="https://linkding.example"
    />
    <label for="connection-token"
      >{sameEndpoint() ? 'New API token (optional)' : 'New API token'}</label
    >
    <input
      id="connection-token"
      type="password"
      autocomplete="new-password"
      value={newToken}
      oninput={(event) => edit({ newToken: event.currentTarget.value })}
    />
    <label class="connection-consent"
      ><input
        type="checkbox"
        checked={allowInsecureHttp}
        onchange={(event) => edit({ allowInsecureHttp: event.currentTarget.checked })}
      /> I understand that HTTP is unencrypted (local connections only).</label
    >
    {#if error}<p class="preference-error" role="alert">{error.message}</p>{/if}
    {#if warning}<p class="preference-error" role="alert">{warning}</p>{/if}
    {#if settings?.errorCode === 'keyring_locked' || settings?.errorCode === 'keyring_unavailable' || settings?.errorCode === 'credential_missing'}<p
        class="preference-error"
        role="note"
      >
        Unlock or migrate your desktop credential store, then reconnect with a new token.
      </p>{/if}
    {#if testResult}<p role="status">
        {testResult.reachable ? 'Connection successful.' : 'Connection failed.'}
      </p>{/if}
    <div class="connection-actions">
      <button
        type="button"
        class="secondary-button"
        disabled={testing || saving || clearing}
        onclick={() => void testConnection()}>{testing ? 'Testing…' : 'Test connection'}</button
      >
      <button type="submit" class="primary-button" disabled={testing || saving || clearing}
        >{saving ? 'Saving…' : 'Save connection'}</button
      >
      {#if clearConnection}<button
          type="button"
          class="secondary-button"
          disabled={testing || saving || clearing}
          onclick={() => void clear()}>{clearing ? 'Clearing…' : 'Clear connection'}</button
        >{/if}
    </div>
  </form>
</section>
