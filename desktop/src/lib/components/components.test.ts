import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import AppShell from './AppShell.svelte';
import Dialog from './Dialog.svelte';
import StatusMessage from './StatusMessage.svelte';
import Toolbar from './Toolbar.svelte';

describe('AppShell', () => {
  it('exposes labelled navigation and reports section changes', async () => {
    const onNavigate = vi.fn();
    render(AppShell, {
      props: {
        items: [
          { id: 'queue', label: 'Queue' },
          { id: 'settings', label: 'Settings' },
        ],
        activeId: 'queue',
        onNavigate,
      },
    });

    expect(screen.getByRole('complementary', { name: 'Primary navigation' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
    const queue = screen.getByRole('button', { name: 'Queue' });
    const settings = screen.getByRole('button', { name: 'Settings' });
    expect(queue).toHaveAttribute('aria-current', 'page');
    queue.focus();
    expect(document.activeElement).toBe(queue);
    settings.focus();
    expect(document.activeElement).toBe(settings);

    await fireEvent.click(settings);
    expect(onNavigate).toHaveBeenCalledWith('settings');
  });
});

describe('Toolbar', () => {
  it('keeps the search control labelled and emits drafts', async () => {
    const onSearch = vi.fn();
    render(Toolbar, {
      props: { eyebrow: 'Connected', title: 'Queue', onSearch },
    });

    const search = screen.getByRole('searchbox', { name: 'Search bookmarks' });
    await fireEvent.input(search, { target: { value: 'accessibility' } });
    expect(onSearch).toHaveBeenCalledWith('accessibility');
  });
});

describe('StatusMessage', () => {
  it('does not repeat a busy action and disables retry while it is running', async () => {
    const retry = vi.fn();
    render(StatusMessage, {
      props: {
        variant: 'error',
        title: 'Could not connect',
        message: 'Try again.',
        retry,
        busy: true,
      },
    });

    const button = screen.getByRole('button', { name: 'Working…' });
    expect(button).toBeDisabled();
    await fireEvent.click(button);
    expect(retry).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not connect');
  });
});

describe('Dialog', () => {
  it('closes with Escape through the native dialog policy', async () => {
    const onClose = vi.fn();
    render(Dialog, {
      props: { open: true, title: 'Add bookmark', onClose },
    });

    await fireEvent.keyDown(screen.getByRole('dialog', { name: 'Add bookmark' }), {
      key: 'Escape',
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('has an accessible name and restores focus after closing', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open dialog';
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();

    render(Dialog, {
      props: {
        open: true,
        title: 'Add bookmark',
        description: 'Enter bookmark details.',
        onClose,
      },
    });

    const dialog = screen.getByRole('dialog', { name: 'Add bookmark' });
    expect(dialog).toHaveAccessibleDescription('Enter bookmark details.');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    await fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
  });
});
