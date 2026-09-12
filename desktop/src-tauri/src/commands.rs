//! Narrow renderer-facing Tauri commands.
//!
//! These adapters contain no generic transport, filesystem, shell, or
//! credential commands. Authenticated operations receive a generation and use
//! the session's immutable private snapshot before doing network I/O.

use std::sync::Arc;

use tauri::State;

use crate::credentials::NativeCredentialStore;
use crate::domain::{
    Bookmark, BookmarkIdInput, CreateBookmarkInput, ListBookmarksInput, ListTagsInput,
    MarkReadInput, Page, ReplaceTagsInput, Tag,
};
use crate::error::AppError;
use crate::http::LinkdingHttpTransport;
use crate::opener::{open_external_url_with, NativeExternalOpener, OpenExternalUrlInput};
use crate::preferences::PreferencesStore;
use crate::session::{
    ClearConnectionInput, ClearConnectionResult, PublicSessionSnapshot, SaveConnectionInput,
    SaveConnectionResult, SessionService, SetDisplayPreferencesInput, TestConnectionInput,
    TestConnectionResult,
};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandEnvelope<T> {
    pub generation: u64,
    pub data: T,
}

pub fn session_from_config_dir(config_dir: std::path::PathBuf) -> Result<SessionService, AppError> {
    Ok(SessionService::new(
        PreferencesStore::new(config_dir)?,
        Arc::new(NativeCredentialStore::new()),
    ))
}

#[tauri::command]
pub fn get_settings(state: State<'_, SessionService>) -> PublicSessionSnapshot {
    state.public_snapshot()
}

#[tauri::command]
pub async fn test_connection(
    input: TestConnectionInput,
    state: State<'_, SessionService>,
) -> Result<TestConnectionResult, AppError> {
    state.test_connection(input).await
}

#[tauri::command]
pub async fn save_connection(
    input: SaveConnectionInput,
    state: State<'_, SessionService>,
) -> Result<SaveConnectionResult, AppError> {
    state.save_connection(input).await
}

#[tauri::command]
pub async fn clear_connection(
    input: ClearConnectionInput,
    state: State<'_, SessionService>,
) -> Result<ClearConnectionResult, AppError> {
    state.clear_connection(input).await
}

#[tauri::command]
pub async fn set_display_preferences(
    input: SetDisplayPreferencesInput,
    state: State<'_, SessionService>,
) -> Result<PublicSessionSnapshot, AppError> {
    state.set_display_preferences(input).await
}

#[tauri::command]
pub async fn list_bookmarks(
    input: ListBookmarksInput,
    state: State<'_, SessionService>,
) -> Result<CommandEnvelope<Page<Bookmark>>, AppError> {
    let generation = input.generation;
    state
        .with_authenticated_connection(generation, |connection| async move {
            let transport =
                LinkdingHttpTransport::new(connection.base_url().clone(), connection.token())?;
            transport.list_bookmarks(&input).await
        })
        .await
        .map(|data| CommandEnvelope { generation, data })
}

#[tauri::command]
pub async fn list_tags(
    input: ListTagsInput,
    state: State<'_, SessionService>,
) -> Result<CommandEnvelope<Page<Tag>>, AppError> {
    let generation = input.generation;
    state
        .with_authenticated_connection(generation, |connection| async move {
            let transport =
                LinkdingHttpTransport::new(connection.base_url().clone(), connection.token())?;
            transport.list_tags(&input).await
        })
        .await
        .map(|data| CommandEnvelope { generation, data })
}

#[tauri::command]
pub async fn create_bookmark(
    input: CreateBookmarkInput,
    state: State<'_, SessionService>,
) -> Result<CommandEnvelope<Bookmark>, AppError> {
    let generation = input.generation;
    state
        .with_authenticated_connection(generation, |connection| async move {
            let transport =
                LinkdingHttpTransport::new(connection.base_url().clone(), connection.token())?;
            transport.create_bookmark(&input).await
        })
        .await
        .map(|data| CommandEnvelope { generation, data })
}

#[tauri::command]
pub async fn mark_read(
    input: MarkReadInput,
    state: State<'_, SessionService>,
) -> Result<CommandEnvelope<Bookmark>, AppError> {
    let generation = input.generation;
    state
        .with_authenticated_connection(generation, |connection| async move {
            let transport =
                LinkdingHttpTransport::new(connection.base_url().clone(), connection.token())?;
            transport.mark_read(&input).await
        })
        .await
        .map(|data| CommandEnvelope { generation, data })
}

#[tauri::command]
pub async fn replace_bookmark_tags(
    input: ReplaceTagsInput,
    state: State<'_, SessionService>,
) -> Result<CommandEnvelope<Bookmark>, AppError> {
    let generation = input.generation;
    state
        .with_authenticated_connection(generation, |connection| async move {
            let transport =
                LinkdingHttpTransport::new(connection.base_url().clone(), connection.token())?;
            transport.replace_bookmark_tags(&input).await
        })
        .await
        .map(|data| CommandEnvelope { generation, data })
}

#[derive(Debug, Clone, Copy)]
enum BookmarkMutation {
    Archive,
    Unarchive,
    Delete,
}

async fn bodyless_bookmark_mutation(
    input: BookmarkIdInput,
    state: &SessionService,
    action: BookmarkMutation,
) -> Result<CommandEnvelope<ConfirmedMutation>, AppError> {
    let generation = input.generation;
    state
        .with_authenticated_connection(generation, |connection| async move {
            let transport =
                LinkdingHttpTransport::new(connection.base_url().clone(), connection.token())?;
            match action {
                BookmarkMutation::Archive => transport.archive_bookmark(input.bookmark_id).await?,
                BookmarkMutation::Unarchive => {
                    transport.unarchive_bookmark(input.bookmark_id).await?
                }
                BookmarkMutation::Delete => transport.delete_bookmark(input.bookmark_id).await?,
            }
            Ok(ConfirmedMutation { confirmed: true })
        })
        .await
        .map(|data| CommandEnvelope { generation, data })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct ConfirmedMutation {
    pub confirmed: bool,
}

#[tauri::command]
pub async fn archive_bookmark(
    input: BookmarkIdInput,
    state: State<'_, SessionService>,
) -> Result<CommandEnvelope<ConfirmedMutation>, AppError> {
    bodyless_bookmark_mutation(input, &state, BookmarkMutation::Archive).await
}

#[tauri::command]
pub async fn unarchive_bookmark(
    input: BookmarkIdInput,
    state: State<'_, SessionService>,
) -> Result<CommandEnvelope<ConfirmedMutation>, AppError> {
    bodyless_bookmark_mutation(input, &state, BookmarkMutation::Unarchive).await
}

#[tauri::command]
pub async fn delete_bookmark(
    input: BookmarkIdInput,
    state: State<'_, SessionService>,
) -> Result<CommandEnvelope<ConfirmedMutation>, AppError> {
    bodyless_bookmark_mutation(input, &state, BookmarkMutation::Delete).await
}

#[tauri::command]
pub fn open_external_url(
    input: OpenExternalUrlInput,
    state: State<'_, SessionService>,
) -> Result<(), AppError> {
    state.validate_generation(input.generation)?;
    open_external_url_with(&NativeExternalOpener, input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_serializes_generation_without_private_fields() {
        let envelope = CommandEnvelope {
            generation: 7,
            data: ConfirmedMutation { confirmed: true },
        };
        assert_eq!(
            serde_json::to_string(&envelope).expect("serialize envelope"),
            r#"{"generation":7,"data":{"confirmed":true}}"#
        );
    }
}
