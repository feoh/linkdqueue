import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import type { LinkdqueueBridge } from '../../api/bridge';
import type { TagPage } from '../../queries/tags';
import { TagCatalogue } from '../../queries/tags';
import TagCatalogueView from './TagCatalogueView.svelte';

const page = (names: string[]): TagPage => ({
  generation: 1,
  data: {
    count: names.length,
    next: null,
    previous: null,
    results: names.map((name, id) => ({ id: id + 1, name, date_added: null })),
  },
});

const bridge = (listTags: LinkdqueueBridge['listTags']): LinkdqueueBridge =>
  ({ listTags }) as LinkdqueueBridge;

describe('TagCatalogueView', () => {
  it('sorts, searches, and keyboard-selects the exact Unicode tag name', async () => {
    const catalogue = new TagCatalogue(bridge(vi.fn().mockResolvedValue(page(['zeta', 'Café']))));
    const onSelect = vi.fn();
    const { rerender } = render(TagCatalogueView, {
      props: { catalogue, generation: 1, onSelect },
    });

    await screen.findByRole('button', { name: 'Show all bookmarks tagged Café' });
    const buttons = screen.getAllByRole('button', { name: /Show all bookmarks tagged/ });
    expect(buttons[0]).toHaveTextContent('Café');

    await rerender({ catalogue, generation: 1, onSelect, search: 'café' });
    expect(
      screen.getByRole('button', { name: 'Show all bookmarks tagged Café' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Show all bookmarks tagged zeta' }),
    ).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Show all bookmarks tagged Café' }));
    expect(onSelect).toHaveBeenCalledWith('Café');
  });

  it('offers retry after an initial catalogue failure', async () => {
    const listTags = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page(['one']));
    const catalogue = new TagCatalogue(bridge(listTags));
    render(TagCatalogueView, { props: { catalogue, generation: 1, onSelect: vi.fn() } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load tags');
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /tagged one/ })).toBeInTheDocument(),
    );
    expect(listTags).toHaveBeenCalledTimes(2);
  });
});
