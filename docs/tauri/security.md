# Desktop security contract

Status: implementation contract. This document does not claim that any native
store or signed build has already been exercised. Native checks are required by
N01/Q07 on each supported OS.

## Security boundaries

The Tauri main window is the only renderer. Svelte owns presentation, query
state, and short-lived form drafts; Rust owns URL validation, HTTP, credential
access, preferences, generation checks, and the constrained external opener.
There is no renderer-side Linkding HTTP client.

The production capability set grants the main window only the named commands in
[`ipc.md`](ipc.md). It grants no generic HTTP, filesystem, shell, SQL, remote
content, or arbitrary URL-open command. A second window and any remote origin
receive no application command permissions. No bookmark text is interpreted as
HTML/Markdown, and no favicon, preview, archive, or website URL is loaded by
the renderer.

The bundled window has a strict CSP: scripts and styles are bundled from the
application, frames/objects/workers are disabled, and network connections are
not granted to the renderer. The CSP must retain only the Tauri IPC transport
exception required by the chosen Tauri 2 version. A CSP/capability test must
fail if a remote origin, broad shell permission, or unrestricted opener is
introduced.

## Native credential store

The selected backend is `keyring = 3.6.3` (exactly pinned during foundation)
with these features:

```toml
keyring = { version = "=3.6.3", default-features = false, features = [
  "apple-native",
  "windows-native",
  "sync-secret-service",
  "vendored",
] }
```

Evidence:

- [keyring-rs v3.6.3 Cargo features](https://github.com/open-source-cooperative/keyring-rs/blob/v3.6.3/Cargo.toml)
- [keyring-rs v3.6.3 platform documentation](https://github.com/open-source-cooperative/keyring-rs/blob/v3.6.3/README.md)
- [keyring-rs v3.6.3 error model](https://github.com/open-source-cooperative/keyring-rs/blob/v3.6.3/src/error.rs)

This selects macOS Keychain through `security-framework`, Windows Credential
Manager through `windows-sys`, and the synchronous DBus Secret Service on
Linux through `dbus-secret-service`. `vendored` avoids requiring a separately
installed `libdbus` development library at runtime/build packaging time; a
Secret Service provider (for example GNOME Keyring or KWallet) and an unlocked
user session are still runtime prerequisites. Secret Service calls are
synchronous, so Rust must keep them off the UI async executor thread and
serialize access to a credential. Windows credential operations are also
serialized per credential.

A keyring `NoEntry` means missing credential, not a recoverable secret. `NoStorageAccess`
or a platform failure means unavailable/locked/policy-blocked storage. Map
these to typed errors without including platform error text in user-visible
logs or IPC. There is no plaintext fallback, environment-variable fallback, or
legacy Flutter-store migration. A missing/unavailable native store blocks save
and durable clear rather than silently weakening storage.

The isolated namespace is:

- service: `com.feoh.linkdqueue.desktop.v1`;
- account/user: `linkdqueue/v1/<base32url-no-pad(SHA-256(canonicalBaseUrl))>`;
- value: the Linkding token only.

The endpoint is not a credential or token. It may be retained in preferences,
but only a deterministic digest is used as the keyring account name. This
namespace is intentionally different from the Flutter application. The client
never reads or deletes Flutter preferences or Flutter keyring entries.

## Non-secret preferences

Preferences are an atomic JSON document in the Tauri app-config directory,
never in the keyring and never in a renderer-readable arbitrary file:

```json
{
  "schemaVersion": 1,
  "generation": 7,
  "connection": {
    "state": "configured",
    "canonicalBaseUrl": "https://bookmarks.invalid/linkding",
    "credentialRef": "linkdqueue/v1/<digest>",
    "allowInsecureHttp": false,
    "pendingCleanup": null
  },
  "display": {"theme": "system", "textScale": 1.0}
}
```

`state` is `first_boot`, `configured`, or `disconnected`. The document may
contain only schema-versioned non-secret values: canonical endpoint,
credential reference, generation, connection state, pending cleanup metadata,
and display preferences. Never serialize a token, authorization header, draft
value, or keyring error detail. Write a temp file, flush/sync it, atomically
rename it, and apply restrictive file permissions where the platform supports
them.

On first boot, absence means `first_boot`. A corrupt/unknown-version document
fails closed as `disconnected`, preserves the original for diagnostics/recovery
without logging its contents, and returns `preferences_corrupt`; it is not
silently replaced with a configured state. Unsupported display values use safe
default display values only after recording a typed migration error. No legacy
Flutter preferences are read or deleted.

## Canonical endpoints and transport

Accept only an absolute URL with an `https` scheme by default, a non-empty
host, no username/password, no query, and no fragment. Preserve a reverse
proxy path, decode nothing that changes its meaning, remove trailing slashes
(except the root path), lowercase scheme/host, and remove only the default
port. Reject malformed percent escapes, unsupported schemes, and ambiguous
normalization. Canonical equality is byte equality after this defined
normalization; it is used to decide whether an existing credential may be
retained.

`http` is accepted only when the user explicitly checks an opt-in persisted in
the same connection save operation, the UI shows a durable warning, and the
host is `localhost`, a loopback/private/link-local IP, or another explicitly
approved self-hosted local address. Public HTTP is rejected. The setting is
not inferred from a prior URL or from a redirect. TLS certificate and hostname
validation remain enabled for HTTPS. `reqwest` uses a no-redirect policy;
redirect responses are reported with canonical-URL guidance and are never
followed.

HTTP timeouts are bounded. A timeout or connection drop after a mutating
request is `unknown_outcome`, not success: do not replay POST/PATCH/DELETE
automatically. The UI gives reconciliation guidance. A process disconnect or
new connection invalidates the old generation and prevents new requests, but
cannot undo bytes already accepted by the previous server.

## Credential transactions

All connection mutations take a process-wide connection lock and increment the
generation before invalidating in-memory state.

### Test

`test_connection` accepts an explicit draft token only for that call. Rust
validates the endpoint, sends one profile GET, and returns only success or a
redacted typed error. The renderer clears its draft immediately in `finally`.
The token never appears in a return value, event, log, trace, snapshot, or
error.

### Save/replace

`save_connection` must receive exactly one of:

- `newToken`: a non-empty one-way draft for the canonical endpoint; or
- `retainExistingToken: true`: permitted only when the canonical endpoint is
  unchanged and the existing credential can be read by Rust.

A changed endpoint with `retainExistingToken` is rejected. For a new token Rust:

1. validates/canonicalizes the endpoint and creates a new credential reference;
2. writes a pending operation to preferences while leaving the prior committed
   connection usable;
3. writes the new token to the new native entry and validates storage internally;
4. commits the new endpoint/reference as configured and clears pending state;
5. deletes the old entry only after the new commit, recording cleanup if delete
   fails.

If a staged write or final preferences commit fails, Rust keeps the prior
committed connection, attempts deletion of the new entry, and reports a visible
partial-failure warning if cleanup also fails. It never mixes the old endpoint
with the new token. `retainExistingToken` performs no token IPC crossing.

### Clear/disconnect

Clear first marks the current process disconnected and invalidates its
in-memory credential. Rust then persists `state=disconnected` with the exact
credential reference in `pendingCleanup`, atomically deletes that one native
entry, and commits `pendingCleanup=null` only after deletion succeeds. On
restart, a pending cleanup is retried before any network request; pending state
never authorizes an automatic reconnect.

If preference persistence fails, or native deletion fails, return a typed
partial-clear warning and offer retry. If both persistent stores reject the
operation, only current-process disconnect is guaranteed: explicitly warn that
old saved state may return after restart, never claim erasure, and do not report
full success. A successful durable disconnected marker prevents auto-reconnect.

## Redaction and diagnostics

Logs, errors, test snapshots, fixtures, recordings, and crash reports may
contain command names, status codes, and a redacted origin/path. They must not
contain tokens, authorization headers, keyring values, draft inputs, full
server response bodies, or query fragments copied from untrusted bookmark text.
Use structured error codes from `ipc.md`; do not pass through arbitrary
platform/server messages as the only diagnostic.
