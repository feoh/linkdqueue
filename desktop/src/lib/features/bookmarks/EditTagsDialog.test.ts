import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

import type { LinkdqueueBridge } from '../../api/bridge';
import type { AppError, Bookmark } from '../../api/types';
import type { MutationResult } from '../../queries/mutations';
import { TagCatalogue, type TagPage } from '../../queries/tags';
import EditTagsDialog from './EditTagsDialog.svelte';

const bookmark = (id = 4, tagNames = ['one', 'missing']): Bookmark => ({
  id,
  url: `https://example.test/${id}`,
  title: 'Read this',
  description: '',
  notes: '',
  web_archive_snapshot_url: null,
  favicon_url: null,
  preview_image_url: null,
  is_archived: false,
  unread: true,
  shared: false,
  tag_names: tagNames,
  date_added: '2026-01-01',
  date_modified: null,
  website_title: null,
  website_description: null,
});

const confirmed = (): MutationResult<Bookmark> => ({
  status: 'confirmed',
  data: bookmark(),
});

const failed = (code: AppError['code'], status?: number): MutationResult<Bookmark> => ({
  status: 'failed',
  error: { code, status, message: 'unsafe server detail', retryable: false } as AppError,
});

const unused = async (): Promise<never> => {
  throw new Error('unused bridge command');
};

function catalogueFor(listTags: LinkdqueueBridge['listTags']): TagCatalogue {
  const bridge: LinkdqueueBridge = {
    getSettings: unused,
    testConnection: unused,
    saveConnection: unused,
    clearConnection: unused,
    setDisplayPreferences: unused,
    listBookmarks: unused,
    listTags,
    createBookmark: unused,
    markRead: unused,
    replaceBookmarkTags: unused,
    archiveBookmark: unused,
    unarchiveBookmark: unused,
    deleteBookmark: unused,
    openExternalUrl: unused,
  };
  return new TagCatalogue(bridge);
}

describe('EditTagsDialog', () => {
  it('prepopulates exact names, preserves missing catalogue names, and replaces with empty tags', async () => {
    const replaceBookmarkTags = vi.fn().mockResolvedValue(confirmed());
    const onClose = vi.fn();
    render(EditTagsDialog, {
      props: {
        open: true,
        bookmark: bookmark(4, ['one', 'missing-from-catalogue']),
        generation: 7,
        replaceBookmarkTags,
        suggestions: ['one', 'catalogued'],
        onClose,
      },
    });

    expect(
      screen.getByRole('button', { name: 'Remove missing-from-catalogue' }),
    ).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Clear all tags' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));

    await waitFor(() => expect(replaceBookmarkTags).toHaveBeenCalledWith(4, []));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps selected names when the catalogue is partial or fails', async () => {
    const listTags = vi.fn().mockRejectedValue({ code: 'network_error', retryable: true });
    const catalogue = catalogueFor(listTags);
    render(EditTagsDialog, {
      props: { open: true, bookmark: bookmark(4, ['not-loaded-yet']), generation: 7, catalogue },
    });

    expect(screen.getByRole('button', { name: 'Remove not-loaded-yet' })).toBeInTheDocument();
    await waitFor(() => expect(listTags).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Remove not-loaded-yet' })).toBeInTheDocument();
  });

  it.each([
    ['auth_failed', 401, 'Linkding authentication failed.'],
    ['server_error', 500, 'The Linkding server failed the request.'],
  ] as const)('retains the draft and safely reports %s writes', async (code, status, message) => {
    const replaceBookmarkTags = vi
      .fn()
      .mockRejectedValueOnce({ code, status, message: 'unsafe server detail' })
      .mockResolvedValueOnce(confirmed());
    render(EditTagsDialog, {
      props: { open: true, bookmark: bookmark(), generation: 7, replaceBookmarkTags },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove one' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Remove missing' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));
    await waitFor(() => expect(replaceBookmarkTags).toHaveBeenCalledTimes(2));
  });

  it('suppresses duplicate saves while the first replacement is pending', async () => {
    let resolve: (result: MutationResult<Bookmark>) => void = () => undefined;
    const replaceBookmarkTags = vi.fn().mockReturnValue(
      new Promise<MutationResult<Bookmark>>((finish) => {
        resolve = finish;
      }),
    );
    render(EditTagsDialog, {
      props: { open: true, bookmark: bookmark(), generation: 7, replaceBookmarkTags },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove one' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Saving…' }));
    expect(replaceBookmarkTags).toHaveBeenCalledOnce();
    resolve(confirmed());
  });

  it('emits only confirmed saves, allowing the owner to refresh an active tag filter', async () => {
    const onSaved = vi.fn();
    const replaceBookmarkTags = vi
      .fn()
      .mockResolvedValueOnce(failed('permission_denied'))
      .mockResolvedValueOnce(confirmed());
    render(EditTagsDialog, {
      props: { open: true, bookmark: bookmark(), generation: 7, replaceBookmarkTags, onSaved },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove one' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));
    await screen.findByRole('alert');
    expect(onSaved).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }));
  });

  it('does not let a late result from a previous account close the current draft', async () => {
    let resolve: (result: MutationResult<Bookmark>) => void = () => undefined;
    const replaceBookmarkTags = vi.fn().mockReturnValue(
      new Promise<MutationResult<Bookmark>>((finish) => {
        resolve = finish;
      }),
    );
    const view = render(EditTagsDialog, {
      props: { open: true, bookmark: bookmark(4, ['old']), generation: 1, replaceBookmarkTags },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Remove old' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));
    await view.rerender({
      open: true,
      bookmark: bookmark(8, ['current']),
      generation: 2,
      replaceBookmarkTags,
    });
    resolve(confirmed());

    await tick();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove current' })).toBeInTheDocument();
  });

  it('matches the add dialog dirty Cancel and Escape behavior', async () => {
    const onClose = vi.fn();
    render(EditTagsDialog, { props: { open: true, bookmark: bookmark(), generation: 7, onClose } });
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    await fireEvent.click(screen.getByRole('button', { name: 'Remove one' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(confirm).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('loads catalogue pages without replacing selected names', async () => {
    const page: TagPage = {
      generation: 7,
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [{ id: 1, name: 'catalogued', date_added: null }],
      },
    };
    const catalogue = catalogueFor(vi.fn().mockResolvedValue(page));
    render(EditTagsDialog, {
      props: { open: true, bookmark: bookmark(4, ['missing']), generation: 7, catalogue },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'catalogued' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Remove missing' })).toBeInTheDocument();
  });
});
