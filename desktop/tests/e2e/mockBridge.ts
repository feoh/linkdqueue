import type { LinkdqueueBridge } from '../../src/lib/api/bridge';
import type { Bookmark, CommandEnvelope, Page, Settings, Tag } from '../../src/lib/api/types';

type E2eCommand = { command: string; input: unknown };
type BrowserWindow = Window & { __linkdqueueE2E?: { commands: E2eCommand[] } };

const windowWithLog = globalThis.window as BrowserWindow;

const error = (code: 'network_error' | 'server_error' | 'external_url_rejected') => ({
  code,
  message:
    code === 'external_url_rejected'
      ? 'The external URL was rejected.'
      : code === 'server_error'
        ? 'Linkding returned a server error.'
        : 'Linkding could not be reached.',
  retryable: true,
});

function bookmark(id: number, title: string, options: Partial<Bookmark> = {}): Bookmark {
  return {
    id,
    url: `https://example.test/${id}`,
    title,
    description: `Description for ${title}`,
    notes: '',
    web_archive_snapshot_url: null,
    favicon_url: null,
    preview_image_url: null,
    is_archived: false,
    unread: true,
    shared: false,
    tag_names: ['python'],
    date_added: `2026-01-${String((id % 28) + 1).padStart(2, '0')}`,
    date_modified: null,
    website_title: null,
    website_description: null,
    ...options,
  };
}

function page<T>(
  generation: number,
  results: T[],
  offset: number,
  count: number,
): CommandEnvelope<Page<T>> {
  const nextOffset = offset + results.length;
  return {
    generation,
    data: {
      count,
      next: nextOffset < count ? `/api/items/?offset=${nextOffset}` : null,
      previous: offset > 0 ? `/api/items/?offset=${Math.max(0, offset - 20)}` : null,
      results,
    },
  };
}

export function createBrowserBridge(): LinkdqueueBridge {
  const commands: E2eCommand[] = [];
  windowWithLog.__linkdqueueE2E = { commands };
  let generation = 0;
  let settings: Settings = {
    status: 'unconfigured',
    canonicalBaseUrl: null,
    credentialStatus: null,
    errorCode: null,
    allowInsecureHttp: false,
    pendingCleanup: false,
    display: { theme: 'system', textScale: 1 },
    generation,
  };
  let failedPage20 = false;
  let failedOpen = false;
  let failedTagSave = false;
  const performanceDataset =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('dataset') === 'performance';
  const bookmarks: Bookmark[] = performanceDataset
    ? Array.from({ length: 1000 }, (_, index) =>
        bookmark(index + 1, `Synthetic bookmark ${index + 1} — long metadata fixture`, {
          description:
            `Long deterministic description for synthetic bookmark ${index + 1}. `.repeat(8),
          notes: `Notes for synthetic bookmark ${index + 1}. `.repeat(4),
          tag_names: [`tag-${(index % 205) + 1}`],
        }),
      )
    : Array.from({ length: 25 }, (_, index) =>
        bookmark(index + 1, `Queue bookmark ${index + 1}`, {
          tag_names: index % 2 === 0 ? ['python', 'reading'] : ['python'],
        }),
      );
  if (!performanceDataset) {
    bookmarks.push(
      bookmark(26, 'Archived bookmark', {
        is_archived: true,
        unread: false,
        tag_names: ['python', 'archive'],
      }),
      bookmark(27, 'Archived second bookmark', {
        is_archived: true,
        unread: false,
        tag_names: ['archive'],
      }),
    );
  }
  const tags: Tag[] = performanceDataset
    ? Array.from({ length: 205 }, (_, index) => ({
        id: index + 1,
        name: `tag-${index + 1}`,
        date_added: '2026-01-01',
      }))
    : [
        { id: 1, name: 'archive', date_added: '2026-01-01' },
        { id: 2, name: 'python', date_added: '2026-01-02' },
        { id: 3, name: 'reading', date_added: '2026-01-03' },
      ];

  function record(command: string, input: unknown): void {
    commands.push({ command, input });
  }

  function requireReady(): void {
    if (settings.status !== 'ready') throw error('network_error');
  }

  return {
    async getSettings() {
      record('get_settings', {});
      return { ...settings, display: { ...settings.display } };
    },
    async testConnection(input) {
      record('test_connection', input);
      return { reachable: true, serverVersion: '1.46.2-fixture' };
    },
    async saveConnection(input) {
      record('save_connection', input);
      generation += 1;
      settings = {
        ...settings,
        status: 'ready',
        canonicalBaseUrl: input.baseUrl.replace(/\/$/, ''),
        credentialStatus: 'available',
        errorCode: null,
        pendingCleanup: false,
        generation,
        allowInsecureHttp: input.allowInsecureHttp === true,
      };
      return { settings: { ...settings, display: { ...settings.display } }, warning: null };
    },
    async clearConnection(input) {
      record('clear_connection', input);
      generation += 1;
      settings = {
        ...settings,
        status: 'unconfigured',
        canonicalBaseUrl: null,
        credentialStatus: null,
        errorCode: null,
        pendingCleanup: false,
        generation,
      };
      return { disconnected: true, durable: true, cleanupPending: false, warning: null };
    },
    async setDisplayPreferences(input) {
      record('set_display_preferences', input);
      settings = { ...settings, display: { theme: input.theme, textScale: input.textScale } };
      return { ...settings, display: { ...settings.display } };
    },
    async listBookmarks(input) {
      record('list_bookmarks', input);
      requireReady();
      if (input.offset === 20 && !failedPage20 && input.scope === 'queue' && !performanceDataset) {
        failedPage20 = true;
        throw error('network_error');
      }
      const query = (input.query ?? '').toLocaleLowerCase();
      const filtered = bookmarks.filter((item) => {
        const inScope =
          input.scope === 'archive'
            ? item.is_archived
            : input.scope === 'queue'
              ? !item.is_archived && item.unread
              : true;
        const hasTag = !input.tag || item.tag_names.includes(input.tag);
        const searchable = `${item.title} ${item.url} ${item.description}`.toLocaleLowerCase();
        return inScope && hasTag && (!query || searchable.includes(query));
      });
      const limit = input.limit ?? 20;
      return page(
        generation,
        filtered.slice(input.offset, input.offset + limit),
        input.offset,
        filtered.length,
      );
    },
    async listTags(input) {
      record('list_tags', input);
      requireReady();
      const limit = input.limit ?? 100;
      return page(
        generation,
        tags.slice(input.offset, input.offset + limit),
        input.offset,
        tags.length,
      );
    },
    async createBookmark(input) {
      record('create_bookmark', input);
      requireReady();
      const created = bookmark(
        Math.max(...bookmarks.map(({ id }) => id)) + 1,
        input.title ?? input.url,
        {
          url: input.url,
          description: input.description ?? '',
          tag_names: input.tagNames ?? [],
          unread: input.isRead !== true,
        },
      );
      bookmarks.push(created);
      return { generation, data: created };
    },
    async markRead(input) {
      record('mark_read', input);
      requireReady();
      const item = bookmarks.find(({ id }) => id === input.bookmarkId);
      if (!item) throw error('network_error');
      item.unread = input.isRead !== true;
      return { generation, data: { ...item } };
    },
    async replaceBookmarkTags(input) {
      record('replace_bookmark_tags', input);
      requireReady();
      if (!failedTagSave) {
        failedTagSave = true;
        throw error('server_error');
      }
      const item = bookmarks.find(({ id }) => id === input.bookmarkId);
      if (!item) throw error('network_error');
      item.tag_names = [...input.tagNames];
      return { generation, data: { ...item } };
    },
    async archiveBookmark(input) {
      record('archive_bookmark', input);
      requireReady();
      const item = bookmarks.find(({ id }) => id === input.bookmarkId);
      if (!item) throw error('network_error');
      item.is_archived = true;
      return { generation, data: { confirmed: true } };
    },
    async unarchiveBookmark(input) {
      record('unarchive_bookmark', input);
      requireReady();
      const item = bookmarks.find(({ id }) => id === input.bookmarkId);
      if (!item) throw error('network_error');
      item.is_archived = false;
      return { generation, data: { confirmed: true } };
    },
    async deleteBookmark(input) {
      record('delete_bookmark', input);
      requireReady();
      const index = bookmarks.findIndex(({ id }) => id === input.bookmarkId);
      if (index < 0) throw error('network_error');
      bookmarks.splice(index, 1);
      return { generation, data: { confirmed: true } };
    },
    async openExternalUrl(input) {
      record('open_external_url', input);
      requireReady();
      if (!failedOpen) {
        failedOpen = true;
        throw error('external_url_rejected');
      }
    },
  };
}
