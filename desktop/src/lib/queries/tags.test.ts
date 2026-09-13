import { describe, expect, it, vi } from 'vitest';

import type { LinkdqueueBridge } from '../api/bridge';
import type { Tag } from '../api/types';
import type { TagPage } from './tags';
import { TAG_PAGE_LIMIT, StaleTagResponseError, TagCatalogue, TagCatalogueError } from './tags';

const tag = (id: number, name = `Tag ${id}`): Tag => ({ id, name, date_added: null });
const page = (generation: number, tags: Tag[], next: string | null): TagPage => ({
  generation,
  data: { count: 205, next, previous: null, results: tags },
});

const unusedCommand = async (): Promise<never> => {
  throw new Error('unused command in tag test');
};

function bridgeFor(listTags: LinkdqueueBridge['listTags']): LinkdqueueBridge {
  return {
    getSettings: unusedCommand,
    testConnection: unusedCommand,
    saveConnection: unusedCommand,
    clearConnection: unusedCommand,
    setDisplayPreferences: unusedCommand,
    listBookmarks: unusedCommand,
    listTags,
    createBookmark: unusedCommand,
    markRead: unusedCommand,
    replaceBookmarkTags: unusedCommand,
    archiveBookmark: unusedCommand,
    unarchiveBookmark: unusedCommand,
    deleteBookmark: unusedCommand,
    openExternalUrl: unusedCommand,
  };
}

describe('account-scoped tag catalogue', () => {
  it('loads all pages sequentially and sorts case-insensitively', async () => {
    const calls: number[] = [];
    const bridge = bridgeFor(async (input) => {
      calls.push(input.offset);
      if (input.offset === 0) {
        return page(
          7,
          Array.from({ length: 100 }, (_, index) => tag(index + 1)),
          '/tags/100',
        );
      }
      if (input.offset === 100) {
        return page(
          7,
          Array.from({ length: 100 }, (_, index) => tag(index + 101)),
          '/tags/200',
        );
      }
      return page(
        7,
        [
          tag(201, 'zeta'),
          tag(202, 'alpha'),
          tag(203, 'ALPHA'),
          tag(204, 'éclair'),
          tag(205, 'Éclair'),
        ],
        null,
      );
    });
    const catalogue = new TagCatalogue(bridge);

    const result = await catalogue.load(7);

    expect(calls).toEqual([0, 100, 200]);
    expect(result.status).toBe('ready');
    expect(result.tags).toHaveLength(205);
    expect(result.tags[0]?.name).toBe('ALPHA');
    expect(result.tags[1]?.name).toBe('alpha');
    expect(result.tags[result.tags.length - 1]?.name).toBe('éclair');
    expect(calls.every((offset) => offset % TAG_PAGE_LIMIT === 0)).toBe(true);
  });

  it('keeps a partial catalogue and recoverable error after a failed page', async () => {
    const bridge = bridgeFor(async (input) => {
      if (input.offset === 0) return page(7, [tag(1)], '/tags/1');
      throw { code: 'network_error', message: 'hidden', retryable: true };
    });
    const catalogue = new TagCatalogue(bridge);

    await expect(catalogue.load(7)).rejects.toMatchObject({ code: 'network_error' });

    expect(catalogue.snapshot.status).toBe('error');
    expect(catalogue.snapshot.tags.map(({ id }) => id)).toEqual([1]);
    expect(catalogue.snapshot.failedOffset).toBe(1);
    expect(catalogue.snapshot.tags).not.toHaveLength(0);
  });

  it('stops duplicate pages without presenting a complete catalogue', async () => {
    const bridge = bridgeFor(async (input) => {
      if (input.offset === 0) return page(7, [tag(1)], '/tags/1');
      return page(7, [tag(1)], '/tags/2');
    });
    const catalogue = new TagCatalogue(bridge);

    await expect(catalogue.load(7)).rejects.toBeInstanceOf(TagCatalogueError);

    expect(catalogue.snapshot.status).toBe('error');
    expect(catalogue.snapshot.failedOffset).toBe(1);
  });

  it('does not mix page responses when the account generation changes', async () => {
    const pending: Array<{ generation: number; resolve: (value: TagPage) => void }> = [];
    const bridge = bridgeFor(
      (input) =>
        new Promise<TagPage>((resolve) => {
          pending.push({ generation: input.generation, resolve });
        }),
    );
    const catalogue = new TagCatalogue(bridge);
    const first = catalogue.load(1);
    const second = catalogue.load(2);

    pending[0]?.resolve(page(1, [tag(1)], '/tags/1'));
    pending[1]?.resolve(page(2, [tag(2)], null));

    await expect(first).rejects.toBeInstanceOf(StaleTagResponseError);
    const result = await second;
    expect(result.tags.map(({ id }) => id)).toEqual([2]);
    expect(result.generation).toBe(2);
  });

  it('restarts an in-flight catalogue load after confirmed invalidation', async () => {
    const pending: Array<(value: TagPage) => void> = [];
    const listTags = vi.fn(() => new Promise<TagPage>((resolve) => pending.push(resolve)));
    const catalogue = new TagCatalogue(bridgeFor(listTags));

    const first = catalogue.load(7);
    catalogue.invalidateAfterConfirmedMutation(true);
    const second = catalogue.load(7);
    pending[1]?.(page(7, [tag(2)], null));
    pending[0]?.(page(7, [tag(1)], null));

    await expect(first).rejects.toBeInstanceOf(StaleTagResponseError);
    await expect(second).resolves.toMatchObject({ status: 'ready', tags: [tag(2)] });
    expect(listTags).toHaveBeenCalledTimes(2);
  });

  it('retains selected names and does not duplicate tags after refresh', async () => {
    const bridge = bridgeFor(async () => page(7, [tag(1, 'Beta'), tag(2, 'alpha')], null));
    const catalogue = new TagCatalogue(bridge);
    catalogue.setSelectedNames(['missing-from-partial-catalogue']);

    await catalogue.load(7);
    await catalogue.refresh();
    catalogue.invalidateAfterConfirmedMutation(false);
    expect(catalogue.snapshot.status).toBe('ready');
    expect(catalogue.snapshot.tags).toHaveLength(2);
    expect(catalogue.snapshot.selectedNames).toEqual(['missing-from-partial-catalogue']);

    catalogue.invalidateAfterConfirmedMutation(true);
    expect(catalogue.snapshot.status).toBe('idle');
    expect(catalogue.snapshot.tags).toHaveLength(0);
    expect(catalogue.snapshot.selectedNames).toEqual(['missing-from-partial-catalogue']);
  });
});
