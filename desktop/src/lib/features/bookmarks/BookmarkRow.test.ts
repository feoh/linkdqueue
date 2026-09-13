import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import BookmarkRow from './BookmarkRow.svelte';
import type { AppError, Bookmark } from '../../api/types';
import type { BookmarkActionMutations } from './bookmarkActions';
import type { MutationResult } from '../../queries/mutations';

const bookmark: Bookmark = {
  id: 1,
  url: 'https://example.test/a',
  title: '',
  description: '',
  website_title: 'Website title',
  website_description: 'Website description',
  notes: '',
  web_archive_snapshot_url: null,
  favicon_url: null,
  preview_image_url: null,
  is_archived: true,
  unread: true,
  shared: false,
  tag_names: ['one'],
  date_added: '2026-01-01',
  date_modified: null,
};

const confirmed = (): MutationResult<Bookmark> => ({
  status: 'confirmed',
  data: bookmark,
});

const confirmedDelete = (): MutationResult<{ confirmed: boolean }> => ({
  status: 'confirmed',
  data: { confirmed: true },
});

function mutations(overrides: Partial<BookmarkActionMutations> = {}): BookmarkActionMutations {
  return {
    markRead: vi.fn().mockResolvedValue(confirmed()),
    archive: vi.fn().mockResolvedValue(confirmedDelete()),
    unarchive: vi.fn().mockResolvedValue(confirmedDelete()),
    delete: vi.fn().mockResolvedValue(confirmedDelete()),
    ...overrides,
  };
}

describe('BookmarkRow', () => {
  it('uses safe fallback text, metadata, and the external opener without marking read', async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    render(BookmarkRow, { props: { bookmark, generation: 7, openExternalUrl } });

    expect(screen.getByRole('heading', { name: 'Website title' })).toBeInTheDocument();
    expect(screen.getByText('Website description')).toBeInTheDocument();
    expect(screen.getByText('example.test')).toBeInTheDocument();
    expect(screen.getByText('Unread')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Open bookmark' }));
    expect(openExternalUrl).toHaveBeenCalledWith({ generation: 7, url: bookmark.url });
  });

  it('shows opener failures without changing bookmark state', async () => {
    const openExternalUrl = vi.fn().mockRejectedValue(new Error('rejected'));
    render(BookmarkRow, { props: { bookmark, generation: 7, openExternalUrl } });
    await fireEvent.click(screen.getByRole('button', { name: 'Open bookmark' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be opened');
    expect(openExternalUrl).toHaveBeenCalledOnce();
  });

  it.each([
    [true, false, 'Mark as read', 'Archive'],
    [false, false, undefined, 'Archive'],
    [true, true, 'Mark as read', undefined],
    [false, true, undefined, undefined],
  ] as const)(
    'shows contextual actions for unread=%s archived=%s',
    async (unread, archived, readAction, archiveAction) => {
      const actionMutations = mutations();
      const current = { ...bookmark, unread, is_archived: archived };
      render(BookmarkRow, {
        props: {
          bookmark: current,
          generation: 7,
          openExternalUrl: vi.fn(),
          mutations: actionMutations,
        },
      });

      if (readAction) expect(screen.getByRole('button', { name: readAction })).toBeInTheDocument();
      else expect(screen.queryByRole('button', { name: 'Mark as read' })).not.toBeInTheDocument();
      if (archiveAction)
        expect(screen.getByRole('button', { name: archiveAction })).toBeInTheDocument();
      else expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
      if (archived) expect(screen.getByRole('button', { name: 'Unarchive' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit tags' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete bookmark' })).toBeInTheDocument();
    },
  );

  it('shows Mark as read for an unread archived bookmark in Archive scope and marks it once', async () => {
    const actionMutations = mutations();
    render(BookmarkRow, {
      props: {
        bookmark,
        generation: 7,
        scope: 'archive',
        openExternalUrl: vi.fn(),
        mutations: actionMutations,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));

    await waitFor(() => expect(actionMutations.markRead).toHaveBeenCalledTimes(1));
    expect(actionMutations.markRead).toHaveBeenCalledWith(bookmark.id, true);
    expect(actionMutations.archive).not.toHaveBeenCalled();
    expect(actionMutations.unarchive).not.toHaveBeenCalled();
    expect(actionMutations.delete).not.toHaveBeenCalled();
  });

  it('sends one contextual mutation, preserves browser and tag clicks, and announces success', async () => {
    const actionMutations = mutations();
    const openTagEditor = vi.fn();
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    render(BookmarkRow, {
      props: {
        bookmark: { ...bookmark, is_archived: false },
        generation: 7,
        openExternalUrl,
        mutations: actionMutations,
        openTagEditor,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Open bookmark' }));
    await fireEvent.click(screen.getByText('#one'));
    await fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(actionMutations.archive).toHaveBeenCalledOnce();
    expect(actionMutations.markRead).not.toHaveBeenCalled();
    expect(actionMutations.delete).not.toHaveBeenCalled();
    expect(openExternalUrl).toHaveBeenCalledOnce();
    expect(openTagEditor).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('archived');
    await fireEvent.click(screen.getByRole('button', { name: 'Edit tags' }));
    expect(openTagEditor).toHaveBeenCalledWith(expect.objectContaining({ id: bookmark.id }));
  });

  it('does not request delete on cancel or Escape, and keeps a failed confirmation open', async () => {
    const deleteMutation = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'failed',
        error: {
          code: 'permission_denied',
          message: 'unsafe server text',
          retryable: false,
        } as AppError,
      })
      .mockResolvedValueOnce(confirmedDelete());
    const actionMutations = mutations({ delete: deleteMutation });
    render(BookmarkRow, {
      props: { bookmark, generation: 7, openExternalUrl: vi.fn(), mutations: actionMutations },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete bookmark' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleteMutation).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete bookmark' }));
    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(deleteMutation).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete bookmark' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm delete bookmark' }));
    expect(deleteMutation).toHaveBeenCalledOnce();
    expect(await screen.findByRole('dialog')).toHaveTextContent('Linkding denied this operation');
    expect(screen.getByRole('dialog')).toHaveTextContent('retry');
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm delete bookmark' }));
    await waitFor(() => expect(deleteMutation).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
