# Tauri IPC contract

Status: frozen for Rust service and Svelte callers. All values below are JSON
serializable serde DTOs. Tauri commands return `Result<Envelope<T>, AppError>`;
Tauri serializes the error object as the rejected invoke payload.

## Shared types

```ts
type Generation = number; // unsigned integer, monotonically increasing

type Envelope<T> = {
  generation: Generation;
  data: T;
};

type AppError = {
  code:
    | "invalid_input"
    | "invalid_base_url"
    | "insecure_http"
    | "preferences_corrupt"
    | "preferences_write_failed"
    | "keyring_unavailable"
    | "keyring_locked"
    | "credential_missing"
    | "credential_delete_failed"
    | "auth_failed"
    | "permission_denied"
    | "not_found"
    | "bad_request"
    | "rate_limited"
    | "server_error"
    | "network_error"
    | "timeout_unknown_outcome"
    | "stale_generation"
    | "external_url_rejected"
    | "internal_error";
  message: string;       // safe, localized-ready; never a secret or raw body
  retryable: boolean;
  generation?: Generation;
};

type ConnectionState = "first_boot" | "configured" | "disconnected";
type CredentialStatus = "available" | "missing" | "locked" | "unavailable";
type Scope = "queue" | "archive";
```

Rust must reject unknown or malformed input rather than silently accepting a
new command shape. `generation` is included in every successful response and
is required on every operation that uses the saved connection. A stale
request fails with `stale_generation`; it must not contact Linkding. The
frontend also ignores a response whose generation is no longer current, which
covers late results from already-started requests.

## Connection and preferences commands

### `get_settings`

Input: `{}`.

Output:

```ts
type Settings = {
  schemaVersion: 1;
  generation: Generation;
  connectionState: ConnectionState;
  canonicalBaseUrl: string | null;
  credentialStatus: CredentialStatus | null;
  allowInsecureHttp: boolean;
  pendingCleanup: boolean;
  display: { theme: string; textScale: number };
};
```

No token is returned. On configured startup, Rust may probe the native entry
only to classify its status; it never returns the value. If the stored
preferences are corrupt, return `preferences_corrupt` and a disconnected
fail-closed state, not a guessed configured state.

### `test_connection`

Input:

```ts
type TestConnectionInput = {
  baseUrl: string;
  newToken: string; // one-way; never echoed
  allowInsecureHttp?: boolean; // explicit opt-in for this test
};
```

Output: `{ reachable: true; serverVersion?: string }` inside `Envelope`.
Rust validates the URL and sends `GET /api/user/profile/` with the draft token.
The result contains no profile, token, response body, or authorization data.
The Svelte caller clears `newToken` in a `finally` block immediately after the
invoke settles.

### `save_connection`

Input:

```ts
type SaveConnectionInput = {
  baseUrl: string;
  newToken?: string; // one-way; mutually exclusive with retainExistingToken
  retainExistingToken?: boolean;
  allowInsecureHttp?: boolean; // must be explicit for an http URL
};
```

Exactly one credential choice is required. `retainExistingToken: true` is valid
only for the same canonical endpoint and a usable saved credential. A changed
endpoint requires `newToken`. Output is `Settings` with a new generation; the
token is never returned. The transaction, recovery order, and cleanup rules are
specified in [`security.md`](security.md).

### `clear_connection`

Input: `{ generation: Generation }`.

Output:

```ts
type ClearResult = {
  disconnected: true;
  durable: boolean;
  cleanupPending: boolean;
  warning?: "credential_delete_failed" | "preferences_write_failed" | "old_state_may_return";
};
```

The current process becomes disconnected before persistence/deletion begins.
`durable: true` means the disconnected marker and exact credential deletion
both completed. If both persistent stores reject clear, return
`durable:false`, `cleanupPending:true`, and `old_state_may_return`; never claim
that the credential was erased. A successful durable disconnect prevents
reconnection on restart.

### `set_display_preferences`

Input:

```ts
type DisplayPreferencesInput = {
  generation: Generation;
  theme: string;      // one of the retained product theme names
  textScale: number;  // one of 0.85, 1, 1.25, 1.5, 1.75, 2
};
```

Output: updated `Settings`. Values are non-secret and atomically persisted.
Invalid values produce `invalid_input` without changing the prior value.

## Linkding resource commands

All resource inputs include `generation`. `limit` is constrained to 20 for
bookmarks and 100 for tags; `offset` must be non-negative. Rust builds the
relative URL itself and uses the saved credential; it never accepts a full
request URL, server-provided `next`, headers, or arbitrary method from Svelte.

```ts
type BookmarkScopeInput = {
  generation: Generation;
  scope: Scope;
  query?: string;
  tag?: string;
  offset: number;
  limit?: 20;
};

type ListBookmarksResult = {
  count: number;
  next: string | null;       // informational; never followed by the client
  previous: string | null;
  results: Bookmark[];
};

list_bookmarks(input: BookmarkScopeInput): Promise<Envelope<ListBookmarksResult>>;

list_tags(input: {
  generation: Generation;
  offset: number;
  limit?: 100;
}): Promise<Envelope<Paginated<Tag>>>;
```

`scope:"queue"` calls `/api/bookmarks/` with `unread=yes` and `q` when present;
`scope:"archive"` calls `/api/bookmarks/archived/`. A selected tag is encoded
as `#tag` in `q` according to [`linkding-api.md`](linkding-api.md). The
All-tagged UI scope is visibly labelled and performs coordinated queue and
archive queries, then de-duplicates IDs; it is not an undocumented
`is_archived` query parameter.

The frontend owns the pagination state and query identity (scope, query, tag,
account generation). Rust enforces one request per call, but the frontend
allows only one load-more call for each identity, stops on empty/non-advancing
pages, and resets affected pages only after a confirmed mutation.

The DTOs are defined in Rust with serde and mirrored by strict handwritten
TypeScript types. Contract tests must serialize both directions against the
fixtures in `desktop/tests/fixtures/linkding/`; drift is a check failure.

### `create_bookmark`

Input:

```ts
type CreateBookmarkInput = {
  generation: Generation;
  url: string;
  title?: string;
  description?: string;
  notes?: string;
  tagNames?: string[];
  isArchived?: boolean;
  isRead?: boolean; // Rust sends `unread: !isRead`
};
```

Rust sends one `POST /api/bookmarks/` with the corresponding upstream names
and returns the created/updated `Bookmark` from the `201` response. No
automatic retry is allowed. A timeout returns `timeout_unknown_outcome`.

### `mark_read`

Input: `{ generation: Generation; bookmarkId: number; isRead: boolean }`.
Rust sends `PATCH /api/bookmarks/<id>/` with `{ "unread": !isRead }` and returns
the updated bookmark. There is no local success before the server confirms
`200`.

### `replace_bookmark_tags`

Input: `{ generation: Generation; bookmarkId: number; tagNames: string[] }`.
Rust sends `PATCH /api/bookmarks/<id>/` with `{ "tag_names": tagNames }` and
returns the updated bookmark. The caller treats the list as replacement, not
addition.

### `archive_bookmark`, `unarchive_bookmark`, and `delete_bookmark`

Inputs:

```ts
type BookmarkMutationInput = { generation: Generation; bookmarkId: number };
```

Rust sends the corresponding `POST .../archive/`, `POST .../unarchive/`, or
`DELETE .../` and requires `204` with an empty body. Output is
`Envelope<{ confirmed: true }>`; it contains no server body. A non-2xx response
or unknown outcome is failure. Per-item locks prevent duplicate in-flight
writes, and confirmed mutations invalidate all affected paginated queries.

## `open_external_url`

Input: `{ generation: Generation; url: string }`.

Rust parses the URL and permits only `http` or `https`, with a non-empty host,
no credentials, and no control characters. It invokes the OS opener only after
validation. It does not contact the URL itself, mark the bookmark read, or
return a response body. Invalid schemes, credentials, malformed URLs, and
non-web schemes return `external_url_rejected`. A valid URL fragment is passed
through as part of the URL; it is never interpreted by the application. The
capability is not a general shell command.

## Error mapping and redaction

- Linkding `400`, `401`, `403`, `404`, `429`, and `5xx` map to
  `bad_request`, `auth_failed`, `permission_denied`, `not_found`,
  `rate_limited`, and `server_error` respectively.
- Connection/transport failures map to `network_error`; request timeout on a
  read is retryable, but timeout after a mutation is
  `timeout_unknown_outcome` and is not replayed.
- Native `NoEntry` maps to `credential_missing`; `NoStorageAccess` and locked
  platform stores map to `keyring_locked` or `keyring_unavailable`.
- Every error message is safe and short. Do not serialize raw HTTP bodies,
  headers, URLs containing query text, tokens, drafts, or platform error
  strings. Include status code only as non-secret structured metadata if
  needed for diagnostics.

Tauri capability and CSP tests, DTO contract tests, keyring mock tests, stale
generation tests, and partial-clear/restart recovery tests are required before
this contract can be considered implemented.
