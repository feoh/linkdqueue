//! Native application menus and their fixed renderer event contract.

use tauri::menu::{Menu, MenuEvent, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime};

pub const NEW_BOOKMARK_EVENT: &str = "menu:new-bookmark";
pub const SEARCH_EVENT: &str = "menu:search";
pub const REFRESH_EVENT: &str = "menu:refresh";
pub const SETTINGS_EVENT: &str = "menu:settings";

const NEW_BOOKMARK_ID: &str = "new-bookmark";
const SEARCH_ID: &str = "search";
const REFRESH_ID: &str = "refresh";
const SETTINGS_ID: &str = "settings";
const QUIT_ID: &str = "quit";
const NEW_BOOKMARK_ACCELERATOR: &str = "CmdOrCtrl+N";
const SEARCH_ACCELERATOR: &str = "CmdOrCtrl+F";
const REFRESH_ACCELERATOR: &str = "CmdOrCtrl+R";
const SETTINGS_ACCELERATOR: &str = "CmdOrCtrl+,";
const QUIT_ACCELERATOR: &str = "CmdOrCtrl+Q";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MenuAction {
    NewBookmark,
    Search,
    Refresh,
    Settings,
    Quit,
}

fn action_for_id(id: &tauri::menu::MenuId) -> Option<MenuAction> {
    if id == NEW_BOOKMARK_ID {
        Some(MenuAction::NewBookmark)
    } else if id == SEARCH_ID {
        Some(MenuAction::Search)
    } else if id == REFRESH_ID {
        Some(MenuAction::Refresh)
    } else if id == SETTINGS_ID {
        Some(MenuAction::Settings)
    } else if id == QUIT_ID {
        Some(MenuAction::Quit)
    } else {
        None
    }
}

/// Construct the conventional native app, File, Edit, and View menus.
///
/// The predefined edit items operate on the focused native/webview control. The
/// workflow items have fixed IDs and are translated to fixed renderer events by
/// [`handle_menu_event`], rather than forwarding arbitrary menu payloads.
pub fn build_menu<R: Runtime, M: Manager<R>>(manager: &M) -> tauri::Result<Menu<R>> {
    let new_bookmark = MenuItemBuilder::with_id(NEW_BOOKMARK_ID, "New Bookmark")
        .accelerator(NEW_BOOKMARK_ACCELERATOR)
        .build(manager)?;
    let search = MenuItemBuilder::with_id(SEARCH_ID, "Search")
        .accelerator(SEARCH_ACCELERATOR)
        .build(manager)?;
    let refresh = MenuItemBuilder::with_id(REFRESH_ID, "Refresh")
        .accelerator(REFRESH_ACCELERATOR)
        .build(manager)?;
    let settings = MenuItemBuilder::with_id(SETTINGS_ID, "Settings")
        .accelerator(SETTINGS_ACCELERATOR)
        .build(manager)?;
    let quit = MenuItemBuilder::with_id(QUIT_ID, "Quit")
        .accelerator(QUIT_ACCELERATOR)
        .build(manager)?;

    let app = SubmenuBuilder::new(manager, "Linkdqueue")
        .item(&PredefinedMenuItem::about(
            manager,
            Some("About Linkdqueue"),
            None,
        )?)
        .separator()
        .item(&quit)
        .build()?;
    let file = SubmenuBuilder::new(manager, "File")
        .item(&new_bookmark)
        .separator()
        .item(&PredefinedMenuItem::close_window(
            manager,
            Some("Close Window"),
        )?)
        .build()?;
    let edit = SubmenuBuilder::new(manager, "Edit")
        .item(&PredefinedMenuItem::undo(manager, None)?)
        .item(&PredefinedMenuItem::redo(manager, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(manager, None)?)
        .item(&PredefinedMenuItem::copy(manager, None)?)
        .item(&PredefinedMenuItem::paste(manager, None)?)
        .separator()
        .item(&PredefinedMenuItem::select_all(manager, None)?)
        .build()?;
    let view = SubmenuBuilder::new(manager, "View")
        .item(&search)
        .item(&refresh)
        .separator()
        .item(&settings)
        .build()?;

    Menu::with_items(manager, &[&app, &file, &edit, &view])
}

/// Route a native workflow menu action to exactly one fixed renderer event.
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    match action_for_id(event.id()) {
        Some(MenuAction::NewBookmark) => emit_renderer_event(app, NEW_BOOKMARK_EVENT),
        Some(MenuAction::Search) => emit_renderer_event(app, SEARCH_EVENT),
        Some(MenuAction::Refresh) => emit_renderer_event(app, REFRESH_EVENT),
        Some(MenuAction::Settings) => emit_renderer_event(app, SETTINGS_EVENT),
        Some(MenuAction::Quit) => app.exit(0),
        None => {}
    }
}

fn emit_renderer_event<R: Runtime>(app: &AppHandle<R>, event: &str) {
    // There is one renderer window; targeting it keeps the event contract
    // explicit and avoids exposing menu IDs or arbitrary payloads to Svelte.
    let _ = app.emit_to(EventTarget::webview_window("main"), event, ());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_menu_ids_map_only_to_fixed_actions() {
        assert_eq!(
            action_for_id(&NEW_BOOKMARK_ID.into()),
            Some(MenuAction::NewBookmark)
        );
        assert_eq!(action_for_id(&SEARCH_ID.into()), Some(MenuAction::Search));
        assert_eq!(action_for_id(&REFRESH_ID.into()), Some(MenuAction::Refresh));
        assert_eq!(
            action_for_id(&SETTINGS_ID.into()),
            Some(MenuAction::Settings)
        );
        assert_eq!(action_for_id(&QUIT_ID.into()), Some(MenuAction::Quit));
        assert_eq!(action_for_id(&"unexpected".into()), None);
    }

    #[test]
    fn renderer_event_names_are_fixed_and_payload_free() {
        assert_eq!(NEW_BOOKMARK_EVENT, "menu:new-bookmark");
        assert_eq!(SEARCH_EVENT, "menu:search");
        assert_eq!(REFRESH_EVENT, "menu:refresh");
        assert_eq!(SETTINGS_EVENT, "menu:settings");
    }

    #[test]
    fn workflow_accelerators_use_the_platform_neutral_cmd_or_ctrl_form() {
        assert_eq!(NEW_BOOKMARK_ACCELERATOR, "CmdOrCtrl+N");
        assert_eq!(SEARCH_ACCELERATOR, "CmdOrCtrl+F");
        assert_eq!(REFRESH_ACCELERATOR, "CmdOrCtrl+R");
        assert_eq!(SETTINGS_ACCELERATOR, "CmdOrCtrl+,");
        assert_eq!(QUIT_ACCELERATOR, "CmdOrCtrl+Q");
    }
}
