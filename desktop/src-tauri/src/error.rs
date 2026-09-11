use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidInput,
    InvalidBaseUrl,
    InsecureHttp,
    PreferencesCorrupt,
    PreferencesWriteFailed,
    KeyringUnavailable,
    KeyringLocked,
    CredentialMissing,
    CredentialDeleteFailed,
    AuthFailed,
    PermissionDenied,
    NotFound,
    BadRequest,
    RateLimited,
    ServerError,
    NetworkError,
    TimeoutUnknownOutcome,
    StaleGeneration,
    ExternalUrlRejected,
    InternalError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
            status: None,
        }
    }

    pub fn with_status(mut self, status: u16) -> Self {
        self.status = Some(status);
        self
    }

    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidInput, message, false)
    }

    pub fn protocol_error() -> Self {
        Self::new(ErrorCode::InvalidInput, "Invalid Linkding response.", false)
    }

    pub fn auth_failed(status: u16) -> Self {
        Self::new(
            ErrorCode::AuthFailed,
            "Linkding authentication failed.",
            false,
        )
        .with_status(status)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_serialize_without_sensitive_response_details() {
        let error = AppError::auth_failed(401);
        let json = serde_json::to_string(&error).expect("serialize safe error");
        assert!(json.contains("auth_failed"));
        assert!(!json.contains("Authorization"));
        assert!(!json.contains("Token"));
    }
}
