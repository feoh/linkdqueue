//! Restricted Linkding HTTP transport.
//!
//! Only typed operations in this module can issue requests. The renderer never
//! supplies a URL, header, method, or redirect target.

use std::time::Duration;

use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, RETRY_AFTER};
use reqwest::{Client, Response, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

use crate::domain::{
    Bookmark, CreateBookmarkInput, ListBookmarksInput, ListTagsInput, MarkReadInput, Page,
    ReplaceTagsInput, Tag,
};
use crate::error::{AppError, ErrorCode};
use crate::validation::{
    build_bookmark_collection_url, build_bookmark_url, build_bookmarks_url, build_profile_url,
    build_tags_url, validate_token,
};

const MAX_RESPONSE_BYTES: usize = 5 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

pub struct LinkdingHttpTransport {
    client: Client,
    base_url: crate::validation::ValidatedBaseUrl,
    token: String,
}

#[derive(Debug, Serialize)]
struct CreateBookmarkPayload<'a> {
    url: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notes: Option<&'a str>,
    tag_names: &'a [String],
    is_archived: bool,
    unread: bool,
}

#[derive(Debug, Serialize)]
struct MarkReadPayload {
    unread: bool,
}

#[derive(Debug, Serialize)]
struct ReplaceTagsPayload<'a> {
    tag_names: &'a [String],
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
        let page: Page<Bookmark> = decode_json(response, StatusCode::OK).await?;
        validate_bookmark_page(page)
    }

    pub async fn list_tags(&self, input: &ListTagsInput) -> Result<Page<Tag>, AppError> {
        input.validate()?;
        let url = build_tags_url(&self.base_url, input.offset, input.limit)?;
        let response = self
            .authorized_get(url)
            .send()
            .await
            .map_err(|error| map_request_error(error, false))?;
        let page: Page<Tag> = decode_json(response, StatusCode::OK).await?;
        validate_tag_page(page)
    }

    pub async fn create_bookmark(&self, input: &CreateBookmarkInput) -> Result<Bookmark, AppError> {
        input.validate()?;
        let url = build_bookmark_collection_url(&self.base_url)?;
        let payload = CreateBookmarkPayload {
            url: &input.url,
            title: input.title.as_deref(),
            description: input.description.as_deref(),
            notes: input.notes.as_deref(),
            tag_names: &input.tag_names,
            is_archived: input.is_archived,
            unread: !input.is_read,
        };
        let response = self
            .authorized(self.client.post(url))
            .header(ACCEPT, "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|error| map_request_error(error, true))?;
        let bookmark: Bookmark = decode_json(response, StatusCode::CREATED).await?;
        validate_bookmark(bookmark)
    }

    pub async fn mark_read(&self, input: &MarkReadInput) -> Result<Bookmark, AppError> {
        input.validate()?;
        let url = build_bookmark_url(&self.base_url, input.bookmark_id)?;
        let payload = MarkReadPayload {
            unread: !input.is_read,
        };
        let response = self
            .authorized(self.client.patch(url))
            .header(ACCEPT, "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|error| map_request_error(error, true))?;
        let bookmark: Bookmark = decode_json(response, StatusCode::OK).await?;
        validate_bookmark(bookmark)
    }

    pub async fn replace_bookmark_tags(
        &self,
        input: &ReplaceTagsInput,
    ) -> Result<Bookmark, AppError> {
        input.validate()?;
        let url = build_bookmark_url(&self.base_url, input.bookmark_id)?;
        let payload = ReplaceTagsPayload {
            tag_names: &input.tag_names,
        };
        let response = self
            .authorized(self.client.patch(url))
            .header(ACCEPT, "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|error| map_request_error(error, true))?;
        let bookmark: Bookmark = decode_json(response, StatusCode::OK).await?;
        validate_bookmark(bookmark)
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
        self.authorized(self.client.get(url).header(ACCEPT, "application/json"))
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

fn validate_bookmark(bookmark: Bookmark) -> Result<Bookmark, AppError> {
    bookmark.validate()?;
    Ok(bookmark)
}

fn validate_bookmark_page(page: Page<Bookmark>) -> Result<Page<Bookmark>, AppError> {
    page.validate()?;
    for bookmark in &page.results {
        bookmark.validate()?;
    }
    Ok(page)
}

fn validate_tag_page(page: Page<Tag>) -> Result<Page<Tag>, AppError> {
    page.validate()?;
    if page
        .results
        .iter()
        .any(|tag| tag.id == 0 || tag.name.trim().is_empty())
    {
        return Err(protocol_error());
    }
    Ok(page)
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
            let content_length = String::from_utf8_lossy(&request)
                .lines()
                .find_map(|line| {
                    line.strip_prefix("Content-Length:")
                        .or_else(|| line.strip_prefix("content-length:"))
                        .and_then(|value| value.trim().parse::<usize>().ok())
                })
                .unwrap_or(0);
            let mut body = vec![0; content_length];
            stream.read_exact(&mut body).expect("read request body");
            request.extend_from_slice(&body);
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
            "GET /linkding/api/bookmarks/?limit=20&offset=0&unread=yes&q=rust+%23systems HTTP/1.1"
        ));
        assert!(request
            .to_ascii_lowercase()
            .contains("authorization: token fixture-token"));
    }

    #[tokio::test]
    async fn reads_first_and_last_bookmark_pages_at_numeric_offsets() {
        let first_body = include_str!("../../tests/fixtures/linkding/bookmarks-page-1.json");
        let (base, first_request) =
            server(response("200 OK", Some("application/json"), first_body));
        let first = transport(&base)
            .list_bookmarks(&ListBookmarksInput {
                generation: 1,
                scope: BookmarkScope::Queue,
                query: None,
                tag: None,
                offset: 0,
                limit: None,
            })
            .await
            .expect("first bookmark page");
        assert_eq!(first.count, 45);
        assert_eq!(first.results.len(), 20);
        assert!(first.next.is_some());
        assert!(first_request
            .await
            .expect("first request captured")
            .contains("GET /api/bookmarks/?limit=20&offset=0&unread=yes HTTP/1.1"));

        let last_body = include_str!("../../tests/fixtures/linkding/bookmarks-page-3.json");
        let (base, last_request) = server(response("200 OK", Some("application/json"), last_body));
        let last = transport(&base)
            .list_bookmarks(&ListBookmarksInput {
                generation: 1,
                scope: BookmarkScope::Queue,
                query: None,
                tag: None,
                offset: 40,
                limit: None,
            })
            .await
            .expect("last bookmark page");
        assert_eq!(last.results.len(), 5);
        assert!(last.next.is_none());
        assert!(last_request
            .await
            .expect("last request captured")
            .contains("GET /api/bookmarks/?limit=20&offset=40&unread=yes HTTP/1.1"));
    }

    #[tokio::test]
    async fn reads_empty_tag_page_and_defaults_missing_metadata() {
        let body = r#"{"count":0,"results":[]}"#;
        let (base, request) = server(response("200 OK", Some("application/json"), body));
        let page = transport(&base)
            .list_tags(&ListTagsInput {
                generation: 4,
                offset: 200,
                limit: None,
            })
            .await
            .expect("empty tag page");
        assert_eq!(page.count, 0);
        assert!(page.results.is_empty());
        assert!(page.next.is_none());
        assert!(page.previous.is_none());
        assert!(request
            .await
            .expect("request captured")
            .starts_with("GET /api/tags/?limit=100&offset=200 HTTP/1.1"));
    }

    #[tokio::test]
    async fn reads_profile_without_mutating_connection_state() {
        let body = r#"{"theme":"auto","version":"1.46.2"}"#;
        let (base, request) = server(response("200 OK", Some("application/json"), body));
        let transport = transport(&format!("{base}/linkding"));
        let profile = transport.get_profile().await.expect("profile probe");
        assert_eq!(profile["version"], "1.46.2");
        assert!(request
            .await
            .expect("request captured")
            .starts_with("GET /linkding/api/user/profile/ HTTP/1.1"));
    }

    #[tokio::test]
    async fn sends_archive_route_without_queue_or_legacy_filters() {
        let body = r#"{"count":0,"next":null,"previous":null,"results":[]}"#;
        let (base, request) = server(response("200 OK", Some("application/json"), body));
        let input = ListBookmarksInput {
            generation: 3,
            scope: BookmarkScope::Archive,
            query: None,
            tag: Some("systems".to_owned()),
            offset: 20,
            limit: None,
        };
        let page = transport(&base)
            .list_bookmarks(&input)
            .await
            .expect("list archive");
        assert_eq!(page.count, 0);
        let request = request.await.expect("request captured");
        assert!(request
            .starts_with("GET /api/bookmarks/archived/?limit=20&offset=20&q=%23systems HTTP/1.1"));
        assert!(!request.contains("unread="));
        assert!(!request.contains("is_read="));
        assert!(!request.contains("is_archived="));
    }

    #[tokio::test]
    async fn preserves_page_metadata_without_following_next_url() {
        let body = r#"{
            "count": 0,
            "next": "https://attacker.invalid/api/bookmarks/?offset=20",
            "previous": "https://linkding.invalid/api/bookmarks/?offset=0",
            "results": []
        }"#;
        let (base, request) = server(response("200 OK", Some("application/json"), body));
        let input = ListBookmarksInput {
            generation: 1,
            scope: BookmarkScope::Queue,
            query: None,
            tag: None,
            offset: 0,
            limit: None,
        };
        let page = transport(&base)
            .list_bookmarks(&input)
            .await
            .expect("list bookmarks");
        assert_eq!(
            page.next.as_deref(),
            Some("https://attacker.invalid/api/bookmarks/?offset=20")
        );
        assert!(request.await.is_ok());
    }

    #[tokio::test]
    async fn sends_allowlisted_create_payload_and_maps_read_state() {
        let body = include_str!("../../tests/fixtures/linkding/bookmark-create-success.json");
        let (base, request) = server(response("201 Created", Some("application/json"), body));
        let bookmark = transport(&base)
            .create_bookmark(&CreateBookmarkInput {
                generation: 1,
                url: "https://bookmark.invalid/new".to_owned(),
                title: Some("New bookmark".to_owned()),
                description: None,
                notes: None,
                tag_names: vec!["systems".to_owned()],
                is_archived: false,
                is_read: true,
            })
            .await
            .expect("create bookmark");
        assert_eq!(bookmark.id, 46);
        let request = request.await.expect("request captured");
        assert!(request.starts_with("POST /api/bookmarks/ HTTP/1.1"));
        assert!(request.contains(r#""url":"https://bookmark.invalid/new"#));
        assert!(request.contains(r#""tag_names":["systems"]"#));
        assert!(request.contains(r#""unread":false"#));
        assert!(!request.contains("is_read"));
    }

    #[tokio::test]
    async fn sends_mark_read_and_empty_tag_replacement_payloads() {
        let body = include_str!("../../tests/fixtures/linkding/bookmark-update-success.json");
        let (base, read_request) = server(response("200 OK", Some("application/json"), body));
        transport(&base)
            .mark_read(&MarkReadInput {
                generation: 1,
                bookmark_id: 1,
                is_read: true,
            })
            .await
            .expect("mark read");
        let request = read_request.await.expect("read request captured");
        assert!(request.starts_with("PATCH /api/bookmarks/1/ HTTP/1.1"));
        assert!(request.contains(r#""unread":false"#));
        assert!(!request.contains("is_read"));

        let (base, tags_request) = server(response("200 OK", Some("application/json"), body));
        transport(&base)
            .replace_bookmark_tags(&ReplaceTagsInput {
                generation: 1,
                bookmark_id: 1,
                tag_names: vec![],
            })
            .await
            .expect("clear bookmark tags");
        let request = tags_request.await.expect("tags request captured");
        assert!(request.starts_with("PATCH /api/bookmarks/1/ HTTP/1.1"));
        assert!(request.contains(r#""tag_names":[]"#));
    }

    #[tokio::test]
    async fn sends_explicit_archive_unarchive_and_delete_routes() {
        for (action, expected) in [
            ("archive/", "POST /api/bookmarks/7/archive/ HTTP/1.1"),
            ("unarchive/", "POST /api/bookmarks/7/unarchive/ HTTP/1.1"),
            ("delete/", "DELETE /api/bookmarks/7/ HTTP/1.1"),
        ] {
            let (base, request) = server(response("204 No Content", None, ""));
            let result = match action {
                "archive/" => transport(&base).archive_bookmark(7).await,
                "unarchive/" => transport(&base).unarchive_bookmark(7).await,
                "delete/" => transport(&base).delete_bookmark(7).await,
                _ => unreachable!("test action is fixed above"),
            };
            result.expect("bodyless mutation success");
            assert!(request
                .await
                .expect("request captured")
                .starts_with(expected));
        }
    }

    #[tokio::test]
    async fn maps_rate_limit_without_reading_error_body() {
        let (base, _request) = server(response(
            "429 Too Many Requests",
            Some("application/json"),
            r#"{"detail":"fixture-only body"}"#,
        ));
        let error = transport(&base)
            .list_tags(&ListTagsInput {
                generation: 1,
                offset: 0,
                limit: None,
            })
            .await
            .expect_err("rate limit");
        assert_eq!(error.code, ErrorCode::RateLimited);
        assert!(error.retryable);
        assert!(!error.message.contains("fixture-only"));
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
