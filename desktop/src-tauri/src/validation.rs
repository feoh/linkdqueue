//! Validation and URL construction at the Rust/Linkding boundary.
//!
//! The renderer supplies values, not request URLs.  This module canonicalizes
//! the configured origin and builds the small, fixed set of Linkding routes so
//! that paths returned by a server can never redirect a request elsewhere.

use std::collections::HashSet;
use std::net::{Ipv4Addr, Ipv6Addr};

use url::{Host, Url};

use crate::domain::BookmarkScope;
use crate::error::{AppError, ErrorCode};

pub const BOOKMARK_LIMIT: u16 = 20;
pub const TAG_LIMIT: u16 = 100;
/// Keep offsets within the signed range accepted by Linkding and intermediaries.
pub const MAX_OFFSET: u64 = i64::MAX as u64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedBaseUrl(Url);

impl ValidatedBaseUrl {
    pub fn as_url(&self) -> &Url {
        &self.0
    }

    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

/// Parse and canonicalize a Linkding base URL.
///
/// A trailing slash is removed from a non-root path so `join` appends API
/// routes below a reverse-proxy path instead of replacing that path. HTTP is
/// deliberately opt-in and is limited to local/private addresses.
pub fn validate_base_url(
    input: &str,
    allow_insecure_http: bool,
) -> Result<ValidatedBaseUrl, AppError> {
    let input = input.trim();
    if input.is_empty() {
        return Err(invalid_base_url("A Linkding base URL is required."));
    }

    let separator = input
        .find("://")
        .ok_or_else(|| invalid_base_url("The base URL must use an absolute URL."))?;
    let authority = &input[separator + 3..];
    if authority.is_empty() || authority.starts_with(['/', '?', '#']) {
        return Err(invalid_base_url("The base URL must include a host."));
    }
    if raw_path_has_dot_segment(authority) {
        return Err(invalid_base_url("The base URL contains an ambiguous path."));
    }

    let mut url =
        Url::parse(input).map_err(|_| invalid_base_url("Enter a valid Linkding base URL."))?;

    let scheme = url.scheme().to_ascii_lowercase();
    if scheme != "https" && scheme != "http" {
        return Err(invalid_base_url("The base URL must use http or https."));
    }
    if has_userinfo(&url) || url.query().is_some() || url.fragment().is_some() {
        return Err(invalid_base_url(
            "The base URL cannot contain credentials, a query, or a fragment.",
        ));
    }
    if url.host_str().is_none() {
        return Err(invalid_base_url("The base URL must include a host."));
    }

    if scheme == "http" {
        if !allow_insecure_http {
            return Err(AppError::new(
                ErrorCode::InsecureHttp,
                "HTTP requires explicit insecure-connection consent.",
                false,
            ));
        }
        if !is_local_http_host(&url) {
            return Err(AppError::new(
                ErrorCode::InsecureHttp,
                "HTTP is allowed only for a local or private Linkding host.",
                false,
            ));
        }
    }

    // URL parsing preserves escaped path bytes. Reject dot segments rather
    // than allowing a later join operation to give them a different meaning.
    if url
        .path()
        .split('/')
        .any(|segment| segment == "." || segment == "..")
    {
        return Err(invalid_base_url("The base URL contains an ambiguous path."));
    }

    // url::Url canonicalizes scheme/host while parsing. Removing a default
    // port is part of endpoint identity and avoids two credentials for one
    // origin. The path is set using Url's path handling, which retains valid
    // percent escapes.
    if matches!(
        (scheme.as_str(), url.port()),
        ("http", Some(80)) | ("https", Some(443))
    ) {
        url.set_port(None)
            .map_err(|_| invalid_base_url("The base URL has an invalid port."))?;
    }
    let path = url.path().to_owned();
    let normalized_path = if path.is_empty() {
        "/".to_owned()
    } else if path == "/" {
        path
    } else {
        path.trim_end_matches('/').to_owned()
    };
    url.set_path(&normalized_path);

    Ok(ValidatedBaseUrl(url))
}

/// Validate a bookmark or external URL. Query strings and fragments are valid;
/// credentials are rejected so opening a bookmark cannot leak them.
pub fn validate_http_url(input: &str) -> Result<Url, AppError> {
    let input = input.trim();
    let url = Url::parse(input)
        .map_err(|_| AppError::new(ErrorCode::ExternalUrlRejected, "Enter a valid URL.", false))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(AppError::new(
            ErrorCode::ExternalUrlRejected,
            "Only http and https URLs can be opened.",
            false,
        ));
    }
    if url.host_str().is_none() || has_userinfo(&url) {
        return Err(AppError::new(
            ErrorCode::ExternalUrlRejected,
            "The URL must contain a host and no credentials.",
            false,
        ));
    }
    Ok(url)
}

pub fn validate_bookmark_url(input: &str) -> Result<Url, AppError> {
    validate_http_url(input)
}

pub fn validate_token(input: &str) -> Result<String, AppError> {
    let token = input.trim();
    if token.is_empty() || token.chars().any(char::is_control) {
        return Err(AppError::invalid_input("A non-empty token is required."));
    }
    Ok(token.to_owned())
}

pub fn validate_id(id: u64) -> Result<u64, AppError> {
    if id == 0 {
        Err(AppError::invalid_input("The bookmark ID must be positive."))
    } else {
        Ok(id)
    }
}

pub fn validate_offset(offset: u64) -> Result<u64, AppError> {
    if offset > MAX_OFFSET {
        Err(AppError::invalid_input(
            "The pagination offset is too large.",
        ))
    } else {
        Ok(offset)
    }
}

pub fn validate_bookmark_limit(limit: Option<u16>) -> Result<u16, AppError> {
    validate_limit(limit, BOOKMARK_LIMIT, "bookmark")
}

pub fn validate_tag_limit(limit: Option<u16>) -> Result<u16, AppError> {
    validate_limit(limit, TAG_LIMIT, "tag")
}

fn validate_limit(limit: Option<u16>, maximum: u16, kind: &str) -> Result<u16, AppError> {
    match limit {
        None => Ok(maximum),
        Some(value) if value > 0 && value <= maximum => Ok(value),
        Some(_) => Err(AppError::invalid_input(format!(
            "The {kind} page limit must be between 1 and {maximum}."
        ))),
    }
}

/// Build the q value without pre-encoding it. The URL client performs the one
/// required percent-encoding pass when it adds the query parameter.
pub fn compose_query(query: Option<&str>, tag: Option<&str>) -> Result<Option<String>, AppError> {
    let query = query.map(str::trim).filter(|value| !value.is_empty());
    let tag = match tag {
        Some(value) => Some(validate_tag_name(value)?),
        None => None,
    };

    match (query, tag) {
        (None, None) => Ok(None),
        (Some(query), None) => Ok(Some(query.to_owned())),
        (None, Some(tag)) => Ok(Some(format!("#{tag}"))),
        (Some(query), Some(tag)) => Ok(Some(format!("{query} #{tag}"))),
    }
}

/// Linkding's search parser has no escaped tag grammar. These characters would
/// change the meaning of the selected tag, so reject them rather than silently
/// searching for a different tag.
pub fn validate_tag_name(input: &str) -> Result<String, AppError> {
    let tag = input.trim();
    if tag.is_empty() {
        return Err(AppError::invalid_input("A tag filter cannot be empty."));
    }
    if tag
        .chars()
        .any(|character| character.is_whitespace() || matches!(character, '(' | ')' | '"'))
    {
        return Err(AppError::invalid_input(
            "This tag cannot be represented by Linkding's search syntax.",
        ));
    }
    if tag.starts_with('#') {
        return Err(AppError::invalid_input(
            "Enter a tag name without its leading #.",
        ));
    }
    Ok(tag.to_owned())
}

/// Remove exact duplicates while preserving case, spelling, and first-seen
/// order. In particular, `Rust` and `rust` remain distinct names.
pub fn deduplicate_tag_names(tags: &[String]) -> Result<Vec<String>, AppError> {
    let mut seen = HashSet::new();
    let mut result = Vec::with_capacity(tags.len());
    for tag in tags {
        let tag = validate_tag_name(tag)?;
        if seen.insert(tag.clone()) {
            result.push(tag);
        }
    }
    Ok(result)
}

impl crate::domain::ListBookmarksInput {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_offset(self.offset)?;
        validate_bookmark_limit(self.limit)?;
        compose_query(self.query.as_deref(), self.tag.as_deref())?;
        Ok(())
    }
}

impl crate::domain::ListTagsInput {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_offset(self.offset)?;
        validate_tag_limit(self.limit)?;
        Ok(())
    }
}

impl crate::domain::CreateBookmarkInput {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_http_url(&self.url)?;
        deduplicate_tag_names(&self.tag_names)?;
        Ok(())
    }
}

impl crate::domain::BookmarkIdInput {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_id(self.bookmark_id).map(|_| ())
    }
}

impl crate::domain::MarkReadInput {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_id(self.bookmark_id).map(|_| ())
    }
}

impl crate::domain::ReplaceTagsInput {
    pub fn validate(&self) -> Result<(), AppError> {
        validate_id(self.bookmark_id)?;
        deduplicate_tag_names(&self.tag_names).map(|_| ())
    }
}

pub fn build_profile_url(base: &ValidatedBaseUrl) -> Result<Url, AppError> {
    join_fixed(base, "api/user/profile/")
}

pub fn build_bookmarks_url(
    base: &ValidatedBaseUrl,
    scope: BookmarkScope,
    query: Option<&str>,
    tag: Option<&str>,
    offset: u64,
    limit: Option<u16>,
) -> Result<Url, AppError> {
    let offset = validate_offset(offset)?;
    let limit = validate_bookmark_limit(limit)?;
    let q = compose_query(query, tag)?;
    let route = match scope {
        BookmarkScope::Queue => "api/bookmarks/",
        BookmarkScope::Archive => "api/bookmarks/archived/",
    };
    let mut url = join_fixed(base, route)?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("limit", &limit.to_string());
        pairs.append_pair("offset", &offset.to_string());
        if let Some(q) = q {
            pairs.append_pair("q", &q);
        }
    }
    Ok(url)
}

pub fn build_tags_url(
    base: &ValidatedBaseUrl,
    offset: u64,
    limit: Option<u16>,
) -> Result<Url, AppError> {
    let offset = validate_offset(offset)?;
    let limit = validate_tag_limit(limit)?;
    let mut url = join_fixed(base, "api/tags/")?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("limit", &limit.to_string());
        pairs.append_pair("offset", &offset.to_string());
    }
    Ok(url)
}

pub fn build_bookmark_url(base: &ValidatedBaseUrl, id: u64) -> Result<Url, AppError> {
    let id = validate_id(id)?;
    join_fixed(base, &format!("api/bookmarks/{id}/"))
}

fn join_fixed(base: &ValidatedBaseUrl, route: &str) -> Result<Url, AppError> {
    // `Url::join` treats a base without a trailing slash as a file and would
    // replace the last reverse-proxy path segment. Keep the stored canonical
    // form slash-free while giving join a directory base.
    let mut join_base = base.0.clone();
    let path = join_base.path().to_owned();
    if path != "/" && !path.ends_with('/') {
        join_base.set_path(&format!("{path}/"));
    }
    join_base
        .join(route)
        .map_err(|_| invalid_base_url("Unable to construct a Linkding API URL."))
}

fn invalid_base_url(message: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::InvalidBaseUrl, message, false)
}

fn raw_path_has_dot_segment(authority_and_path: &str) -> bool {
    let path = authority_and_path
        .find('/')
        .map(|index| &authority_and_path[index..])
        .unwrap_or_default();
    let path = path.split(['?', '#']).next().unwrap_or_default();
    path.split('/').any(|segment| {
        segment == "."
            || segment == ".."
            || segment.eq_ignore_ascii_case("%2e")
            || segment.eq_ignore_ascii_case("%2e%2e")
    })
}

fn has_userinfo(url: &Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return true;
    }
    // `https://@host` has an empty username and no password, but is still
    // userinfo. Inspect only the parsed authority, never arbitrary URL text.
    url.as_str()
        .split_once("://")
        .and_then(|(_, rest)| rest.split(['/', '?', '#']).next())
        .is_some_and(|authority| authority.contains('@'))
}

fn is_local_http_host(url: &Url) -> bool {
    let Some(host) = url.host() else {
        return false;
    };
    match host {
        Host::Domain(domain) => {
            domain.eq_ignore_ascii_case("localhost")
                || domain.to_ascii_lowercase().ends_with(".localhost")
        }
        Host::Ipv4(address) => is_local_ipv4(address),
        Host::Ipv6(address) => is_local_ipv6(address),
    }
}

fn is_local_ipv4(address: Ipv4Addr) -> bool {
    address.is_loopback() || address.is_private() || address.is_link_local()
}

fn is_local_ipv6(address: Ipv6Addr) -> bool {
    if address.is_loopback() || is_ipv6_unique_local(address) || is_ipv6_link_local(address) {
        return true;
    }
    address.to_ipv4().is_some_and(is_local_ipv4)
}

fn is_ipv6_unique_local(address: Ipv6Addr) -> bool {
    address.segments()[0] & 0xfe00 == 0xfc00
}

fn is_ipv6_link_local(address: Ipv6Addr) -> bool {
    address.segments()[0] & 0xffc0 == 0xfe80
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(input: &str) -> ValidatedBaseUrl {
        validate_base_url(input, false).expect("valid HTTPS base URL")
    }

    #[test]
    fn canonicalizes_root_and_reverse_proxy_paths() {
        assert_eq!(
            base(" HTTPS://EXAMPLE.INVALID ").as_str(),
            "https://example.invalid/"
        );
        assert_eq!(
            base("https://example.invalid/linkding///").as_str(),
            "https://example.invalid/linkding"
        );
        assert_eq!(
            build_profile_url(&base("https://example.invalid/linkding/"))
                .expect("profile URL")
                .as_str(),
            "https://example.invalid/linkding/api/user/profile/"
        );
    }

    #[test]
    fn rejects_unsafe_base_url_shapes() {
        for input in [
            "ftp://example.invalid",
            "https://user:password@example.invalid",
            "https://example.invalid/?q=secret",
            "https://example.invalid/#fragment",
            "https:///missing-host",
            "https://example.invalid/a/../b",
        ] {
            assert!(validate_base_url(input, false).is_err(), "accepted {input}");
        }
        assert_eq!(
            validate_base_url("http://example.invalid", true)
                .expect_err("public HTTP must fail")
                .code,
            ErrorCode::InsecureHttp
        );
    }

    #[test]
    fn allows_explicit_local_http_including_ipv6_loopback() {
        assert!(validate_base_url("http://127.0.0.1:8080/linkding", true).is_ok());
        assert!(validate_base_url("http://[::1]:8080/linkding", true).is_ok());
        assert!(validate_base_url("http://[fd00::1]/linkding", true).is_ok());
        assert!(validate_base_url("http://localhost:9090", true).is_ok());
        assert!(validate_base_url("http://127.0.0.1:8080", false).is_err());
    }

    #[test]
    fn builds_encoded_combined_query_once() {
        let url = build_bookmarks_url(
            &base("https://example.invalid/linkding"),
            BookmarkScope::Queue,
            Some("rust + café"),
            Some("c++"),
            20,
            None,
        )
        .expect("bookmark URL");
        assert_eq!(
            url.as_str(),
            "https://example.invalid/linkding/api/bookmarks/?limit=20&offset=20&q=rust+%2B+caf%C3%A9+%23c%2B%2B"
        );
        assert_eq!(
            url.query_pairs()
                .find(|(key, _)| key == "q")
                .map(|(_, value)| value),
            Some("rust + café #c++".into())
        );
    }

    #[test]
    fn selects_scope_and_never_uses_an_absolute_route() {
        let archive = build_bookmarks_url(
            &base("https://example.invalid/linkding/"),
            BookmarkScope::Archive,
            None,
            None,
            0,
            Some(20),
        )
        .expect("archive URL");
        assert_eq!(
            archive.as_str(),
            "https://example.invalid/linkding/api/bookmarks/archived/?limit=20&offset=0"
        );
        assert_eq!(
            build_tags_url(&base("https://example.invalid/linkding"), 100, None)
                .expect("tags URL")
                .as_str(),
            "https://example.invalid/linkding/api/tags/?limit=100&offset=100"
        );
    }

    #[test]
    fn rejects_unrepresentable_tags_without_changing_names() {
        assert_eq!(validate_tag_name("C++").expect("punctuation"), "C++");
        assert_eq!(validate_tag_name("café").expect("unicode"), "café");
        assert!(validate_tag_name("two words").is_err());
        assert!(compose_query(None, Some(" ")).is_err());
        assert!(validate_tag_name("quoted\"tag").is_err());
        assert!(validate_tag_name("paren(tag").is_err());
        assert!(validate_tag_name("#already-encoded").is_err());

        let tags = vec!["Rust".into(), "rust".into(), "Rust".into()];
        assert_eq!(
            deduplicate_tag_names(&tags).expect("deduplicated tags"),
            ["Rust", "rust"]
        );
    }

    #[test]
    fn validates_request_bounds_and_external_urls() {
        assert_eq!(validate_token(" token ").expect("trimmed token"), "token");
        assert!(validate_token("\n").is_err());
        assert!(validate_id(0).is_err());
        assert!(validate_bookmark_limit(Some(21)).is_err());
        assert!(validate_tag_limit(Some(101)).is_err());
        assert!(validate_offset(u64::MAX).is_err());
        assert!(validate_http_url("https://bookmark.invalid/a?q=1#part").is_ok());
        assert!(validate_http_url("javascript:alert(1)").is_err());
        assert!(validate_http_url("https://user@bookmark.invalid").is_err());
    }
}
