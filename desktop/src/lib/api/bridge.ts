import { invoke as tauriInvoke } from '@tauri-apps/api/core';

import { normalizeIpcError } from './errors';
import type {
  AppError,
  Bookmark,
  BookmarkIdInput,
  ClearConnectionInput,
  ClearConnectionResult,
  CommandEnvelope,
  CreateBookmarkInput,
  ListBookmarksInput,
  ListTagsInput,
  MarkReadInput,
  OpenExternalUrlInput,
  Page,
  ReplaceTagsInput,
  SaveConnectionInput,
  SaveConnectionResult,
  Settings,
  SetDisplayPreferencesInput,
  Tag,
  TestConnectionInput,
  TestConnectionResult,
} from './types';

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface LinkdqueueBridge {
  getSettings(): Promise<Settings>;
  testConnection(input: TestConnectionInput): Promise<TestConnectionResult>;
  saveConnection(input: SaveConnectionInput): Promise<SaveConnectionResult>;
  clearConnection(input: ClearConnectionInput): Promise<ClearConnectionResult>;
  setDisplayPreferences(input: SetDisplayPreferencesInput): Promise<Settings>;
  listBookmarks(input: ListBookmarksInput): Promise<CommandEnvelope<Page<Bookmark>>>;
  listTags(input: ListTagsInput): Promise<CommandEnvelope<Page<Tag>>>;
  createBookmark(input: CreateBookmarkInput): Promise<CommandEnvelope<Bookmark>>;
  markRead(input: MarkReadInput): Promise<CommandEnvelope<Bookmark>>;
  replaceBookmarkTags(input: ReplaceTagsInput): Promise<CommandEnvelope<Bookmark>>;
  archiveBookmark(input: BookmarkIdInput): Promise<CommandEnvelope<ConfirmedMutation>>;
  unarchiveBookmark(input: BookmarkIdInput): Promise<CommandEnvelope<ConfirmedMutation>>;
  deleteBookmark(input: BookmarkIdInput): Promise<CommandEnvelope<ConfirmedMutation>>;
  openExternalUrl(input: OpenExternalUrlInput): Promise<void>;
}

export type ConfirmedMutation = {
  confirmed: boolean;
};

async function invokeCommand<T>(
  invoke: Invoke,
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw normalizeIpcError(error);
  }
}

/** Build the production bridge or inject a deterministic invoke function in tests. */
export function createTauriBridge(invoke: Invoke = tauriInvoke): LinkdqueueBridge {
  return {
    getSettings: () => invokeCommand<Settings>(invoke, 'get_settings'),
    testConnection: (input) =>
      invokeCommand<TestConnectionResult>(invoke, 'test_connection', input),
    saveConnection: (input) =>
      invokeCommand<SaveConnectionResult>(invoke, 'save_connection', input),
    clearConnection: (input) =>
      invokeCommand<ClearConnectionResult>(invoke, 'clear_connection', input),
    setDisplayPreferences: (input) =>
      invokeCommand<Settings>(invoke, 'set_display_preferences', input),
    listBookmarks: (input) =>
      invokeCommand<CommandEnvelope<Page<Bookmark>>>(invoke, 'list_bookmarks', input),
    listTags: (input) => invokeCommand<CommandEnvelope<Page<Tag>>>(invoke, 'list_tags', input),
    createBookmark: (input) =>
      invokeCommand<CommandEnvelope<Bookmark>>(invoke, 'create_bookmark', input),
    markRead: (input) => invokeCommand<CommandEnvelope<Bookmark>>(invoke, 'mark_read', input),
    replaceBookmarkTags: (input) =>
      invokeCommand<CommandEnvelope<Bookmark>>(invoke, 'replace_bookmark_tags', input),
    archiveBookmark: (input) =>
      invokeCommand<CommandEnvelope<ConfirmedMutation>>(invoke, 'archive_bookmark', input),
    unarchiveBookmark: (input) =>
      invokeCommand<CommandEnvelope<ConfirmedMutation>>(invoke, 'unarchive_bookmark', input),
    deleteBookmark: (input) =>
      invokeCommand<CommandEnvelope<ConfirmedMutation>>(invoke, 'delete_bookmark', input),
    openExternalUrl: (input) => invokeCommand<void>(invoke, 'open_external_url', input),
  };
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string' &&
    'message' in value &&
    typeof value.message === 'string' &&
    'retryable' in value &&
    typeof value.retryable === 'boolean'
  );
}
