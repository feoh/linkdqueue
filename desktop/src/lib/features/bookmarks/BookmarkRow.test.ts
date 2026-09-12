import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import BookmarkRow from './BookmarkRow.svelte';
import type { Bookmark } from '../../api/types';

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
});
