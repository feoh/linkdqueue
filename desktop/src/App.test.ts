import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import App from './App.svelte';

describe('foundation shell', () => {
  it('changes the active section through the sidebar', async () => {
    render(App);

    await fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Archive');
    expect(screen.getByRole('button', { name: 'Archive' })).toHaveClass('active');
  });

  it('keeps search as an ephemeral draft in the current shell', async () => {
    render(App);
    const search = screen.getByRole('searchbox', { name: 'Search bookmarks' });

    await fireEvent.input(search, { target: { value: 'design systems' } });

    expect(screen.getByText('Search draft:')).toBeInTheDocument();
    expect(screen.getByText('design systems')).toBeInTheDocument();
  });
});
