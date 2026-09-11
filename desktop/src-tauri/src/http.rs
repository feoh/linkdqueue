//! Restricted Linkding HTTP transport.
//!
//! Only typed operations in this module can issue requests. The renderer never
//! supplies a URL, header, method, or redirect target.

use std::time::Duration;

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, RETRY_AFTER};
use reqwest::{Client, Response, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::domain::{Bookmark, ListBookmarksInput, ListTagsInput, Page, Tag};
use crate::error::{AppError, ErrorCode};
use crate::validation::{
    build_bookmark_url, build_bookmarks_url, build_profile_url, build_tags_url, validate_token,
};

const MAX_RESPONSE_BYTES: usize = 5 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

pub struct LinkdingHttpTransport {
    client: Client,
    base_url: crate::validation::ValidatedBaseUrl,
    token: String,
}

impl LinkdingHttpTransport {
    pub fn new(
        base_url: crate::validation::ValidatedBaseUrl,
        token: &str,
    ) -> Result<Self, AppError> {
        let token = validate_token(token)?;
        let client = Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| {
                AppError::new(
                    ErrorCode::InternalError,
                    "HTTP transport is unavailable.",
                    false,
                )
            })?;
        Ok(Self {
            client,
            base_url,
            token,
        })
    }

    pub async fn get_profile(&self) -> Result<Value, AppError> {
        let url = build_profile_url(&self.base_url)?;
        let response = self
            .authorized_get(url)
            .send()
            .await
            .map_err(|error| map_request_error(error, false))?;
        decode_json(response, StatusCode::OK).await
    }

    pub async fn list_bookmarks(
        &self,
        input: &ListBookmarksInput,
    ) -> Result<Page<Bookmark>, AppError> {
        input.validate()?;
        let url = build_bookmarks_url(
            &self.base_url,
            input.scope,
            input.query.as_deref(),
            input.tag.as_deref(),
            input.offset,
            input.limit,
        )?;
        let response = self
            .authorized_get(url)
            .send()
            .await
            .map_err(|error| map_request_error(error, false))?;
        decode_json(response, StatusCode::OK).await
    }

    pub async fn list_tags(&self, input: &ListTagsInput) -> Result<Page<Tag>, AppError> {
        input.validate()?;
        let url = build_tags_url(&self.base_url, input.offset, input.limit)?;
        let response = self
            .authorized_get(url)
            .send()
            .await
            .map_err(|error| map_request_error(error, false))?;
        decode_json(response, StatusCode::OK).await
    }

    pub async fn archive_bookmark(&self, id: u64) -> Result<(), AppError> {
        self.post_empty(id, "archive/").await
    }

    pub async fn unarchive_bookmark(&self, id: u64) -> Result<(), AppError> {
        self.post_empty(id, "unarchive/").await
    }

    pub async fn delete_bookmark(&self, id: u64) -> Result<(), AppError> {
        let url = build_bookmark_url(&self.base_url, id)?;
        let response = self
            .authorized(self.client.delete(url))
            .send()
            .await
            .map_err(|error| map_request_error(error, true))?;
        expect_empty(response, StatusCode::NO_CONTENT).await
    }

    async fn post_empty(&self, id: u64, action: &str) -> Result<(), AppError> {
        let url = build_bookmark_url(&self.base_url, id)?
            .join(action)
            .map_err(|_| {
                AppError::new(
                    ErrorCode::InternalError,
                    "HTTP endpoint construction failed.",
                    false,
                )
            })?;
        let response = self
            .authorized(self.client.post(url))
            .send()
            .await
            .map_err(|error| map_request_error(error, true))?;
        expect_empty(response, StatusCode::NO_CONTENT).await
    }

    fn authorized_get(&self, url: Url) -> reqwest::RequestBuilder {
        self.authorized(self.client.get(url))
    }

    fn authorized(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request.header(AUTHORIZATION, format!("Token {}", self.token))
    }
}

async fn decode_json<T: DeserializeOwned>(
    response: Response,
    expected: StatusCode,
) -> Result<T, AppError> {
    let response = checked_response(response, expected, false)?;
    require_json_content_type(&response)?;
    let body = read_bounded_body(response).await?;
    serde_json::from_slice(&body).map_err(|_| protocol_error())
}

async fn expect_empty(response: Response, expected: StatusCode) -> Result<(), AppError> {
    let response = checked_response(response, expected, true)?;
    if response.content_length().is_some_and(|length| length > 0) {
        // A 204 body is not part of the mutation success contract. Ignore a
        // stray body after status validation, as Linkding's response is empty.
    }
    Ok(())
}

fn checked_response(
    response: Response,
    expected: StatusCode,
    mutation: bool,
) -> Result<Response, AppError> {
    if response.status() == expected {
        return Ok(response);
    }
    Err(map_status(response, mutation))
}

fn map_status(response: Response, _mutation: bool) -> AppError {
    let status = response.status();
    let mut error = match status {
        StatusCode::BAD_REQUEST => AppError::new(
            ErrorCode::BadRequest,
            "Linkding rejected the request.",
            false,
        ),
        StatusCode::UNAUTHORIZED => AppError::auth_failed(status.as_u16()),
        StatusCode::FORBIDDEN => AppError::new(
            ErrorCode::PermissionDenied,
            "Linkding denied this operation.",
            false,
        ),
        StatusCode::NOT_FOUND => AppError::new(
            ErrorCode::NotFound,
            "The Linkding resource was not found.",
            false,
        ),
        StatusCode::TOO_MANY_REQUESTS => {
            let retry = response
                .headers()
                .get(RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok())
                .filter(|seconds| *seconds <= 86_400);
            let message = retry
                .map(|seconds| {
                    format!("Linkding is rate limiting requests. Retry after {seconds} seconds.")
                })
                .unwrap_or_else(|| "Linkding is rate limiting requests; retry later.".to_owned());
            AppError::new(ErrorCode::RateLimited, message, true)
        }
        status if status.is_redirection() => AppError::new(
            ErrorCode::NetworkError,
            "The Linkding server redirected the request; check the configured canonical URL.",
            false,
        ),
        status if status.is_server_error() => AppError::new(
            ErrorCode::ServerError,
            "The Linkding server failed the request.",
            true,
        ),
        _ => AppError::new(
            ErrorCode::NetworkError,
            "Linkding returned an unexpected response.",
            true,
        ),
    };
    error = error.with_status(status.as_u16());
    error
}

async fn read_bounded_body(mut response: Response) -> Result<Vec<u8>, AppError> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(protocol_error());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| network_error())? {
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(protocol_error());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn require_json_content_type(response: &Response) -> Result<(), AppError> {
    let is_json = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            let media_type = value.split(';').next().unwrap_or_default().trim();
            media_type.eq_ignore_ascii_case("application/json") || media_type.ends_with("+json")
        });
    if is_json {
        Ok(())
    } else {
        Err(protocol_error())
    }
}

fn map_request_error(error: reqwest::Error, mutation: bool) -> AppError {
    if error.is_timeout() && mutation {
        AppError::new(
            ErrorCode::TimeoutUnknownOutcome,
            "The mutation timed out; reconcile with Linkding before retrying.",
            false,
        )
    } else {
        network_error()
    }
}

fn protocol_error() -> AppError {
    AppError::new(ErrorCode::InvalidInput, "Invalid Linkding response.", false)
}

fn network_error() -> AppError {
    AppError::new(
        ErrorCode::NetworkError,
        "The Linkding server could not be reached.",
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{BookmarkScope, ListBookmarksInput};
    use crate::validation::validate_base_url;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use tokio::sync::oneshot;

    fn response(status: &str, content_type: Option<&str>, body: &str) -> String {
        let content_type = content_type
            .map(|value| format!("Content-Type: {value}\r\n"))
            .unwrap_or_default();
        format!(
            "HTTP/1.1 {status}\r\n{content_type}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    fn server(reply: String) -> (String, oneshot::Receiver<String>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind mock server");
        let address = listener.local_addr().expect("mock address");
        let (sender, receiver) = oneshot::channel();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut request = Vec::new();
            let mut byte = [0; 1];
            while !request.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).expect("read request");
                request.push(byte[0]);
            }
            stream.write_all(reply.as_bytes()).expect("write response");
            let _ = sender.send(String::from_utf8(request).expect("request text"));
        });
        (format!("http://{address}"), receiver)
    }

    fn transport(base: &str) -> LinkdingHttpTransport {
        LinkdingHttpTransport::new(
            validate_base_url(base, true).expect("local HTTP base"),
            "fixture-token",
        )
        .expect("transport")
    }

    #[tokio::test]
    async fn sends_token_once_to_fixed_encoded_path() {
        let body = r#"{"results":[],"count":0}"#;
        let (base, request) = server(response("200 OK", Some("application/json"), body));
        let transport = transport(&format!("{base}/linkding"));
        let input = ListBookmarksInput {
            generation: 1,
            scope: BookmarkScope::Queue,
            query: Some("rust".to_owned()),
            tag: Some("systems".to_owned()),
            offset: 0,
            limit: None,
        };
        transport
            .list_bookmarks(&input)
            .await
            .expect("list bookmarks");
        let request = request.await.expect("request captured");
        assert!(request.starts_with(
            "GET /linkding/api/bookmarks/?limit=20&offset=0&q=rust+%23systems HTTP/1.1"
        ));
        assert!(request
            .to_ascii_lowercase()
            .contains("authorization: token fixture-token"));
    }

    #[tokio::test]
    async fn rejects_html_and_does_not_follow_redirects() {
        let (base, _request) = server(response("200 OK", Some("text/html"), "<html>"));
        let error = transport(&base)
            .get_profile()
            .await
            .expect_err("HTML is invalid");
        assert_eq!(error.code, ErrorCode::InvalidInput);

        let (base, _request) = server(
            "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:9/trap\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_owned(),
        );
        let error = transport(&base)
            .get_profile()
            .await
            .expect_err("redirect rejected");
        assert_eq!(error.code, ErrorCode::NetworkError);
        assert_eq!(error.status, Some(302));
    }

    #[tokio::test]
    async fn accepts_bodyless_mutation_success_and_maps_auth_and_timeout_safely() {
        let (base, _request) = server(response("204 No Content", None, ""));
        transport(&base)
            .archive_bookmark(7)
            .await
            .expect("archive success");

        let (base, _request) = server(response(
            "401 Unauthorized",
            Some("application/json"),
            r#"{"detail":"secret"}"#,
        ));
        let error = transport(&base)
            .get_profile()
            .await
            .expect_err("auth failure");
        assert_eq!(error.code, ErrorCode::AuthFailed);
        let serialized = serde_json::to_string(&error).expect("safe error serialization");
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains("fixture-token"));
    }

    #[test]
    fn response_cap_is_documented_and_transport_has_no_debug_secret() {
        assert_eq!(MAX_RESPONSE_BYTES, 5 * 1024 * 1024);
        let _ = std::mem::size_of::<LinkdingHttpTransport>();
    }
}
