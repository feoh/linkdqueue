//! In-process connection bootstrap and generation-guarded snapshots.
//!
//! This module is deliberately below the Tauri command layer. It owns the
//! short-lived authenticated connection snapshot used by service commands,
//! while exposing only redacted state to the renderer-facing layer.

use std::fmt;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex as AsyncMutex;

use crate::credentials::{credential_reference, CredentialError, CredentialStore};
use crate::domain::DisplayPreferences;
use crate::error::{AppError, ErrorCode};
use crate::http::LinkdingHttpTransport;
use crate::preferences::{ConnectionState, PendingSave, Preferences, PreferencesStore};
use crate::validation::{validate_token, ValidatedBaseUrl};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Initializing,
    Unconfigured,
    Ready,
    CredentialError,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialStatus {
    Available,
    Missing,
    Locked,
    Unavailable,
}

/// Safe-to-publish connection state. It intentionally has no token, keyring
/// value, authorization header, or diagnostic body.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicSessionSnapshot {
    pub status: SessionStatus,
    pub canonical_base_url: Option<String>,
    pub credential_status: Option<CredentialStatus>,
    pub error_code: Option<ErrorCode>,
    pub allow_insecure_http: bool,
    pub pending_cleanup: bool,
    pub display: DisplayPreferences,
    pub generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionInput {
    pub base_url: String,
    pub new_token: String,
    #[serde(default)]
    pub allow_insecure_http: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionResult {
    pub reachable: bool,
    pub server_version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveConnectionInput {
    pub base_url: String,
    #[serde(default)]
    pub new_token: Option<String>,
    #[serde(default)]
    pub retain_existing_token: bool,
    #[serde(default)]
    pub allow_insecure_http: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SaveWarning {
    OldCredentialCleanupFailed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveConnectionResult {
    pub settings: PublicSessionSnapshot,
    pub warning: Option<SaveWarning>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearConnectionInput {
    pub generation: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClearWarning {
    CredentialDeleteFailed,
    PreferencesWriteFailed,
    OldStateMayReturn,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearConnectionResult {
    pub disconnected: bool,
    pub durable: bool,
    pub cleanup_pending: bool,
    pub warning: Option<ClearWarning>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDisplayPreferencesInput {
    pub generation: u64,
    pub theme: String,
    pub text_scale: f64,
}

/// An immutable authenticated snapshot for Rust service code only. The token
/// is never serialized and is redacted even when a service logs this value.
#[allow(dead_code)]
#[derive(Clone)]
pub(crate) struct AuthenticatedConnection {
    base_url: ValidatedBaseUrl,
    credential_ref: String,
    token: String,
    allow_insecure_http: bool,
}

#[allow(dead_code)]
impl AuthenticatedConnection {
    pub(crate) fn new(
        base_url: ValidatedBaseUrl,
        credential_ref: String,
        token: String,
        allow_insecure_http: bool,
    ) -> Self {
        Self {
            base_url,
            credential_ref,
            token,
            allow_insecure_http,
        }
    }

    pub(crate) fn base_url(&self) -> &ValidatedBaseUrl {
        &self.base_url
    }

    pub(crate) fn credential_ref(&self) -> &str {
        &self.credential_ref
    }

    pub(crate) fn token(&self) -> &str {
        &self.token
    }

    pub(crate) fn allow_insecure_http(&self) -> bool {
        self.allow_insecure_http
    }
}

impl fmt::Debug for AuthenticatedConnection {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AuthenticatedConnection")
            .field("base_url", &self.base_url.as_str())
            .field("credential_ref", &self.credential_ref)
            .field("token", &"<redacted>")
            .field("allow_insecure_http", &self.allow_insecure_http)
            .finish()
    }
}

struct RuntimeState {
    generation: u64,
    status: SessionStatus,
    canonical_base_url: Option<String>,
    credential_status: Option<CredentialStatus>,
    error_code: Option<ErrorCode>,
    allow_insecure_http: bool,
    pending_cleanup: bool,
    pending_save: bool,
    display: DisplayPreferences,
    connection: Option<AuthenticatedConnection>,
}

impl fmt::Debug for RuntimeState {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RuntimeState")
            .field("generation", &self.generation)
            .field("status", &self.status)
            .field("canonical_base_url", &self.canonical_base_url)
            .field("credential_status", &self.credential_status)
            .field("error_code", &self.error_code)
            .field("allow_insecure_http", &self.allow_insecure_http)
            .field("pending_cleanup", &self.pending_cleanup)
            .field("display", &self.display)
            .field("has_private_connection", &self.connection.is_some())
            .finish()
    }
}

impl RuntimeState {
    fn initializing() -> Self {
        Self {
            generation: 0,
            status: SessionStatus::Initializing,
            canonical_base_url: None,
            credential_status: None,
            error_code: None,
            allow_insecure_http: false,
            pending_cleanup: false,
            pending_save: false,
            display: DisplayPreferences {
                theme: "system".to_owned(),
                text_scale: 1.0,
            },
            connection: None,
        }
    }

    fn public_snapshot(&self) -> PublicSessionSnapshot {
        PublicSessionSnapshot {
            status: self.status,
            canonical_base_url: self.canonical_base_url.clone(),
            credential_status: self.credential_status,
            error_code: self.error_code,
            allow_insecure_http: self.allow_insecure_http,
            pending_cleanup: self.pending_cleanup || self.pending_save,
            display: self.display.clone(),
            generation: self.generation,
        }
    }
}

struct SessionInner {
    preferences: PreferencesStore,
    credentials: Arc<dyn CredentialStore>,
    next_generation: AtomicU64,
    state: Mutex<RuntimeState>,
    operation: AsyncMutex<()>,
}

/// Owns one process-local connection generation. All mutex guards are dropped
/// before an async operation is awaited; a request receives an immutable copy
/// of the authenticated snapshot instead.
#[derive(Clone)]
pub struct SessionService {
    inner: Arc<SessionInner>,
}

impl fmt::Debug for SessionService {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SessionService")
            .field("state", &self.public_snapshot())
            .finish()
    }
}

impl SessionService {
    pub fn new(preferences: PreferencesStore, credentials: Arc<dyn CredentialStore>) -> Self {
        Self {
            inner: Arc::new(SessionInner {
                preferences,
                credentials,
                next_generation: AtomicU64::new(0),
                state: Mutex::new(RuntimeState::initializing()),
                operation: AsyncMutex::new(()),
            }),
        }
    }

    pub fn public_snapshot(&self) -> PublicSessionSnapshot {
        self.inner
            .state
            .lock()
            .expect("session state lock")
            .public_snapshot()
    }

    /// Check a renderer request's generation without exposing the private
    /// authenticated connection. This is used by commands that do not need a
    /// token, such as the constrained external opener.
    pub(crate) fn validate_generation(&self, expected_generation: u64) -> Result<(), AppError> {
        let state = self.inner.state.lock().expect("session state lock");
        ensure_current_generation(&state, expected_generation)
    }

    /// Load non-secret preferences and, only for a configured connection, read
    /// the exact referenced native credential. The blocking store call runs on
    /// a worker and never while the runtime state mutex is held.
    pub async fn bootstrap(&self) -> Result<PublicSessionSnapshot, AppError> {
        let _operation = self.inner.operation.lock().await;
        let attempt_generation = self.begin_initializing()?;
        let preferences = self.inner.preferences.clone();
        let credentials = Arc::clone(&self.inner.credentials);
        let loaded = tokio::task::spawn_blocking(move || load_bootstrap(preferences, credentials))
            .await
            .map_err(|_| internal_error("Connection bootstrap failed."))?;

        let mut state = self.inner.state.lock().expect("session state lock");
        if state.generation != attempt_generation || state.status != SessionStatus::Initializing {
            return Err(stale_generation());
        }

        match loaded {
            BootstrapLoad::PreferencesError(error) => {
                state.status = SessionStatus::CredentialError;
                state.error_code = Some(error.code);
                state.credential_status = None;
                state.connection = None;
                Err(error)
            }
            BootstrapLoad::Unconfigured {
                preferences,
                pending_cleanup,
            } => {
                apply_preferences(&mut state, &preferences);
                state.status = SessionStatus::Unconfigured;
                state.pending_cleanup = pending_cleanup;
                state.connection = None;
                Ok(state.public_snapshot())
            }
            BootstrapLoad::CredentialError {
                preferences,
                status,
                error,
            } => {
                apply_preferences(&mut state, &preferences);
                state.status = SessionStatus::CredentialError;
                state.credential_status = Some(status);
                state.error_code = Some(error.code);
                state.connection = None;
                Err(error)
            }
            BootstrapLoad::Ready { preferences, token } => {
                let connection = AuthenticatedConnection::new(
                    validated_base_url(&preferences)?,
                    preferences
                        .connection
                        .credential_ref
                        .clone()
                        .expect("configured preferences have a credential reference"),
                    token,
                    preferences.connection.allow_insecure_http,
                );
                apply_preferences(&mut state, &preferences);
                state.status = SessionStatus::Ready;
                state.credential_status = Some(CredentialStatus::Available);
                state.error_code = None;
                state.connection = Some(connection);
                Ok(state.public_snapshot())
            }
        }
    }

    /// Test only the explicit draft. This does not read or mutate saved
    /// preferences, native credentials, or the active session.
    pub async fn test_connection(
        &self,
        input: TestConnectionInput,
    ) -> Result<TestConnectionResult, AppError> {
        let base_url =
            crate::validation::validate_base_url(&input.base_url, input.allow_insecure_http)?;
        let token = validate_token(&input.new_token)?;
        let transport = LinkdingHttpTransport::new(base_url, &token)?;
        let profile = transport.get_profile().await?;
        Ok(TestConnectionResult {
            reachable: true,
            server_version: profile
                .get("version")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned),
        })
    }

    /// Save a new connection or explicitly retain the credential for the
    /// unchanged endpoint. The operation lock serializes save/clear work while
    /// all filesystem and keyring I/O happens without the state mutex held.
    pub async fn save_connection(
        &self,
        input: SaveConnectionInput,
    ) -> Result<SaveConnectionResult, AppError> {
        let _operation = self.inner.operation.lock().await;
        let base_url =
            crate::validation::validate_base_url(&input.base_url, input.allow_insecure_http)?;
        let new_token = match (input.new_token.as_deref(), input.retain_existing_token) {
            (Some(_), true) | (None, false) => {
                return Err(AppError::invalid_input(
                    "Choose exactly one connection credential option.",
                ));
            }
            (Some(token), false) => Some(validate_token(token)?),
            (None, true) => None,
        };
        let (expected_generation, current_connection) = self.current_connection()?;
        let preferences_store = self.inner.preferences.clone();
        let credentials = Arc::clone(&self.inner.credentials);
        let persisted = tokio::task::spawn_blocking(move || {
            let persisted = preferences_store.load()?;
            Ok::<_, AppError>(recover_pending_operations(
                &preferences_store,
                credentials.as_ref(),
                persisted,
            ))
        })
        .await
        .map_err(|_| internal_error("Preferences could not be loaded."))??;
        if persisted.connection.pending_save.is_some()
            || persisted.connection.pending_cleanup.is_some()
        {
            return Err(AppError::new(
                ErrorCode::KeyringUnavailable,
                "A previous credential cleanup needs recovery before saving.",
                true,
            ));
        }

        let (credential_ref, token, new_reference) = if let Some(token) = new_token {
            let canonical_reference = credential_reference(base_url.as_str());
            let reference = if current_connection
                .as_ref()
                .is_some_and(|current| current.base_url().as_str() == base_url.as_str())
            {
                staged_credential_reference(base_url.as_str(), expected_generation)
            } else {
                canonical_reference
            };
            let mut journal = persisted.clone();
            journal.connection.pending_save = Some(PendingSave {
                canonical_base_url: base_url.as_str().to_owned(),
                credential_ref: reference.clone(),
                allow_insecure_http: input.allow_insecure_http,
            });
            let journal_store = self.inner.preferences.clone();
            tokio::task::spawn_blocking(move || journal_store.save(&journal))
                .await
                .map_err(|_| internal_error("Preferences could not be saved."))??;

            let credentials = Arc::clone(&self.inner.credentials);
            let write_reference = reference.clone();
            let write_token = token.clone();
            tokio::task::spawn_blocking(move || {
                credentials
                    .set(&write_reference, &write_token)
                    .and_then(|()| match credentials.get(&write_reference) {
                        Ok(Some(stored)) if stored == write_token => Ok(()),
                        Ok(Some(_)) | Ok(None) => {
                            let _ = credentials.delete(&write_reference);
                            Err(CredentialError::OperationFailed)
                        }
                        Err(error) => {
                            let _ = credentials.delete(&write_reference);
                            Err(error)
                        }
                    })
            })
            .await
            .map_err(|_| internal_error("The native credential operation failed."))?
            .map_err(CredentialError::app_error)?;
            (reference.clone(), token, Some(reference))
        } else {
            let current = current_connection.as_ref().ok_or_else(|| {
                AppError::invalid_input("Retaining a token requires a saved connection.")
            })?;
            if current.base_url().as_str() != base_url.as_str()
                || current.allow_insecure_http() != input.allow_insecure_http
            {
                return Err(AppError::invalid_input(
                    "Retaining a token requires the unchanged canonical endpoint.",
                ));
            }
            let credentials = Arc::clone(&self.inner.credentials);
            let reference = current.credential_ref().to_owned();
            let read_reference = reference.clone();
            let token = tokio::task::spawn_blocking(move || credentials.get(&read_reference))
                .await
                .map_err(|_| internal_error("The native credential operation failed."))?
                .map_err(CredentialError::app_error)?
                .filter(|token| !token.trim().is_empty())
                .ok_or_else(|| CredentialError::Missing.app_error())?;
            (reference, token, None)
        };

        let mut next = persisted;
        next.generation = next
            .generation
            .checked_add(1)
            .ok_or_else(|| internal_error("Preferences generation overflowed."))?;
        next.connection.state = ConnectionState::Configured;
        next.connection.canonical_base_url = Some(base_url.as_str().to_owned());
        next.connection.credential_ref = Some(credential_ref.clone());
        next.connection.allow_insecure_http = input.allow_insecure_http;
        next.connection.pending_save = None;
        let old_reference = current_connection.as_ref().and_then(|old| {
            (old.credential_ref() != credential_ref).then(|| old.credential_ref().to_owned())
        });
        next.connection.pending_cleanup = old_reference.clone();
        let save_store = self.inner.preferences.clone();
        let save_result = tokio::task::spawn_blocking(move || save_store.save(&next))
            .await
            .map_err(|_| internal_error("Preferences could not be saved."))?;
        if let Err(error) = save_result {
            if let Some(reference) = new_reference.as_ref() {
                if self.delete_credential(reference).await.is_err() {
                    return Err(AppError::new(
                        ErrorCode::PreferencesWriteFailed,
                        "Preferences could not be saved and staged credential cleanup failed.",
                        true,
                    ));
                }
            }
            return Err(error);
        }

        let replacement = AuthenticatedConnection::new(
            base_url,
            credential_ref.clone(),
            token,
            input.allow_insecure_http,
        );
        let mut settings = self.replace_connection(expected_generation, replacement)?;
        let warning = if let Some(old_reference) = old_reference {
            match self.delete_credential(&old_reference).await {
                Ok(()) => {
                    let store = self.inner.preferences.clone();
                    let clear_result = tokio::task::spawn_blocking(move || {
                        let mut preferences = store.load()?;
                        if preferences.connection.pending_cleanup.as_deref()
                            == Some(old_reference.as_str())
                        {
                            preferences.connection.pending_cleanup = None;
                            store.save(&preferences)?;
                        }
                        Ok::<_, AppError>(())
                    })
                    .await
                    .map_err(|_| internal_error("Preferences could not be updated."))?;
                    if clear_result.is_err() {
                        settings = self.set_cleanup_pending(settings.generation, true)?;
                        Some(SaveWarning::OldCredentialCleanupFailed)
                    } else {
                        None
                    }
                }
                Err(_) => {
                    settings = self.set_cleanup_pending(settings.generation, true)?;
                    Some(SaveWarning::OldCredentialCleanupFailed)
                }
            }
        } else {
            None
        };
        Ok(SaveConnectionResult { settings, warning })
    }

    pub async fn set_display_preferences(
        &self,
        input: SetDisplayPreferencesInput,
    ) -> Result<PublicSessionSnapshot, AppError> {
        let _operation = self.inner.operation.lock().await;
        let (current_generation, _) = self.current_connection()?;
        ensure_current_generation(
            &self.inner.state.lock().expect("session state lock"),
            input.generation,
        )?;
        if input.generation != current_generation {
            return Err(stale_generation());
        }
        let store = self.inner.preferences.clone();
        let theme = input.theme.clone();
        let text_scale = input.text_scale;
        tokio::task::spawn_blocking(move || {
            let mut preferences = store.load()?;
            preferences.display = crate::preferences::DisplayPreferences { theme, text_scale };
            store.save(&preferences)
        })
        .await
        .map_err(|_| internal_error("Preferences could not be saved."))??;
        let mut state = self.inner.state.lock().expect("session state lock");
        ensure_current_generation(&state, input.generation)?;
        state.display = DisplayPreferences {
            theme: input.theme,
            text_scale: input.text_scale,
        };
        Ok(state.public_snapshot())
    }

    /// Disable the current process before attempting persistent disconnect.
    /// The tombstone is written before deletion so a restart cannot reconnect
    /// while the exact owned credential still exists.
    pub async fn clear_connection(
        &self,
        input: ClearConnectionInput,
    ) -> Result<ClearConnectionResult, AppError> {
        let _operation = self.inner.operation.lock().await;
        let (current_generation, current_connection) = self.current_connection()?;
        if input.generation != current_generation {
            return Err(stale_generation());
        }

        let Some(current_connection) = current_connection else {
            let persisted = {
                let store = self.inner.preferences.clone();
                tokio::task::spawn_blocking(move || store.load())
                    .await
                    .map_err(|_| internal_error("Preferences could not be loaded."))?
            };
            let Ok(mut preferences) = persisted else {
                return Ok(ClearConnectionResult {
                    disconnected: true,
                    durable: false,
                    cleanup_pending: true,
                    warning: Some(ClearWarning::OldStateMayReturn),
                });
            };
            let Some(reference) = preferences.connection.pending_cleanup.clone() else {
                return Ok(ClearConnectionResult {
                    disconnected: true,
                    durable: true,
                    cleanup_pending: false,
                    warning: None,
                });
            };
            if self.delete_credential(&reference).await.is_err() {
                return Ok(ClearConnectionResult {
                    disconnected: true,
                    durable: false,
                    cleanup_pending: true,
                    warning: Some(ClearWarning::CredentialDeleteFailed),
                });
            }
            preferences.connection.pending_cleanup = None;
            let store = self.inner.preferences.clone();
            let persisted = tokio::task::spawn_blocking(move || store.save(&preferences))
                .await
                .map_err(|_| internal_error("Preferences could not be updated."))?;
            if persisted.is_err() {
                return Ok(ClearConnectionResult {
                    disconnected: true,
                    durable: false,
                    cleanup_pending: true,
                    warning: Some(ClearWarning::PreferencesWriteFailed),
                });
            }
            self.set_cleanup_pending(current_generation, false)?;
            return Ok(ClearConnectionResult {
                disconnected: true,
                durable: true,
                cleanup_pending: false,
                warning: None,
            });
        };
        let disabled = self.disable(current_generation, true)?;
        let credential_ref = current_connection.credential_ref().to_owned();
        let persisted = {
            let store = self.inner.preferences.clone();
            tokio::task::spawn_blocking(move || store.load())
                .await
                .map_err(|_| internal_error("Preferences could not be loaded."))?
        };

        let tombstone = match persisted {
            Ok(mut preferences) => {
                preferences.connection.state = ConnectionState::Disconnected;
                preferences.connection.credential_ref = Some(credential_ref.clone());
                preferences.connection.pending_cleanup = Some(credential_ref.clone());
                preferences.connection.pending_save = None;
                preferences.generation = preferences
                    .generation
                    .checked_add(1)
                    .ok_or_else(|| internal_error("Preferences generation overflowed."))?;
                let store = self.inner.preferences.clone();
                tokio::task::spawn_blocking(move || store.save(&preferences))
                    .await
                    .map_err(|_| internal_error("Preferences could not be saved."))?
                    .is_ok()
            }
            Err(_) => false,
        };

        let deleted = self.delete_credential(&credential_ref).await.is_ok();
        if !tombstone {
            // If the tombstone could not be persisted, the old configured
            // preferences remain authoritative on restart. Credential deletion
            // alone cannot make this durable: report the restart risk and keep
            // the in-process cleanup marker set.
            self.set_cleanup_pending(disabled.generation, true)?;
            return Ok(ClearConnectionResult {
                disconnected: true,
                durable: false,
                cleanup_pending: true,
                warning: Some(ClearWarning::OldStateMayReturn),
            });
        }
        if !deleted {
            return Ok(ClearConnectionResult {
                disconnected: true,
                durable: false,
                cleanup_pending: true,
                warning: Some(ClearWarning::CredentialDeleteFailed),
            });
        }

        let final_persist = {
            let store = self.inner.preferences.clone();
            tokio::task::spawn_blocking(move || {
                let mut preferences = store.load()?;
                preferences.connection.pending_cleanup = None;
                store.save(&preferences)
            })
            .await
            .map_err(|_| internal_error("Preferences could not be updated."))?
            .is_ok()
        };
        if !final_persist {
            return Ok(ClearConnectionResult {
                disconnected: true,
                durable: false,
                cleanup_pending: true,
                warning: Some(ClearWarning::PreferencesWriteFailed),
            });
        }
        let settings = self.set_cleanup_pending(disabled.generation, false)?;
        Ok(ClearConnectionResult {
            disconnected: true,
            durable: true,
            cleanup_pending: settings.pending_cleanup,
            warning: None,
        })
    }

    async fn delete_credential(&self, reference: &str) -> Result<(), AppError> {
        let credentials = Arc::clone(&self.inner.credentials);
        let reference = reference.to_owned();
        tokio::task::spawn_blocking(move || credentials.delete(&reference))
            .await
            .map_err(|_| internal_error("The native credential operation failed."))?
            .map_err(CredentialError::app_error)
    }

    fn set_cleanup_pending(
        &self,
        expected_generation: u64,
        pending: bool,
    ) -> Result<PublicSessionSnapshot, AppError> {
        let mut state = self.inner.state.lock().expect("session state lock");
        ensure_current_generation(&state, expected_generation)?;
        state.pending_cleanup = pending;
        Ok(state.public_snapshot())
    }

    fn current_connection(&self) -> Result<(u64, Option<AuthenticatedConnection>), AppError> {
        let state = self.inner.state.lock().expect("session state lock");
        Ok((state.generation, state.connection.clone()))
    }

    /// Copy the private snapshot after validating the caller's generation.
    /// This method performs no await and therefore never holds the state lock
    /// across network I/O.
    #[allow(dead_code)]
    pub(crate) fn authenticated_snapshot(
        &self,
        expected_generation: u64,
    ) -> Result<AuthenticatedConnection, AppError> {
        let state = self.inner.state.lock().expect("session state lock");
        ensure_generation(&state, expected_generation)?;
        state.connection.clone().ok_or_else(|| {
            AppError::new(
                ErrorCode::CredentialMissing,
                "No saved connection is available.",
                false,
            )
        })
    }

    /// Run a service operation with a private snapshot. The lock is released
    /// before the future is created/awaited, and a late result is rejected if
    /// a replacement or disconnect changed the generation meanwhile.
    #[allow(dead_code)]
    pub(crate) async fn with_authenticated_connection<T, F, Fut>(
        &self,
        expected_generation: u64,
        operation: F,
    ) -> Result<T, AppError>
    where
        F: FnOnce(AuthenticatedConnection) -> Fut,
        Fut: Future<Output = Result<T, AppError>>,
    {
        let connection = self.authenticated_snapshot(expected_generation)?;
        let result = operation(connection).await;
        let state = self.inner.state.lock().expect("session state lock");
        ensure_generation(&state, expected_generation)?;
        result
    }

    /// Atomically replace the private in-memory snapshot after B08b has
    /// durably committed the new credential and preferences.
    #[allow(dead_code)]
    pub(crate) fn replace_connection(
        &self,
        expected_generation: u64,
        connection: AuthenticatedConnection,
    ) -> Result<PublicSessionSnapshot, AppError> {
        let mut state = self.inner.state.lock().expect("session state lock");
        ensure_current_generation(&state, expected_generation)?;
        let generation = self.next_generation()?;
        state.generation = generation;
        state.status = SessionStatus::Ready;
        state.canonical_base_url = Some(connection.base_url.as_str().to_owned());
        state.allow_insecure_http = connection.allow_insecure_http;
        state.pending_cleanup = false;
        state.pending_save = false;
        state.credential_status = Some(CredentialStatus::Available);
        state.error_code = None;
        state.connection = Some(connection);
        Ok(state.public_snapshot())
    }

    /// Disable this process immediately. B08c persists the durable marker and
    /// performs deletion separately; no private credential remains afterward.
    #[allow(dead_code)]
    pub(crate) fn disable(
        &self,
        expected_generation: u64,
        cleanup_pending: bool,
    ) -> Result<PublicSessionSnapshot, AppError> {
        let mut state = self.inner.state.lock().expect("session state lock");
        ensure_current_generation(&state, expected_generation)?;
        let generation = self.next_generation()?;
        state.generation = generation;
        state.status = SessionStatus::Unconfigured;
        state.credential_status = None;
        state.error_code = None;
        state.pending_cleanup = cleanup_pending;
        state.pending_save = false;
        state.connection = None;
        Ok(state.public_snapshot())
    }

    fn begin_initializing(&self) -> Result<u64, AppError> {
        let generation = self.next_generation()?;
        let mut state = self.inner.state.lock().expect("session state lock");
        state.generation = generation;
        state.status = SessionStatus::Initializing;
        state.canonical_base_url = None;
        state.credential_status = None;
        state.error_code = None;
        state.allow_insecure_http = false;
        state.pending_cleanup = false;
        state.pending_save = false;
        state.connection = None;
        Ok(generation)
    }

    fn next_generation(&self) -> Result<u64, AppError> {
        self.inner
            .next_generation
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |generation| {
                generation.checked_add(1)
            })
            .map(|previous| previous + 1)
            .map_err(|_| internal_error("Connection generation overflowed."))
    }
}

enum BootstrapLoad {
    PreferencesError(AppError),
    Unconfigured {
        preferences: Preferences,
        pending_cleanup: bool,
    },
    CredentialError {
        preferences: Preferences,
        status: CredentialStatus,
        error: AppError,
    },
    Ready {
        preferences: Preferences,
        token: String,
    },
}

fn load_bootstrap(
    preferences_store: PreferencesStore,
    credentials: Arc<dyn CredentialStore>,
) -> BootstrapLoad {
    let preferences = match preferences_store.load() {
        Ok(preferences) => preferences,
        Err(error) => return BootstrapLoad::PreferencesError(error),
    };
    let preferences =
        recover_pending_operations(&preferences_store, credentials.as_ref(), preferences);

    if preferences.connection.state != ConnectionState::Configured {
        return BootstrapLoad::Unconfigured {
            pending_cleanup: preferences.connection.pending_cleanup.is_some(),
            preferences,
        };
    }

    let reference = preferences
        .connection
        .credential_ref
        .as_deref()
        .expect("configured preferences have a credential reference");
    match credentials.get(reference) {
        Ok(Some(token)) if !token.trim().is_empty() => BootstrapLoad::Ready { preferences, token },
        Ok(Some(_)) | Ok(None) => BootstrapLoad::CredentialError {
            preferences,
            status: CredentialStatus::Missing,
            error: CredentialError::Missing.app_error(),
        },
        Err(error) => BootstrapLoad::CredentialError {
            preferences,
            status: credential_status(error),
            error: error.app_error(),
        },
    }
}

fn recover_pending_operations(
    preferences_store: &PreferencesStore,
    credentials: &dyn CredentialStore,
    mut preferences: Preferences,
) -> Preferences {
    if let Some(pending_save) = preferences.connection.pending_save.clone() {
        if credentials.delete(&pending_save.credential_ref).is_ok() {
            let mut recovered = preferences.clone();
            recovered.connection.pending_save = None;
            if preferences_store.save(&recovered).is_ok() {
                preferences = recovered;
            }
        }
    }

    if let Some(reference) = preferences.connection.pending_cleanup.clone() {
        if credentials.delete(&reference).is_ok() {
            let mut recovered = preferences.clone();
            recovered.connection.pending_cleanup = None;
            if preferences_store.save(&recovered).is_ok() {
                preferences = recovered;
            }
        }
    }
    preferences
}

fn apply_preferences(state: &mut RuntimeState, preferences: &Preferences) {
    state.canonical_base_url = preferences.connection.canonical_base_url.clone();
    state.allow_insecure_http = preferences.connection.allow_insecure_http;
    state.pending_cleanup = preferences.connection.pending_cleanup.is_some();
    state.pending_save = preferences.connection.pending_save.is_some();
    state.display = DisplayPreferences {
        theme: preferences.display.theme.clone(),
        text_scale: preferences.display.text_scale,
    };
}

fn validated_base_url(preferences: &Preferences) -> Result<ValidatedBaseUrl, AppError> {
    let base_url = preferences
        .connection
        .canonical_base_url
        .as_deref()
        .ok_or_else(|| internal_error("Configured preferences have no endpoint."))?;
    crate::validation::validate_base_url(base_url, preferences.connection.allow_insecure_http)
}

fn staged_credential_reference(canonical_base_url: &str, generation: u64) -> String {
    format!(
        "{}-stage-{generation}",
        credential_reference(canonical_base_url)
    )
}

fn credential_status(error: CredentialError) -> CredentialStatus {
    match error {
        CredentialError::Missing => CredentialStatus::Missing,
        CredentialError::Locked => CredentialStatus::Locked,
        CredentialError::Unavailable
        | CredentialError::AccessDenied
        | CredentialError::OperationFailed => CredentialStatus::Unavailable,
    }
}

fn ensure_current_generation(
    state: &RuntimeState,
    expected_generation: u64,
) -> Result<(), AppError> {
    if state.generation != expected_generation {
        return Err(stale_generation());
    }
    Ok(())
}

fn ensure_generation(state: &RuntimeState, expected_generation: u64) -> Result<(), AppError> {
    ensure_current_generation(state, expected_generation)?;
    if state.status != SessionStatus::Ready {
        return Err(AppError::new(
            ErrorCode::CredentialMissing,
            "No saved connection is available.",
            false,
        ));
    }
    Ok(())
}

fn stale_generation() -> AppError {
    AppError::new(
        ErrorCode::StaleGeneration,
        "The connection changed; retry with the current settings.",
        false,
    )
}

fn internal_error(message: &str) -> AppError {
    AppError::new(ErrorCode::InternalError, message, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::AtomicBool;
    use std::sync::mpsc::{self, Receiver};
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::credentials::{CredentialError, FakeCredentialStore};
    use crate::preferences::{
        ConnectionPreferences, DisplayPreferences as StoredDisplayPreferences,
    };

    fn preferences_store() -> PreferencesStore {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        PreferencesStore::new(std::env::temp_dir().join(format!("linkdqueue-session-{suffix}")))
            .expect("absolute preferences store")
    }

    fn configured_preferences(store: &PreferencesStore) {
        let preferences = Preferences {
            schema_version: 1,
            generation: 19,
            connection: ConnectionPreferences {
                state: ConnectionState::Configured,
                canonical_base_url: Some("https://example.invalid/linkding".to_owned()),
                credential_ref: Some("linkdqueue/v1/fixture".to_owned()),
                allow_insecure_http: false,
                pending_cleanup: None,
                pending_save: None,
            },
            display: StoredDisplayPreferences::default(),
        };
        store.save(&preferences).expect("save fixture preferences");
    }

    fn write_raw_preferences(store: &PreferencesStore, raw: &str) {
        fs::create_dir_all(store.path().parent().expect("preferences parent"))
            .expect("create fixture preferences directory");
        fs::write(store.path(), raw).expect("write raw preferences");
    }

    fn ready_service() -> (SessionService, PreferencesStore, FakeCredentialStore) {
        let store = preferences_store();
        configured_preferences(&store);
        let credentials = FakeCredentialStore::default();
        credentials
            .set("linkdqueue/v1/fixture", "fixture-secret")
            .expect("save fixture credential");
        (
            SessionService::new(store.clone(), Arc::new(credentials.clone())),
            store,
            credentials,
        )
    }

    #[tokio::test]
    async fn slow_bootstrap_remains_initializing_until_credential_read_finishes() {
        let store = preferences_store();
        configured_preferences(&store);
        let started = Arc::new(AtomicBool::new(false));
        let (release_sender, release_receiver) = mpsc::channel();
        let credentials = SlowCredentialStore {
            started: Arc::clone(&started),
            release: Arc::new(Mutex::new(Some(release_receiver))),
        };
        let service = SessionService::new(store, Arc::new(credentials));
        let task = tokio::spawn({
            let service = service.clone();
            async move { service.bootstrap().await }
        });
        for _ in 0..100_000 {
            if started.load(Ordering::Acquire) {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert!(started.load(Ordering::Acquire), "credential read started");
        assert_eq!(
            service.public_snapshot().status,
            SessionStatus::Initializing
        );
        release_sender.send(()).expect("release credential read");
        assert_eq!(
            task.await
                .expect("bootstrap task")
                .expect("bootstrap")
                .status,
            SessionStatus::Ready
        );
    }

    #[tokio::test]
    async fn first_boot_is_unconfigured_until_an_atomic_replacement() {
        let store = preferences_store();
        let credentials = FakeCredentialStore::default();
        let service = SessionService::new(store, Arc::new(credentials));
        let unconfigured = service.bootstrap().await.expect("first boot");
        assert_eq!(unconfigured.status, SessionStatus::Unconfigured);
        assert_eq!(unconfigured.generation, 1);
        assert_eq!(
            service
                .authenticated_snapshot(unconfigured.generation)
                .expect_err("first boot has no connection")
                .code,
            ErrorCode::CredentialMissing
        );

        let base_url =
            crate::validation::validate_base_url("https://example.invalid/linkding", false)
                .expect("valid fixture URL");
        let replaced = service
            .replace_connection(
                unconfigured.generation,
                AuthenticatedConnection::new(
                    base_url,
                    "linkdqueue/v1/fixture".to_owned(),
                    "fixture-secret".to_owned(),
                    false,
                ),
            )
            .expect("replace first-boot state");
        assert_eq!(replaced.status, SessionStatus::Ready);
        assert!(replaced.generation > unconfigured.generation);
        assert_eq!(
            service
                .authenticated_snapshot(replaced.generation)
                .expect("replacement is ready")
                .token(),
            "fixture-secret"
        );
    }

    #[tokio::test]
    async fn save_new_retain_and_endpoint_mismatch_are_generation_safe() {
        let store = preferences_store();
        let credentials = FakeCredentialStore::default();
        let service = SessionService::new(store.clone(), Arc::new(credentials.clone()));
        let first = service.bootstrap().await.expect("first boot");
        let saved = service
            .save_connection(SaveConnectionInput {
                base_url: "https://example.invalid/linkding".to_owned(),
                new_token: Some("first-secret".to_owned()),
                retain_existing_token: false,
                allow_insecure_http: false,
            })
            .await
            .expect("save first connection");
        assert_eq!(saved.settings.status, SessionStatus::Ready);
        assert!(saved.settings.generation > first.generation);
        let reference = credential_reference("https://example.invalid/linkding");
        assert_eq!(
            credentials
                .get(&reference)
                .expect("saved credential")
                .as_deref(),
            Some("first-secret")
        );

        let retained = service
            .save_connection(SaveConnectionInput {
                base_url: "https://example.invalid/linkding".to_owned(),
                new_token: None,
                retain_existing_token: true,
                allow_insecure_http: false,
            })
            .await
            .expect("retain existing credential");
        assert!(retained.settings.generation > saved.settings.generation);
        let mismatch = service
            .save_connection(SaveConnectionInput {
                base_url: "https://other.invalid/linkding".to_owned(),
                new_token: None,
                retain_existing_token: true,
                allow_insecure_http: false,
            })
            .await
            .expect_err("different endpoint requires a new token");
        assert_eq!(mismatch.code, ErrorCode::InvalidInput);
        assert_eq!(service.public_snapshot().status, SessionStatus::Ready);
        assert_eq!(
            service.public_snapshot().canonical_base_url.as_deref(),
            Some("https://example.invalid/linkding")
        );
        assert_eq!(
            credentials
                .get(&reference)
                .expect("existing credential")
                .as_deref(),
            Some("first-secret")
        );
        assert!(!fs::read_to_string(store.path())
            .expect("saved preferences")
            .contains("first-secret"));
    }

    #[tokio::test]
    async fn failed_new_credential_write_leaves_previous_state_untouched() {
        let (service, store, credentials) = ready_service();
        let ready = service.bootstrap().await.expect("ready bootstrap");
        credentials.set_failure(Some(CredentialError::OperationFailed));
        let error = service
            .save_connection(SaveConnectionInput {
                base_url: "https://new.invalid/linkding".to_owned(),
                new_token: Some("new-secret".to_owned()),
                retain_existing_token: false,
                allow_insecure_http: false,
            })
            .await
            .expect_err("credential write failure");
        assert_eq!(error.code, ErrorCode::KeyringUnavailable);
        let current = service.public_snapshot();
        assert_eq!(current.status, SessionStatus::Ready);
        assert_eq!(current.generation, ready.generation);
        assert_eq!(
            current.canonical_base_url.as_deref(),
            Some("https://example.invalid/linkding")
        );
        assert!(!fs::read_to_string(store.path())
            .expect("saved preferences")
            .contains("new-secret"));
    }

    #[tokio::test]
    async fn missing_locked_and_corrupt_bootstrap_states_are_explicit_and_redacted() {
        let (service, store, credentials) = ready_service();
        credentials.set_failure(Some(CredentialError::Locked));
        let error = service.bootstrap().await.expect_err("locked store");
        assert_eq!(error.code, ErrorCode::KeyringLocked);
        let snapshot = service.public_snapshot();
        assert_eq!(snapshot.status, SessionStatus::CredentialError);
        assert_eq!(snapshot.credential_status, Some(CredentialStatus::Locked));
        assert!(!format!("{snapshot:?}").contains("fixture-secret"));

        credentials.set_failure(None);
        credentials
            .delete("linkdqueue/v1/fixture")
            .expect("delete fixture");
        let error = service.bootstrap().await.expect_err("missing credential");
        assert_eq!(error.code, ErrorCode::CredentialMissing);
        assert_eq!(
            service.public_snapshot().credential_status,
            Some(CredentialStatus::Missing)
        );

        write_raw_preferences(&store, r#"{"schemaVersion":99}"#);
        let error = service.bootstrap().await.expect_err("future preferences");
        assert_eq!(error.code, ErrorCode::PreferencesCorrupt);
        let snapshot = service.public_snapshot();
        assert_eq!(snapshot.status, SessionStatus::CredentialError);
        assert_eq!(snapshot.error_code, Some(ErrorCode::PreferencesCorrupt));
        assert!(!format!("{snapshot:?}").contains("fixture-secret"));
    }

    #[tokio::test]
    async fn display_preferences_require_current_generation_and_preserve_connection() {
        let (service, store, credentials) = ready_service();
        let ready = service.bootstrap().await.expect("ready bootstrap");
        let updated = service
            .set_display_preferences(SetDisplayPreferencesInput {
                generation: ready.generation,
                theme: "dracula".to_owned(),
                text_scale: 1.5,
            })
            .await
            .expect("display update");
        assert_eq!(updated.display.theme, "dracula");
        assert_eq!(updated.display.text_scale, 1.5);
        let persisted = store.load().expect("load display preferences");
        assert_eq!(persisted.display.theme, "dracula");
        assert_eq!(persisted.connection.state, ConnectionState::Configured);
        assert_eq!(
            credentials.get("linkdqueue/v1/fixture").unwrap(),
            Some("fixture-secret".to_owned())
        );
    }

    #[tokio::test]
    async fn full_replacement_clear_and_restart_sequence_is_consistent() {
        let store = preferences_store();
        let credentials = FakeCredentialStore::default();
        let service = SessionService::new(store.clone(), Arc::new(credentials.clone()));
        let first = service.bootstrap().await.expect("first boot");
        let saved_a = service
            .save_connection(SaveConnectionInput {
                base_url: "https://a.invalid/linkding".to_owned(),
                new_token: Some("token-a".to_owned()),
                retain_existing_token: false,
                allow_insecure_http: false,
            })
            .await
            .expect("save A");
        let saved_b = service
            .save_connection(SaveConnectionInput {
                base_url: "https://b.invalid/linkding".to_owned(),
                new_token: Some("token-b".to_owned()),
                retain_existing_token: false,
                allow_insecure_http: false,
            })
            .await
            .expect("save B");
        assert!(saved_b.settings.generation > saved_a.settings.generation);
        let cleared = service
            .clear_connection(ClearConnectionInput {
                generation: saved_b.settings.generation,
            })
            .await
            .expect("clear B");
        assert!(cleared.durable);
        assert_eq!(
            service.public_snapshot().status,
            SessionStatus::Unconfigured
        );
        assert_eq!(
            credentials
                .get(&credential_reference("https://a.invalid/linkding"))
                .unwrap(),
            None
        );
        assert_eq!(
            credentials
                .get(&credential_reference("https://b.invalid/linkding"))
                .unwrap(),
            None
        );
        let restarted = SessionService::new(store, Arc::new(credentials));
        let after_restart = restarted.bootstrap().await.expect("restart after clear");
        assert_eq!(after_restart.status, SessionStatus::Unconfigured);
        assert_eq!(after_restart.generation, first.generation);
    }

    #[tokio::test]
    async fn concurrent_save_and_clear_cannot_mix_persisted_or_runtime_state() {
        let store = preferences_store();
        let credentials = FakeCredentialStore::default();
        let service = SessionService::new(store, Arc::new(credentials));
        let initial = service.bootstrap().await.expect("first boot");
        let saved = service
            .save_connection(SaveConnectionInput {
                base_url: "https://a.invalid/linkding".to_owned(),
                new_token: Some("token-a".to_owned()),
                retain_existing_token: false,
                allow_insecure_http: false,
            })
            .await
            .expect("save A");
        let (save, clear) = tokio::join!(
            service.save_connection(SaveConnectionInput {
                base_url: "https://b.invalid/linkding".to_owned(),
                new_token: Some("token-b".to_owned()),
                retain_existing_token: false,
                allow_insecure_http: false,
            }),
            service.clear_connection(ClearConnectionInput {
                generation: saved.settings.generation,
            }),
        );
        assert!(save.is_ok());
        assert!(clear.is_ok() || clear.as_ref().unwrap_err().code == ErrorCode::StaleGeneration);
        let snapshot = service.public_snapshot();
        assert!(snapshot.generation > initial.generation);
        if snapshot.status == SessionStatus::Ready {
            let connection = service
                .authenticated_snapshot(snapshot.generation)
                .expect("ready state has a matching credential");
            assert_eq!(connection.base_url().as_str(), "https://b.invalid/linkding");
            assert_eq!(connection.token(), "token-b");
        } else {
            assert_eq!(snapshot.status, SessionStatus::Unconfigured);
        }
    }

    #[tokio::test]
    async fn clear_is_durable_and_does_not_reconnect_after_restart() {
        let (service, store, credentials) = ready_service();
        let ready = service.bootstrap().await.expect("ready bootstrap");
        let cleared = service
            .clear_connection(ClearConnectionInput {
                generation: ready.generation,
            })
            .await
            .expect("clear connection");
        assert_eq!(
            cleared,
            ClearConnectionResult {
                disconnected: true,
                durable: true,
                cleanup_pending: false,
                warning: None,
            }
        );
        assert_eq!(credentials.get("linkdqueue/v1/fixture").unwrap(), None);
        let restarted = SessionService::new(store, Arc::new(credentials));
        assert_eq!(
            restarted
                .bootstrap()
                .await
                .expect("restart bootstrap")
                .status,
            SessionStatus::Unconfigured
        );
    }

    #[tokio::test]
    async fn clear_failure_is_visible_and_recovery_is_idempotent() {
        let store = preferences_store();
        configured_preferences(&store);
        let inner = FakeCredentialStore::default();
        inner
            .set("linkdqueue/v1/fixture", "fixture-secret")
            .expect("save fixture credential");
        let fail_delete = Arc::new(AtomicBool::new(true));
        let credentials = DeleteFailingCredentialStore {
            inner: inner.clone(),
            fail_delete: Arc::clone(&fail_delete),
        };
        let service = SessionService::new(store.clone(), Arc::new(credentials.clone()));
        let ready = service.bootstrap().await.expect("ready bootstrap");
        let failed = service
            .clear_connection(ClearConnectionInput {
                generation: ready.generation,
            })
            .await
            .expect("clear reports partial failure");
        assert_eq!(failed.warning, Some(ClearWarning::CredentialDeleteFailed));
        assert!(!failed.durable);
        assert!(failed.cleanup_pending);
        assert_eq!(
            service.public_snapshot().status,
            SessionStatus::Unconfigured
        );

        let restarted = SessionService::new(store, Arc::new(credentials));
        let pending = restarted.bootstrap().await.expect("pending clear restart");
        assert!(pending.pending_cleanup);
        fail_delete.store(false, Ordering::Release);
        let recovered = restarted
            .clear_connection(ClearConnectionInput {
                generation: pending.generation,
            })
            .await
            .expect("retry clear");
        assert!(recovered.durable);
        assert!(!recovered.cleanup_pending);
        assert_eq!(inner.get("linkdqueue/v1/fixture").unwrap(), None);
    }

    #[tokio::test]
    async fn clear_tombstone_write_failure_is_restart_risk_even_after_credential_delete() {
        let (service, store, credentials) = ready_service();
        let ready = service.bootstrap().await.expect("ready bootstrap");
        store.fail_next_save();

        let result = service
            .clear_connection(ClearConnectionInput {
                generation: ready.generation,
            })
            .await
            .expect("clear reports persistent failure");
        assert_eq!(result.warning, Some(ClearWarning::OldStateMayReturn));
        assert!(!result.durable);
        assert!(result.cleanup_pending);
        assert_eq!(
            service.public_snapshot().status,
            SessionStatus::Unconfigured
        );
        assert_eq!(credentials.get("linkdqueue/v1/fixture").unwrap(), None);

        // The old preferences remain on disk, but the process must not resume
        // the connection after restart with the deleted native credential.
        let restarted = SessionService::new(store, Arc::new(credentials));
        assert_eq!(
            restarted.bootstrap().await.unwrap_err().code,
            ErrorCode::CredentialMissing
        );
        let snapshot = restarted.public_snapshot();
        assert_eq!(snapshot.status, SessionStatus::CredentialError);
        assert!(!snapshot.pending_cleanup);
    }

    #[tokio::test]
    async fn clear_both_persistent_stores_failure_reports_restart_risk_and_reconnects_after_restart(
    ) {
        let store = preferences_store();
        configured_preferences(&store);
        let inner = FakeCredentialStore::default();
        inner
            .set("linkdqueue/v1/fixture", "fixture-secret")
            .expect("save credential");
        let fail_delete = Arc::new(AtomicBool::new(true));
        let credentials = DeleteFailingCredentialStore {
            inner: inner.clone(),
            fail_delete: Arc::clone(&fail_delete),
        };
        let service = SessionService::new(store.clone(), Arc::new(credentials.clone()));
        let ready = service.bootstrap().await.expect("ready bootstrap");
        store.fail_next_save();

        let result = service
            .clear_connection(ClearConnectionInput {
                generation: ready.generation,
            })
            .await
            .expect("clear reports both-store failure");
        assert_eq!(result.warning, Some(ClearWarning::OldStateMayReturn));
        assert!(!result.durable);
        assert!(result.cleanup_pending);
        assert_eq!(
            service.public_snapshot().status,
            SessionStatus::Unconfigured
        );

        let restarted = SessionService::new(store, Arc::new(credentials));
        let snapshot = restarted.bootstrap().await.expect("restart bootstrap");
        assert_eq!(snapshot.status, SessionStatus::Ready);
        assert!(!snapshot.pending_cleanup);
    }

    #[tokio::test]
    async fn committed_replacement_records_cleanup_warning_and_retries_after_restart() {
        let store = preferences_store();
        configured_preferences(&store);
        let inner = FakeCredentialStore::default();
        inner
            .set("linkdqueue/v1/fixture", "fixture-secret")
            .expect("save fixture credential");
        let fail_delete = Arc::new(AtomicBool::new(true));
        let credentials = DeleteFailingCredentialStore {
            inner: inner.clone(),
            fail_delete: Arc::clone(&fail_delete),
        };
        let service = SessionService::new(store.clone(), Arc::new(credentials.clone()));
        service.bootstrap().await.expect("ready bootstrap");

        let saved = service
            .save_connection(SaveConnectionInput {
                base_url: "https://replacement.invalid/linkding".to_owned(),
                new_token: Some("replacement-secret".to_owned()),
                retain_existing_token: false,
                allow_insecure_http: false,
            })
            .await
            .expect("replacement is committed despite cleanup failure");
        assert_eq!(saved.warning, Some(SaveWarning::OldCredentialCleanupFailed));
        assert!(saved.settings.pending_cleanup);
        assert_eq!(
            inner
                .get("linkdqueue/v1/fixture")
                .expect("old credential remains")
                .as_deref(),
            Some("fixture-secret")
        );

        fail_delete.store(false, Ordering::Release);
        let restarted = SessionService::new(store.clone(), Arc::new(credentials));
        let recovered = restarted.bootstrap().await.expect("replacement restarts");
        assert_eq!(recovered.status, SessionStatus::Ready);
        assert!(!recovered.pending_cleanup);
        assert_eq!(
            inner
                .get("linkdqueue/v1/fixture")
                .expect("old credential cleanup")
                .as_deref(),
            None
        );
    }

    #[tokio::test]
    async fn staged_replacement_is_removed_after_crash_before_final_commit() {
        let store = preferences_store();
        let mut preferences = Preferences::first_boot();
        let staged_ref = "linkdqueue/v1/staged-crash-reference".to_owned();
        preferences.connection.pending_save = Some(PendingSave {
            canonical_base_url: "https://replacement.invalid/linkding".to_owned(),
            credential_ref: staged_ref.clone(),
            allow_insecure_http: false,
        });
        store
            .save(&preferences)
            .expect("persist pending save journal");
        let credentials = FakeCredentialStore::default();
        credentials
            .set(&staged_ref, "staged-secret")
            .expect("stage credential");
        let service = SessionService::new(store.clone(), Arc::new(credentials.clone()));

        let recovered = service.bootstrap().await.expect("recover first boot");
        assert_eq!(recovered.status, SessionStatus::Unconfigured);
        assert!(!recovered.pending_cleanup);
        assert_eq!(credentials.get(&staged_ref).expect("staged lookup"), None);
        assert!(store
            .load()
            .expect("load recovered preferences")
            .connection
            .pending_save
            .is_none());
    }

    #[tokio::test]
    async fn generation_is_process_local_and_old_requests_are_rejected_before_operation() {
        let (service, store, _credentials) = ready_service();
        let ready = service.bootstrap().await.expect("ready bootstrap");
        let old_generation = ready.generation;
        let operation_started = Arc::new(AtomicBool::new(false));
        let operation_started_by_future = Arc::clone(&operation_started);
        let (release_sender, release_receiver) = tokio::sync::oneshot::channel();
        let task = tokio::spawn({
            let service = service.clone();
            async move {
                service
                    .with_authenticated_connection(old_generation, move |connection| async move {
                        assert_eq!(connection.token(), "fixture-secret");
                        operation_started_by_future.store(true, Ordering::Release);
                        release_receiver.await.expect("release operation");
                        Ok::<_, AppError>(())
                    })
                    .await
            }
        });
        for _ in 0..10_000 {
            if operation_started.load(Ordering::Acquire) {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert!(
            operation_started.load(Ordering::Acquire),
            "operation started"
        );
        let disabled = service
            .disable(old_generation, false)
            .expect("disable session");
        assert!(disabled.generation > old_generation);
        release_sender.send(()).expect("release operation");
        assert_eq!(
            task.await
                .expect("operation task")
                .expect_err("late result")
                .code,
            ErrorCode::StaleGeneration
        );
        assert_eq!(
            service
                .authenticated_snapshot(old_generation)
                .expect_err("stale request")
                .code,
            ErrorCode::StaleGeneration
        );
        assert_eq!(
            service.public_snapshot().status,
            SessionStatus::Unconfigured
        );
        assert!(!format!("{service:?}").contains("fixture-secret"));
        drop(store);
    }

    #[derive(Clone)]
    struct DeleteFailingCredentialStore {
        inner: FakeCredentialStore,
        fail_delete: Arc<AtomicBool>,
    }

    impl CredentialStore for DeleteFailingCredentialStore {
        fn get(&self, reference: &str) -> Result<Option<String>, CredentialError> {
            self.inner.get(reference)
        }

        fn set(&self, reference: &str, token: &str) -> Result<(), CredentialError> {
            self.inner.set(reference, token)
        }

        fn delete(&self, reference: &str) -> Result<(), CredentialError> {
            if self.fail_delete.load(Ordering::Acquire) {
                Err(CredentialError::OperationFailed)
            } else {
                self.inner.delete(reference)
            }
        }
    }

    #[derive(Clone)]
    struct SlowCredentialStore {
        started: Arc<AtomicBool>,
        release: Arc<Mutex<Option<Receiver<()>>>>,
    }

    impl CredentialStore for SlowCredentialStore {
        fn get(&self, _reference: &str) -> Result<Option<String>, CredentialError> {
            self.started.store(true, Ordering::Release);
            self.release
                .lock()
                .expect("release lock")
                .take()
                .expect("single credential read")
                .recv()
                .expect("release credential read");
            Ok(Some("fixture-secret".to_owned()))
        }

        fn set(&self, _reference: &str, _token: &str) -> Result<(), CredentialError> {
            Ok(())
        }

        fn delete(&self, _reference: &str) -> Result<(), CredentialError> {
            Ok(())
        }
    }
}
