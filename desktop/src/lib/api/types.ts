export type Generation = number;

export type SessionStatus = 'initializing' | 'unconfigured' | 'ready' | 'credential_error';
export type CredentialStatus = 'available' | 'missing' | 'locked' | 'unavailable';
export type ErrorCode =
  | 'invalid_input'
  | 'invalid_base_url'
  | 'insecure_http'
  | 'preferences_corrupt'
  | 'preferences_write_failed'
  | 'keyring_unavailable'
  | 'keyring_locked'
  | 'credential_missing'
  | 'credential_delete_failed'
  | 'auth_failed'
  | 'permission_denied'
  | 'not_found'
  | 'bad_request'
  | 'rate_limited'
  | 'server_error'
  | 'network_error'
  | 'timeout_unknown_outcome'
  | 'stale_generation'
  | 'external_url_rejected'
  | 'internal_error';

export type BookmarkScope = 'all' | 'queue' | 'archive';

export type DisplayPreferences = {
  theme: string;
  textScale: number;
};

export type Settings = {
  status: SessionStatus;
  canonicalBaseUrl: string | null;
  credentialStatus: CredentialStatus | null;
  errorCode: ErrorCode | null;
  allowInsecureHttp: boolean;
  pendingCleanup: boolean;
  display: DisplayPreferences;
  generation: Generation;
};

/** The Rust HTTP/IPC DTO; presentation helpers belong above the bridge. */
export type Bookmark = {
  id: number;
  url: string;
  title: string;
  description: string;
  notes: string;
  web_archive_snapshot_url: string | null;
  favicon_url: string | null;
  preview_image_url: string | null;
  is_archived: boolean;
  unread: boolean;
  shared: boolean;
  tag_names: string[];
  date_added: string;
  date_modified: string | null;
  website_title: string | null;
  website_description: string | null;
};

export type Tag = {
  id: number;
  name: string;
  date_added: string | null;
};

export type Page<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export type CommandEnvelope<T> = {
  generation: Generation;
  data: T;
};

export type TestConnectionInput = {
  baseUrl: string;
  newToken: string;
  allowInsecureHttp?: boolean;
};

export type TestConnectionResult = {
  reachable: boolean;
  serverVersion: string | null;
};

export type SaveConnectionInput = {
  baseUrl: string;
  newToken?: string;
  retainExistingToken?: boolean;
  allowInsecureHttp?: boolean;
};

export type SaveWarning = 'old_credential_cleanup_failed';

export type SaveConnectionResult = {
  settings: Settings;
  warning: SaveWarning | null;
};

export type ClearConnectionInput = {
  generation: Generation;
};

export type ClearWarning =
  'credential_delete_failed' | 'preferences_write_failed' | 'old_state_may_return';

export type ClearConnectionResult = {
  disconnected: boolean;
  durable: boolean;
  cleanupPending: boolean;
  warning: ClearWarning | null;
};

export type SetDisplayPreferencesInput = {
  generation: Generation;
  theme: string;
  textScale: number;
};

export type ListBookmarksInput = {
  generation: Generation;
  scope: BookmarkScope;
  query?: string;
  tag?: string;
  offset: number;
  limit?: number;
};

export type ListTagsInput = {
  generation: Generation;
  offset: number;
  limit?: number;
};

export type CreateBookmarkInput = {
  generation: Generation;
  url: string;
  title?: string;
  description?: string;
  notes?: string;
  tagNames?: string[];
  isArchived?: boolean;
  isRead?: boolean;
};

export type BookmarkIdInput = {
  generation: Generation;
  bookmarkId: number;
};

export type MarkReadInput = BookmarkIdInput & {
  isRead: boolean;
};

export type ReplaceTagsInput = BookmarkIdInput & {
  tagNames: string[];
};

export type OpenExternalUrlInput = {
  generation: Generation;
  url: string;
};

export type AppError = {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  status?: number;
  generation?: Generation;
};
