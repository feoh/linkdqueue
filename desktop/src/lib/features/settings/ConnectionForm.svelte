<script lang="ts">
  import { onDestroy } from 'svelte';

  import type { LinkdqueueBridge } from '../../api/bridge';
  import { normalizeIpcError } from '../../api/errors';
  import type { AppError, SaveConnectionResult, Settings } from '../../api/types';

  type Props = {
    bridge: LinkdqueueBridge;
    saveConnection: (input: {
      baseUrl: string;
      newToken?: string;
      allowInsecureHttp?: boolean;
    }) => Promise<SaveConnectionResult>;
    onConfigured?: (settings: Settings) => void;
  };

  let { bridge, saveConnection, onConfigured }: Props = $props();
  let baseUrl = $state('');
  let newToken = $state('');
  let allowInsecureHttp = $state(false);
  let revision = $state(0);
  let testing = $state(false);
  let saving = $state(false);
  let testResult = $state<{ reachable: boolean; serverVersion: string | null } | null>(null);
  let error = $state<AppError | null>(null);

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

  function validate(): string | null {
    if (!baseUrl.trim() || !newToken) return 'Enter a Linkding URL and token.';
    try {
      const url = new globalThis.URL(baseUrl.trim());
      if (url.protocol !== 'https:' && url.protocol !== 'http:')
        return 'Enter an HTTP or HTTPS URL.';
      if (url.username || url.password || url.search || url.hash)
        return 'Enter a plain Linkding URL.';
    } catch {
      return 'Enter a valid Linkding URL.';
    }
    if (baseUrl.trim().toLowerCase().startsWith('http://') && !allowInsecureHttp) {
      return 'Allow HTTP only when you explicitly trust this local connection.';
    }
    return null;
  }

  async function testConnection() {
    if (testing || saving) return;
    const invalid = validate();
    if (invalid) {
      error = { code: 'invalid_input', message: invalid, retryable: false };
      return;
    }
    const capturedRevision = revision;
    const input = {
      baseUrl: baseUrl.trim(),
      newToken,
      ...(allowInsecureHttp ? { allowInsecureHttp: true } : {}),
    };
    testing = true;
    error = null;
    try {
      const result = await bridge.testConnection(input);
      if (capturedRevision === revision) testResult = result;
    } catch (rejected: unknown) {
      if (capturedRevision === revision) error = normalizeIpcError(rejected);
    } finally {
      // Do not erase a newer token entered while this request was in flight.
      if (capturedRevision === revision) newToken = '';
      testing = false;
    }
  }

  async function save() {
    if (testing || saving) return;
    const invalid = validate();
    if (invalid) {
      error = { code: 'invalid_input', message: invalid, retryable: false };
      return;
    }
    saving = true;
    error = null;
    try {
      const result = await saveConnection({
        baseUrl: baseUrl.trim(),
        newToken,
        ...(allowInsecureHttp ? { allowInsecureHttp: true } : {}),
      });
      if (result.settings.status === 'ready') {
        newToken = '';
        onConfigured?.(result.settings);
      } else {
        error = {
          code: 'internal_error',
          message: 'The connection was not configured.',
          retryable: true,
        };
      }
    } catch (rejected: unknown) {
      error = normalizeIpcError(rejected);
    } finally {
      saving = false;
    }
  }

  onDestroy(() => {
    newToken = '';
  });
</script>

<section class="connection-form" aria-labelledby="connection-form-title">
  <h2 id="connection-form-title">Connect to Linkding</h2>
  <p>Enter your Linkding server address and a personal API token.</p>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
  >
    <label for="connection-url">Linkding URL</label>
    <input
      id="connection-url"
      type="url"
      autocomplete="url"
      value={baseUrl}
      oninput={(event) => edit({ baseUrl: event.currentTarget.value })}
      placeholder="https://linkding.example"
    />
    <label for="connection-token">New API token</label>
    <input
      id="connection-token"
      type="password"
      autocomplete="new-password"
      value={newToken}
      oninput={(event) => edit({ newToken: event.currentTarget.value })}
    />
    <label class="connection-consent">
      <input
        type="checkbox"
        checked={allowInsecureHttp}
        onchange={(event) => edit({ allowInsecureHttp: event.currentTarget.checked })}
      />
      I understand that HTTP is unencrypted (local connections only).
    </label>
    {#if error}<p class="preference-error" role="alert">{error.message}</p>{/if}
    {#if testResult}
      <p role="status">{testResult.reachable ? 'Connection successful.' : 'Connection failed.'}</p>
    {/if}
    <div class="connection-actions">
      <button
        type="button"
        class="secondary-button"
        disabled={testing || saving}
        onclick={() => void testConnection()}
      >
        {testing ? 'Testing…' : 'Test connection'}
      </button>
      <button type="submit" class="primary-button" disabled={testing || saving}>
        {saving ? 'Saving…' : 'Save connection'}
      </button>
    </div>
  </form>
</section>
