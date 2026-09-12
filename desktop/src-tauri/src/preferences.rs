//! Atomic persistence for non-secret desktop preferences.
//!
//! The document intentionally has no field capable of holding a token. Tokens
//! belong to the native credential store implemented by B04.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, ErrorCode};
use crate::validation::validate_base_url;

const SCHEMA_VERSION: u8 = 1;
const PREFERENCES_FILE: &str = "preferences.json";
const MAX_CREDENTIAL_REFERENCE_LENGTH: usize = 256;
const THEMES: &[&str] = &[
    "system",
    "catppuccinMocha",
    "catppuccinLatte",
    "dracula",
    "tokyoNight",
    "tokyoDay",
    "gruvbox",
    "oneDark",
];
const TEXT_SCALES: &[f64] = &[0.85, 1.0, 1.25, 1.5, 1.75, 2.0];
static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub schema_version: u8,
    pub generation: u64,
    pub connection: ConnectionPreferences,
    pub display: DisplayPreferences,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionPreferences {
    pub state: ConnectionState,
    pub canonical_base_url: Option<String>,
    pub credential_ref: Option<String>,
    pub allow_insecure_http: bool,
    pub pending_cleanup: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_save: Option<PendingSave>,
}

/// A non-secret journal entry for a credential replacement that has not yet
/// committed its new connection. The staged reference is deleted during the
/// next bootstrap if the process dies between staging and the final commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct PendingSave {
    pub canonical_base_url: String,
    pub credential_ref: String,
    pub allow_insecure_http: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    FirstBoot,
    Configured,
    Disconnected,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub struct DisplayPreferences {
    pub theme: String,
    pub text_scale: f64,
}

impl Preferences {
    pub fn first_boot() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            generation: 0,
            connection: ConnectionPreferences {
                state: ConnectionState::FirstBoot,
                canonical_base_url: None,
                credential_ref: None,
                allow_insecure_http: false,
                pending_cleanup: None,
                pending_save: None,
            },
            display: DisplayPreferences::default(),
        }
    }

    pub fn validate(&self) -> Result<(), AppError> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(corrupt("This preferences version is not supported."));
        }
        validate_display(&self.display)?;
        validate_connection(&self.connection)?;
        Ok(())
    }

    fn normalized_for_storage(&self) -> Result<Self, AppError> {
        self.validate()?;
        let mut normalized = self.clone();
        if let Some(base_url) = &self.connection.canonical_base_url {
            let parsed = validate_base_url(base_url, self.connection.allow_insecure_http)?;
            normalized.connection.canonical_base_url = Some(parsed.as_str().to_owned());
        }
        normalized.validate()?;
        Ok(normalized)
    }
}

impl Default for DisplayPreferences {
    fn default() -> Self {
        Self {
            theme: "system".to_owned(),
            text_scale: 1.0,
        }
    }
}

impl ConnectionPreferences {
    pub fn first_boot() -> Self {
        Preferences::first_boot().connection
    }
}

/// A store rooted at the Tauri app-config directory. Relative paths are
/// refused so a caller cannot accidentally persist beside the process cwd.
#[derive(Debug, Clone)]
pub struct PreferencesStore {
    config_dir: PathBuf,
}

impl PreferencesStore {
    pub fn new(config_dir: impl AsRef<Path>) -> Result<Self, AppError> {
        let config_dir = config_dir.as_ref();
        if !config_dir.is_absolute() {
            return Err(AppError::new(
                ErrorCode::PreferencesWriteFailed,
                "The preferences directory must be an absolute app-config path.",
                false,
            ));
        }
        Ok(Self {
            config_dir: config_dir.to_owned(),
        })
    }

    pub fn path(&self) -> PathBuf {
        self.config_dir.join(PREFERENCES_FILE)
    }

    pub fn load(&self) -> Result<Preferences, AppError> {
        let path = self.path();
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(Preferences::first_boot());
            }
            Err(_) => return Err(corrupt("The preferences file could not be read.")),
        };
        let preferences: Preferences = serde_json::from_slice(&bytes)
            .map_err(|_| corrupt("The preferences file is corrupt or unsupported."))?;
        preferences.validate()?;

        // Stored documents are required to already be canonical. This keeps
        // endpoint identity stable when deciding whether a credential matches.
        if let Some(base_url) = &preferences.connection.canonical_base_url {
            let canonical =
                validate_base_url(base_url, preferences.connection.allow_insecure_http)?;
            if canonical.as_str() != base_url {
                return Err(corrupt("The stored base URL is not canonical."));
            }
        }
        Ok(preferences)
    }

    pub fn save(&self, preferences: &Preferences) -> Result<(), AppError> {
        let preferences = preferences.normalized_for_storage()?;
        let bytes = serde_json::to_vec_pretty(&preferences).map_err(|_| {
            AppError::new(
                ErrorCode::PreferencesWriteFailed,
                "Preferences could not be serialized.",
                false,
            )
        })?;
        fs::create_dir_all(&self.config_dir).map_err(|_| write_failed())?;

        let temp_path = self.temp_path();
        let write_result = write_temp_file(&temp_path, &bytes)
            .and_then(|()| atomic_replace(&temp_path, &self.path()))
            .and_then(|()| sync_directory(&self.config_dir));
        let cleanup_result = fs::remove_file(&temp_path);
        match write_result {
            Ok(()) => Ok(()),
            Err(_) => {
                let _ = cleanup_result;
                Err(write_failed())
            }
        }
    }

    /// Update only display fields, retaining the connection and generation.
    pub fn update_display(
        &self,
        theme: impl Into<String>,
        text_scale: f64,
    ) -> Result<Preferences, AppError> {
        let mut preferences = self.load()?;
        preferences.display = DisplayPreferences {
            theme: theme.into(),
            text_scale,
        };
        self.save(&preferences)?;
        preferences = self.load()?;
        Ok(preferences)
    }

    fn temp_path(&self) -> PathBuf {
        let sequence = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        self.config_dir.join(format!(
            ".{PREFERENCES_FILE}.{}.{}.tmp",
            std::process::id(),
            sequence
        ))
    }
}

fn validate_connection(connection: &ConnectionPreferences) -> Result<(), AppError> {
    if let Some(base_url) = &connection.canonical_base_url {
        validate_base_url(base_url, connection.allow_insecure_http)
            .map_err(|_| corrupt("The stored base URL is invalid."))?;
    } else if connection.allow_insecure_http {
        return Err(corrupt("HTTP consent cannot exist without a base URL."));
    }
    if let Some(reference) = &connection.credential_ref {
        validate_credential_reference(reference)?;
    }
    if let Some(reference) = &connection.pending_cleanup {
        validate_credential_reference(reference)?;
    }
    if let Some(pending_save) = &connection.pending_save {
        validate_base_url(
            &pending_save.canonical_base_url,
            pending_save.allow_insecure_http,
        )
        .map_err(|_| corrupt("The pending save endpoint is invalid."))?;
        validate_credential_reference(&pending_save.credential_ref)?;
        if connection.credential_ref.as_deref() == Some(pending_save.credential_ref.as_str()) {
            return Err(corrupt(
                "A pending save cannot replace the active credential.",
            ));
        }
    }

    match connection.state {
        ConnectionState::FirstBoot => {
            if connection.canonical_base_url.is_some()
                || connection.credential_ref.is_some()
                || connection.pending_cleanup.is_some()
                || connection.allow_insecure_http
            {
                return Err(corrupt("First-boot preferences contain connection state."));
            }
        }
        ConnectionState::Configured => {
            if connection.canonical_base_url.is_none()
                || connection.credential_ref.is_none()
                || (connection.pending_cleanup.is_some()
                    && connection.pending_cleanup == connection.credential_ref)
                || (connection.pending_cleanup.is_some() && connection.pending_save.is_some())
            {
                return Err(corrupt("Configured preferences are incomplete."));
            }
        }
        ConnectionState::Disconnected => {
            if connection.pending_save.is_some() {
                return Err(corrupt("Disconnected preferences contain a pending save."));
            }
            if connection.pending_cleanup.is_some() && connection.credential_ref.is_none() {
                return Err(corrupt(
                    "Pending credential cleanup has no credential reference.",
                ));
            }
        }
    }
    Ok(())
}

fn validate_display(display: &DisplayPreferences) -> Result<(), AppError> {
    if !THEMES.contains(&display.theme.as_str()) || !TEXT_SCALES.contains(&display.text_scale) {
        return Err(corrupt("The saved display preferences are unsupported."));
    }
    Ok(())
}

fn validate_credential_reference(reference: &str) -> Result<(), AppError> {
    if reference.len() > MAX_CREDENTIAL_REFERENCE_LENGTH
        || !reference.starts_with("linkdqueue/v1/")
        || reference["linkdqueue/v1/".len()..].is_empty()
        || !reference.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '/' | '-' | '_')
        })
    {
        return Err(corrupt("The saved credential reference is invalid."));
    }
    Ok(())
}

fn corrupt(message: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::PreferencesCorrupt, message, false)
}

fn write_failed() -> AppError {
    AppError::new(
        ErrorCode::PreferencesWriteFailed,
        "Preferences could not be saved; the previous file was retained.",
        true,
    )
}

fn write_temp_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    restrict_permissions(&file)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(unix)]
fn restrict_permissions(file: &File) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    file.set_permissions(fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn restrict_permissions(_file: &File) -> io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn atomic_replace(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

#[cfg(windows)]
fn atomic_replace(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: both buffers are NUL-terminated and remain alive for the call.
    if unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(any(unix, windows)))]
fn atomic_replace(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> io::Result<()> {
    File::open(path)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn store() -> PreferencesStore {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        PreferencesStore::new(std::env::temp_dir().join(format!("linkdqueue-preferences-{suffix}")))
            .expect("absolute preferences store")
    }

    fn configured() -> Preferences {
        Preferences {
            schema_version: SCHEMA_VERSION,
            generation: 7,
            connection: ConnectionPreferences {
                state: ConnectionState::Configured,
                canonical_base_url: Some("https://example.invalid/linkding/".to_owned()),
                credential_ref: Some("linkdqueue/v1/test-reference".to_owned()),
                allow_insecure_http: false,
                pending_cleanup: None,
                pending_save: None,
            },
            display: DisplayPreferences::default(),
        }
    }

    #[test]
    fn missing_store_is_first_boot_and_round_trip_normalizes_endpoint() {
        let store = store();
        assert_eq!(store.load().expect("first boot"), Preferences::first_boot());
        store.save(&configured()).expect("save preferences");
        let loaded = store.load().expect("load preferences");
        assert_eq!(
            loaded.connection.canonical_base_url.as_deref(),
            Some("https://example.invalid/linkding")
        );
        let file = fs::read_to_string(store.path()).expect("read preferences document");
        assert!(!file.contains("token"));
        assert!(file.contains("schemaVersion"));
        assert!(file.contains("canonicalBaseUrl"));
        assert!(!file.contains("canonical_base_url"));
    }

    #[test]
    fn all_display_values_are_accepted_and_invalid_values_fail_closed() {
        let store = store();
        for theme in THEMES {
            for scale in TEXT_SCALES {
                let mut preferences = configured();
                preferences.display = DisplayPreferences {
                    theme: (*theme).to_owned(),
                    text_scale: *scale,
                };
                store.save(&preferences).expect("valid display preferences");
            }
        }
        let mut invalid = configured();
        invalid.display.theme = "unknown".to_owned();
        assert_eq!(
            invalid.validate().expect_err("unknown theme").code,
            ErrorCode::PreferencesCorrupt
        );
        invalid = configured();
        invalid.display.text_scale = 1.1;
        assert_eq!(
            invalid.validate().expect_err("unknown scale").code,
            ErrorCode::PreferencesCorrupt
        );
    }

    #[test]
    fn unknown_schema_and_corrupt_json_are_not_overwritten() {
        let store = store();
        fs::create_dir_all(&store.config_dir).expect("create config dir");
        let original = br#"{"schemaVersion":99,"generation":1,"connection":{},"display":{}}"#;
        fs::write(store.path(), original).expect("write corrupt preferences");
        assert_eq!(
            store.load().expect_err("future schema").code,
            ErrorCode::PreferencesCorrupt
        );
        assert_eq!(
            fs::read(store.path()).expect("preserved original"),
            original
        );

        fs::write(store.path(), b"not json").expect("write malformed preferences");
        assert_eq!(
            store.load().expect_err("malformed JSON").code,
            ErrorCode::PreferencesCorrupt
        );
        assert_eq!(
            fs::read(store.path()).expect("preserved malformed file"),
            b"not json"
        );
    }

    #[test]
    fn display_update_preserves_connection_and_generation() {
        let store = store();
        store.save(&configured()).expect("save preferences");
        let updated = store
            .update_display("dracula", 1.5)
            .expect("update display");
        assert_eq!(updated.generation, 7);
        assert_eq!(updated.connection.state, ConnectionState::Configured);
        assert_eq!(
            updated.connection.canonical_base_url.as_deref(),
            Some("https://example.invalid/linkding")
        );
        assert_eq!(
            updated.connection.credential_ref.as_deref(),
            Some("linkdqueue/v1/test-reference")
        );
        assert_eq!(updated.display.theme, "dracula");
        assert_eq!(updated.display.text_scale, 1.5);
    }

    #[test]
    fn relative_roots_and_incomplete_connections_are_rejected() {
        assert!(PreferencesStore::new("relative-config").is_err());
        let mut preferences = configured();
        preferences.connection.credential_ref = None;
        assert!(preferences.validate().is_err());
        preferences = configured();
        preferences.connection.state = ConnectionState::FirstBoot;
        assert!(preferences.validate().is_err());
    }
}
