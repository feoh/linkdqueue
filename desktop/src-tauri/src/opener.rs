//! Safe hand-off of bookmark URLs to the user's external browser.
//!
//! URL validation happens before the native opener is called. The renderer
//! cannot select an executable, pass a shell fragment, or navigate the Tauri
//! webview to untrusted content.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, ErrorCode};
use crate::validation::validate_http_url;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenExternalUrlInput {
    pub generation: u64,
    pub url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExternalOpenError;

pub trait ExternalOpener: Send + Sync {
    fn open(&self, url: &str) -> Result<(), ExternalOpenError>;
}

#[derive(Debug, Default)]
pub struct NativeExternalOpener;

impl ExternalOpener for NativeExternalOpener {
    fn open(&self, url: &str) -> Result<(), ExternalOpenError> {
        tauri_plugin_opener::open_url(url, None::<&str>).map_err(|_| ExternalOpenError)
    }
}

/// Validate and open one URL through an injected native opener.
///
/// Keeping the opener behind a trait makes the security boundary testable
/// without launching a browser or depending on a particular desktop session.
pub fn open_external_url_with<O: ExternalOpener>(
    opener: &O,
    input: OpenExternalUrlInput,
) -> Result<(), AppError> {
    let url = validate_http_url(&input.url)?;
    opener.open(url.as_str()).map_err(|_| {
        AppError::new(
            ErrorCode::InternalError,
            "The external browser could not open this URL.",
            true,
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeOpener {
        opened: Mutex<Vec<String>>,
        fail: AtomicBool,
    }

    impl ExternalOpener for FakeOpener {
        fn open(&self, url: &str) -> Result<(), ExternalOpenError> {
            if self.fail.load(Ordering::Acquire) {
                return Err(ExternalOpenError);
            }
            self.opened
                .lock()
                .expect("fake opener lock")
                .push(url.into());
            Ok(())
        }
    }

    fn input(url: &str) -> OpenExternalUrlInput {
        OpenExternalUrlInput {
            generation: 7,
            url: url.to_owned(),
        }
    }

    #[test]
    fn opens_valid_web_urls_once_and_preserves_components() {
        let opener = FakeOpener::default();
        open_external_url_with(
            &opener,
            input("https://bookmark.invalid/article?q=rust#reading"),
        )
        .expect("valid URL opens");
        assert_eq!(
            opener.opened.lock().expect("fake opener lock").as_slice(),
            ["https://bookmark.invalid/article?q=rust#reading"]
        );
    }

    #[test]
    fn rejects_non_web_schemes_and_credentials_without_opening() {
        let opener = FakeOpener::default();
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,hello",
            "custom://bookmark.invalid/article",
            "https://user:password@bookmark.invalid/article",
        ] {
            let error = open_external_url_with(&opener, input(url)).expect_err("unsafe URL");
            assert_eq!(error.code, ErrorCode::ExternalUrlRejected);
        }
        assert!(opener.opened.lock().expect("fake opener lock").is_empty());
    }

    #[test]
    fn native_failure_reaches_the_caller_without_revealing_platform_details() {
        let opener = FakeOpener {
            fail: AtomicBool::new(true),
            ..Default::default()
        };
        let error = open_external_url_with(&opener, input("https://bookmark.invalid/article"))
            .expect_err("native opener failure");
        assert_eq!(error.code, ErrorCode::InternalError);
        assert!(error.retryable);
        assert_eq!(
            error.message,
            "The external browser could not open this URL."
        );
    }
}
