use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Bookmark {
    pub id: u64,
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default, rename = "web_archive_snapshot_url")]
    pub web_archive_snapshot_url: Option<String>,
    #[serde(default)]
    pub favicon_url: Option<String>,
    #[serde(default)]
    pub preview_image_url: Option<String>,
    #[serde(default, rename = "is_archived")]
    pub is_archived: bool,
    #[serde(default)]
    pub unread: bool,
    #[serde(default)]
    pub shared: bool,
    #[serde(default, rename = "tag_names")]
    pub tag_names: Vec<String>,
    #[serde(rename = "date_added")]
    pub date_added: String,
    #[serde(default, rename = "date_modified")]
    pub date_modified: Option<String>,
    #[serde(default)]
    pub website_title: Option<String>,
    #[serde(default)]
    pub website_description: Option<String>,
}

impl Bookmark {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.id == 0 || self.url.trim().is_empty() || self.date_added.trim().is_empty() {
            return Err(AppError::protocol_error());
        }
        Ok(())
    }

    pub fn is_read(&self) -> bool {
        !self.unread
    }

    pub fn display_title(&self) -> &str {
        if self.title.is_empty() {
            self.website_title.as_deref().unwrap_or(&self.url)
        } else {
            &self.title
        }
    }

    pub fn display_description(&self) -> &str {
        if self.description.is_empty() {
            self.website_description.as_deref().unwrap_or_default()
        } else {
            &self.description
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tag {
    pub id: u64,
    pub name: String,
    #[serde(default, rename = "date_added")]
    pub date_added: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Page<T> {
    pub count: u64,
    #[serde(default)]
    pub next: Option<String>,
    #[serde(default)]
    pub previous: Option<String>,
    pub results: Vec<T>,
}

impl<T> Page<T> {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.results.len() as u64 > self.count && self.count != 0 {
            return Err(AppError::protocol_error());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BookmarkScope {
    All,
    Queue,
    Archive,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListBookmarksInput {
    pub generation: u64,
    pub scope: BookmarkScope,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
    pub offset: u64,
    #[serde(default)]
    pub limit: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTagsInput {
    pub generation: u64,
    pub offset: u64,
    #[serde(default)]
    pub limit: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBookmarkInput {
    pub generation: u64,
    pub url: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub tag_names: Vec<String>,
    #[serde(default)]
    pub is_archived: bool,
    #[serde(default)]
    pub is_read: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkIdInput {
    pub generation: u64,
    pub bookmark_id: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkReadInput {
    pub generation: u64,
    pub bookmark_id: u64,
    pub is_read: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceTagsInput {
    pub generation: u64,
    pub bookmark_id: u64,
    pub tag_names: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicSettings {
    pub schema_version: u8,
    pub generation: u64,
    pub connection_state: String,
    pub canonical_base_url: Option<String>,
    pub credential_status: Option<String>,
    pub allow_insecure_http: bool,
    pub pending_cleanup: bool,
    pub display: DisplayPreferences,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayPreferences {
    pub theme: String,
    pub text_scale: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bookmark_fixture_round_trips_and_maps_unread() {
        let source = include_str!("../../tests/fixtures/linkding/bookmarks-optional-null.json");
        let page: Page<Bookmark> = serde_json::from_str(source).expect("parse bookmark fixture");
        page.validate().expect("valid page");
        let bookmark = &page.results[0];
        bookmark.validate().expect("valid bookmark");
        assert!(!bookmark.is_read());
        assert_eq!(bookmark.display_title(), bookmark.url);
        assert_eq!(bookmark.display_description(), "");

        let encoded = serde_json::to_string(bookmark).expect("serialize bookmark");
        assert!(encoded.contains("\"unread\":true"));
        assert!(!encoded.contains("is_read"));
    }

    #[test]
    fn unknown_fields_are_tolerated_but_required_fields_are_not() {
        let source = r#"{
          "id": 9,
          "url": "https://fixture.invalid/item",
          "date_added": "2026-01-01T00:00:00Z",
          "unknown_server_field": true
        }"#;
        let bookmark: Bookmark = serde_json::from_str(source).expect("unknown fields tolerated");
        bookmark.validate().expect("required fields present");

        let malformed = r#"{"id":0,"url":"","date_added":""}"#;
        let bookmark: Bookmark = serde_json::from_str(malformed).expect("shape parses");
        assert_eq!(
            bookmark
                .validate()
                .expect_err("invalid required fields")
                .code,
            crate::error::ErrorCode::InvalidInput
        );
    }

    #[test]
    fn malformed_page_is_rejected() {
        let source = include_str!("../../tests/fixtures/linkding/bookmarks-malformed.json");
        assert!(serde_json::from_str::<Page<Bookmark>>(source).is_err());
    }
}
