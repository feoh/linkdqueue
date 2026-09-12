import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import type { AppError, Bookmark } from '../../api/types';
import TagInput from '../../components/TagInput.svelte';
import type { MutationResult } from '../../queries/mutations';
import AddBookmarkDialog from './AddBookmarkDialog.svelte';

const confirmed = (): MutationResult<Bookmark> => ({
  status: 'confirmed',
  data: {} as Bookmark,
});

describe('AddBookmarkDialog', () => {
  it('validates URL and sends the minimum payload, omitting blank optionals', async () => {
    const createBookmark = vi.fn().mockResolvedValue(confirmed());
    const onClose = vi.fn();
    render(AddBookmarkDialog, { props: { open: true, createBookmark, onClose } });

    await fireEvent.click(screen.getByRole('button', { name: 'Save bookmark' }));
    expect(createBookmark).not.toHaveBeenCalled();
    await fireEvent.input(screen.getByLabelText(/URL/), {
      target: { value: 'ftp://example.test/item' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save bookmark' }));
    expect(createBookmark).not.toHaveBeenCalled();
    await fireEvent.input(screen.getByLabelText(/URL/), {
      target: { value: 'https://example.test/item' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save bookmark' }));
    await waitFor(() =>
      expect(createBookmark).toHaveBeenCalledWith({ url: 'https://example.test/item' }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sends optionals and read state, tokenizes tags, and prevents a second POST', async () => {
    let resolve: (result: MutationResult<Bookmark>) => void = () => undefined;
    const createBookmark = vi
      .fn()
      .mockReturnValue(new Promise<MutationResult<Bookmark>>((r) => (resolve = r)));
    render(AddBookmarkDialog, {
      props: { open: true, createBookmark, suggestions: ['work', 'later'] },
    });
    await fireEvent.input(screen.getByLabelText(/URL/), {
      target: { value: 'https://example.test' },
    });
    await fireEvent.input(screen.getByLabelText(/Title/), { target: { value: ' Read this ' } });
    await fireEvent.input(screen.getByLabelText(/Description/), { target: { value: ' Notes ' } });
    await fireEvent.click(screen.getByLabelText('Mark as read'));
    const tagInput = screen.getByRole('combobox');
    await fireEvent.input(tagInput, { target: { value: 'work later' } });
    await fireEvent.keyDown(tagInput, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Remove work/ })).toBeInTheDocument(),
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Save bookmark' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Saving…' }));
    expect(createBookmark).toHaveBeenCalledTimes(1);
    expect(createBookmark).toHaveBeenCalledWith({
      url: 'https://example.test',
      title: 'Read this',
      description: 'Notes',
      tagNames: ['work', 'later'],
      isRead: true,
    });
    resolve(confirmed());
  });

  it('deduplicates repeated exact tag names and resets a discarded draft', async () => {
    const onChange = vi.fn();
    render(TagInput, {
      props: { selectedNames: [], onChange },
    });
    const input = screen.getByRole('combobox');
    await fireEvent.input(input, { target: { value: 'Work Work Work' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['Work']);

    const createBookmark = vi.fn().mockResolvedValue(confirmed());
    const onClose = vi.fn();
    const dialog = render(AddBookmarkDialog, { props: { open: true, createBookmark, onClose } });
    await fireEvent.input(screen.getByLabelText(/URL/), {
      target: { value: 'https://example.test' },
    });
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    await dialog.rerender({ open: false, createBookmark, onClose });
    await dialog.rerender({ open: true, createBookmark, onClose });
    expect(screen.getByLabelText(/URL/)).toHaveValue('');
  });

  it.each([
    [
      'failed',
      { code: 'bad_request', message: 'Linkding rejected the request.', retryable: false },
    ],
    [
      'unknown-outcome',
      {
        code: 'timeout_unknown_outcome',
        message: 'The mutation timed out; reconcile before retrying.',
        retryable: false,
      },
    ],
    [
      'sync-failed',
      {
        code: 'network_error',
        message: 'The Linkding server could not be reached.',
        retryable: true,
      },
    ],
    [
      'stale',
      {
        code: 'stale_generation',
        message: 'The connection changed; retry with current settings.',
        retryable: false,
      },
    ],
  ] as const)('retains the draft for %s results without reposting', async (status, error) => {
    const createBookmark = vi.fn().mockResolvedValue(
      status === 'stale'
        ? { status, data: {} as Bookmark }
        : {
            status,
            error: error as AppError,
            ...(status === 'sync-failed' ? { data: {} as Bookmark } : {}),
          },
    );
    render(AddBookmarkDialog, { props: { open: true, createBookmark } });
    await fireEvent.input(screen.getByLabelText(/URL/), {
      target: { value: 'https://example.test' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save bookmark' }));
    await waitFor(() => expect(createBookmark).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(/URL/)).toHaveValue('https://example.test');
    if (status !== 'unknown-outcome' && status !== 'sync-failed')
      await fireEvent.click(screen.getByRole('button', { name: 'Save bookmark' }));
    expect(createBookmark).toHaveBeenCalledTimes(status === 'failed' || status === 'stale' ? 2 : 1);
  });
});
