import { render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import type { LinkdqueueBridge } from '../../api/bridge';
import type { Bookmark, CommandEnvelope, Page } from '../../api/types';
import AllTaggedBookmarkList from './AllTaggedBookmarkList.svelte';

type BookmarkPage = CommandEnvelope<Page<Bookmark>>;

const bookmark = (id: number, title: string, unread: boolean, archived: boolean): Bookmark => ({
  id,
  url: `https://example.test/${id}`,
  title,
  description: title,
  notes: '',
  web_archive_snapshot_url: null,
  favicon_url: null,
  preview_image_url: null,
  is_archived: archived,
  unread,
  shared: false,
  tag_names: ['Café'],
  date_added: '2026-01-01',
  date_modified: null,
  website_title: null,
  website_description: null,
});

const page = (results: Bookmark[]): BookmarkPage => ({
  generation: 1,
  data: { count: results.length, next: null, previous: null, results },
});

const bridge = (listBookmarks: LinkdqueueBridge['listBookmarks']): LinkdqueueBridge =>
  ({ listBookmarks }) as LinkdqueueBridge;

describe('AllTaggedBookmarkList', () => {
  it('loads all read/archive states without silently applying the queue unread filter', async () => {
    const listBookmarks = vi.fn(async (input) =>
      input.scope === 'all'
        ? page([
            bookmark(1, 'Unread active', true, false),
            bookmark(2, 'Read active', false, false),
          ])
        : page([
            bookmark(3, 'Unread archived', true, true),
            bookmark(4, 'Read archived', false, true),
          ]),
    );

    render(AllTaggedBookmarkList, {
      props: { bridge: bridge(listBookmarks), generation: 1, tag: 'Café' },
    });

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Read active' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('heading', { name: 'Unread archived' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(listBookmarks.mock.calls.map(([input]) => input.scope)).toEqual(['all', 'archive']);
    expect(listBookmarks.mock.calls.every(([input]) => input.tag === 'Café')).toBe(true);
  });
});
