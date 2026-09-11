//! Native credential storage boundary.
//!
//! This module deliberately exposes blocking operations. Callers running on a
//! Tauri async command executor must dispatch them to a blocking worker before
//! awaiting the result; no filesystem or in-memory fallback is provided.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use keyring::{Entry, Error as KeyringError};
use sha2::{Digest, Sha256};

use crate::error::{AppError, ErrorCode};

pub const KEYRING_SERVICE: &str = "com.feoh.linkdqueue.desktop.v1";
const REFERENCE_PREFIX: &str = "linkdqueue/v1/";
const BASE32_ALPHABET: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialError {
    Missing,
    Unavailable,
    Locked,
    AccessDenied,
    OperationFailed,
}

impl CredentialError {
    pub fn app_error(self) -> AppError {
        let (code, message, retryable) = match self {
            Self::Missing => (
                ErrorCode::CredentialMissing,
                "The saved Linkding credential is missing.",
                false,
            ),
            Self::Unavailable => (
                ErrorCode::KeyringUnavailable,
                "The native credential store is unavailable.",
                true,
            ),
            Self::Locked => (
                ErrorCode::KeyringLocked,
                "The native credential store is locked.",
                true,
            ),
            Self::AccessDenied => (
                ErrorCode::KeyringUnavailable,
                "Access to the native credential store was denied.",
                false,
            ),
            Self::OperationFailed => (
                ErrorCode::KeyringUnavailable,
                "The native credential operation failed.",
                true,
            ),
        };
        AppError::new(code, message, retryable)
    }
}

/// The trait is synchronous because all supported keyring APIs are blocking.
/// Implementors must never put the token in an error, log, or diagnostic.
pub trait CredentialStore: Send + Sync {
    fn get(&self, reference: &str) -> Result<Option<String>, CredentialError>;
    fn set(&self, reference: &str, token: &str) -> Result<(), CredentialError>;
    fn delete(&self, reference: &str) -> Result<(), CredentialError>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct NativeCredentialStore;

impl NativeCredentialStore {
    pub fn new() -> Self {
        Self
    }

    fn entry(&self, reference: &str) -> Result<Entry, CredentialError> {
        validate_reference(reference)?;
        Entry::new(KEYRING_SERVICE, reference).map_err(map_keyring_error)
    }
}

impl CredentialStore for NativeCredentialStore {
    fn get(&self, reference: &str) -> Result<Option<String>, CredentialError> {
        match self.entry(reference)?.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(error) => Err(map_keyring_error(error)),
        }
    }

    fn set(&self, reference: &str, token: &str) -> Result<(), CredentialError> {
        if token.trim().is_empty() || token.chars().any(char::is_control) {
            return Err(CredentialError::OperationFailed);
        }
        self.entry(reference)?
            .set_password(token.trim())
            .map_err(map_keyring_error)
    }

    fn delete(&self, reference: &str) -> Result<(), CredentialError> {
        match self.entry(reference)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(map_keyring_error(error)),
        }
    }
}

/// Derive the account name used inside the isolated application namespace.
/// `canonical_base_url` must already have passed URL canonicalization.
pub fn credential_reference(canonical_base_url: &str) -> String {
    let digest = Sha256::digest(canonical_base_url.as_bytes());
    format!("{REFERENCE_PREFIX}{}", encode_base32(&digest))
}

fn encode_base32(bytes: &[u8]) -> String {
    let mut result = String::with_capacity((bytes.len() * 8).div_ceil(5));
    let mut buffer = 0u16;
    let mut bits = 0u8;
    for byte in bytes {
        buffer = (buffer << 8) | u16::from(*byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            result.push(BASE32_ALPHABET[usize::from((buffer >> bits) & 0x1f)] as char);
        }
        // Retain only the not-yet-emitted low bits before shifting in the
        // next byte; otherwise the small accumulator would overflow.
        buffer &= (1u16 << bits).saturating_sub(1);
    }
    if bits > 0 {
        result.push(BASE32_ALPHABET[usize::from((buffer << (5 - bits)) & 0x1f)] as char);
    }
    result
}

fn validate_reference(reference: &str) -> Result<(), CredentialError> {
    if !reference.starts_with(REFERENCE_PREFIX)
        || reference[REFERENCE_PREFIX.len()..].is_empty()
        || !reference.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '/' | '-' | '_')
        })
    {
        return Err(CredentialError::OperationFailed);
    }
    Ok(())
}

fn map_keyring_error(error: KeyringError) -> CredentialError {
    match error {
        KeyringError::NoEntry => CredentialError::Missing,
        KeyringError::NoStorageAccess(_) => CredentialError::Locked,
        KeyringError::PlatformFailure(_) => CredentialError::Unavailable,
        KeyringError::BadEncoding(_)
        | KeyringError::TooLong(_, _)
        | KeyringError::Invalid(_, _)
        | KeyringError::Ambiguous(_) => CredentialError::OperationFailed,
        _ => CredentialError::OperationFailed,
    }
}

/// A deterministic fake for unit tests. Its stored values are private and are
/// never included in `Debug` output or errors.
#[derive(Clone, Default)]
pub struct FakeCredentialStore {
    entries: Arc<Mutex<HashMap<String, String>>>,
    failure: Arc<Mutex<Option<CredentialError>>>,
}

impl FakeCredentialStore {
    pub fn set_failure(&self, failure: Option<CredentialError>) {
        *self.failure.lock().expect("fake credential lock") = failure;
    }

    fn configured_failure(&self) -> Option<CredentialError> {
        *self.failure.lock().expect("fake credential lock")
    }
}

impl CredentialStore for FakeCredentialStore {
    fn get(&self, reference: &str) -> Result<Option<String>, CredentialError> {
        if let Some(failure) = self.configured_failure() {
            return Err(failure);
        }
        Ok(self
            .entries
            .lock()
            .expect("fake credential lock")
            .get(reference)
            .cloned())
    }

    fn set(&self, reference: &str, token: &str) -> Result<(), CredentialError> {
        if let Some(failure) = self.configured_failure() {
            return Err(failure);
        }
        if token.trim().is_empty() || token.chars().any(char::is_control) {
            return Err(CredentialError::OperationFailed);
        }
        self.entries
            .lock()
            .expect("fake credential lock")
            .insert(reference.to_owned(), token.trim().to_owned());
        Ok(())
    }

    fn delete(&self, reference: &str) -> Result<(), CredentialError> {
        if let Some(failure) = self.configured_failure() {
            return Err(failure);
        }
        self.entries
            .lock()
            .expect("fake credential lock")
            .remove(reference);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const REFERENCE: &str = "linkdqueue/v1/fixture-reference";

    #[test]
    fn fake_store_supports_create_replace_read_delete_and_missing() {
        let store = FakeCredentialStore::default();
        assert_eq!(store.get(REFERENCE).expect("missing is readable"), None);
        store
            .set(REFERENCE, " first-secret ")
            .expect("create credential");
        assert_eq!(
            store.get(REFERENCE).expect("read credential").as_deref(),
            Some("first-secret")
        );
        store
            .set(REFERENCE, "second-secret")
            .expect("replace credential");
        assert_eq!(
            store.get(REFERENCE).expect("read replacement").as_deref(),
            Some("second-secret")
        );
        store.delete(REFERENCE).expect("delete credential");
        assert_eq!(store.get(REFERENCE).expect("missing after delete"), None);
        store.delete(REFERENCE).expect("delete is idempotent");
    }

    #[test]
    fn fake_store_maps_locked_and_denied_failures_without_secret_details() {
        let store = FakeCredentialStore::default();
        for failure in [CredentialError::Locked, CredentialError::AccessDenied] {
            store.set_failure(Some(failure));
            let error = store.get(REFERENCE).expect_err("configured failure");
            let rendered = format!("{:?}", error);
            assert!(!rendered.contains("secret"));
            assert_eq!(error, failure);
        }
    }

    #[test]
    fn native_store_rejects_unscoped_references_and_invalid_tokens() {
        let store = NativeCredentialStore::new();
        assert_eq!(
            store
                .get("https://example.invalid")
                .expect_err("URL is not an account ref"),
            CredentialError::OperationFailed
        );
        assert_eq!(
            store.set(REFERENCE, "\n").expect_err("empty token"),
            CredentialError::OperationFailed
        );
    }

    #[test]
    fn references_are_stable_scoped_and_do_not_include_endpoint_text() {
        let reference = credential_reference("https://example.invalid/linkdqueue");
        assert_eq!(
            reference,
            "linkdqueue/v1/amsfz7yionoosqkw3p2hajqdjm3w5ylzi54ohexubpgy5vzbjgqq"
        );
        assert_eq!(reference.len(), REFERENCE_PREFIX.len() + 52);
        assert!(!reference.contains("example.invalid"));
        assert_eq!(
            reference,
            credential_reference("https://example.invalid/linkdqueue")
        );
        assert_ne!(
            reference,
            credential_reference("https://example.invalid/other")
        );
    }

    #[test]
    fn errors_are_safe_for_ipc() {
        let error = CredentialError::Unavailable.app_error();
        assert_eq!(error.code, ErrorCode::KeyringUnavailable);
        let rendered = serde_json::to_string(&error).expect("serialize safe error");
        assert!(!rendered.contains("secret"));
        assert!(!rendered.contains("Token"));
    }
}
