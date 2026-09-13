import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export const MENU_EVENTS = {
  newBookmark: 'menu:new-bookmark',
  search: 'menu:search',
  refresh: 'menu:refresh',
  settings: 'menu:settings',
} as const;

export type MenuEventName = (typeof MENU_EVENTS)[keyof typeof MENU_EVENTS];
export type MenuEventHandlers = Record<MenuEventName, () => void>;
export type ListenForMenuEvent = (
  event: MenuEventName,
  handler: (event: { payload: null }) => void,
) => Promise<UnlistenFn>;

const tauriListen: ListenForMenuEvent = (event, handler) => listen<null>(event, handler);

/** Register the fixed native-menu event contract once per mounted app. */
export async function listenForMenuEvents(
  handlers: MenuEventHandlers,
  listenEvent: ListenForMenuEvent = tauriListen,
): Promise<UnlistenFn[]> {
  const unlisteners: UnlistenFn[] = [];
  try {
    for (const event of Object.values(MENU_EVENTS) as MenuEventName[])
      unlisteners.push(await listenEvent(event, () => handlers[event]()));
    return unlisteners;
  } catch (error: unknown) {
    unlisteners.forEach((unlisten) => unlisten());
    throw error;
  }
}
