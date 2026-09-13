import { describe, expect, it, vi } from 'vitest';

import { listenForMenuEvents, MENU_EVENTS, type MenuEventHandlers } from './menu';

describe('native menu event bridge', () => {
  it('registers each fixed event once and cleans every listener', async () => {
    const callbacks = new Map<string, () => void>();
    const unlisteners = new Map<string, ReturnType<typeof vi.fn>>();
    const listenEvent = vi.fn(
      async (event: string, handler: (event: { payload: null }) => void) => {
        callbacks.set(event, () => handler({ payload: null }));
        const unlisten = vi.fn();
        unlisteners.set(event, unlisten);
        return unlisten;
      },
    );
    const handlers: MenuEventHandlers = {
      [MENU_EVENTS.newBookmark]: vi.fn(),
      [MENU_EVENTS.search]: vi.fn(),
      [MENU_EVENTS.refresh]: vi.fn(),
      [MENU_EVENTS.settings]: vi.fn(),
    };

    const cleanup = await listenForMenuEvents(handlers, listenEvent);

    expect(listenEvent).toHaveBeenCalledTimes(4);
    for (const event of Object.values(MENU_EVENTS)) callbacks.get(event)?.();
    expect(handlers[MENU_EVENTS.newBookmark]).toHaveBeenCalledTimes(1);
    expect(handlers[MENU_EVENTS.search]).toHaveBeenCalledTimes(1);
    expect(handlers[MENU_EVENTS.refresh]).toHaveBeenCalledTimes(1);
    expect(handlers[MENU_EVENTS.settings]).toHaveBeenCalledTimes(1);

    cleanup.forEach((unlisten) => unlisten());
    expect([...unlisteners.values()].every((unlisten) => unlisten.mock.calls.length === 1)).toBe(
      true,
    );
  });
});
