//! Opt-in compatibility checks against a disposable pinned Linkding instance.
//!
//! The test is ignored by default. CI starts a loopback-only v1.46.2 container
//! and supplies both environment variables; no saved desktop connection is
//! consulted and no token is printed by this test.

use std::collections::HashSet;
use std::env;
use std::time::Duration;

use linkdqueue_desktop_lib::domain::{
    BookmarkScope, CreateBookmarkInput, ListBookmarksInput, ListTagsInput, MarkReadInput,
    ReplaceTagsInput,
};
use linkdqueue_desktop_lib::http::LinkdingHttpTransport;
use linkdqueue_desktop_lib::validation::{validate_base_url, validate_tag_name};
use url::Host;

const EXPECTED_VERSION: &str = "1.46.2";
const BOOKMARK_COUNT: usize = 45;
const TAG_COUNT: usize = 205;

struct LiveConfig {
    base_url: String,
    token: String,
}

impl LiveConfig {
    fn transport(&self) -> LinkdingHttpTransport {
        let parsed = url::Url::parse(&self.base_url).expect("live test base URL must parse");
        let is_loopback = match parsed.host() {
            Some(Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
            Some(Host::Ipv4(address)) => address.is_loopback(),
            Some(Host::Ipv6(address)) => address.is_loopback(),
            None => false,
        };
        assert!(
            is_loopback,
            "live test refuses non-loopback base URL; use the disposable container"
        );
        let allow_insecure_http = parsed.scheme() == "http";
        let base =
            validate_base_url(&self.base_url, allow_insecure_http).expect("valid live base URL");
        LinkdingHttpTransport::new(base, &self.token).expect("live transport")
    }
}

fn configured_transport() -> LiveConfig {
    let base_url = env::var("LINKDING_TEST_BASE_URL")
        .expect("LINKDING_TEST_BASE_URL must point to the disposable loopback server");
    let token = env::var("LINKDING_TEST_TOKEN")
        .expect("LINKDING_TEST_TOKEN must be supplied explicitly; no saved token is allowed");
    LiveConfig { base_url, token }
}

fn tags_for_bookmark(index: usize, all_tags: &[String]) -> Vec<String> {
    let count = if index < 25 { 5 } else { 4 };
    let start = match index {
        0 => 0,
        1..=24 => 5 + (index - 1) * 5,
        _ => 125 + (index - 25) * 4,
    };
    let end = (start + count).min(all_tags.len());
    let mut tags = if index == 0 {
        vec!["café".to_owned(), "C++".to_owned(), "ユニコード".to_owned()]
    } else {
        Vec::new()
    };
    tags.extend(all_tags[start..end].iter().cloned());
    tags
}

#[tokio::test]
#[ignore = "requires the CI disposable Linkding harness"]
async fn pinned_linkding_supports_profiles_scopes_pagination_and_mutations() {
    let config = configured_transport();
    let profile = config
        .transport()
        .get_profile()
        .await
        .expect("profile request");
    assert_eq!(profile["version"], EXPECTED_VERSION);

    let mut all_tags = vec!["café".to_owned(), "C++".to_owned(), "ユニコード".to_owned()];
    all_tags.extend((0..TAG_COUNT - all_tags.len()).map(|index| format!("q04-tag-{index:03}")));
    assert_eq!(all_tags.len(), TAG_COUNT);
    for tag in &all_tags {
        validate_tag_name(tag).expect("seed tag is representable");
    }

    let mut ids = Vec::with_capacity(BOOKMARK_COUNT);
    for index in 0..BOOKMARK_COUNT {
        let bookmark = config
            .transport()
            .create_bookmark(&CreateBookmarkInput {
                generation: 1,
                url: format!("https://q04-bookmark-{index:03}.invalid/article"),
                title: Some(format!("Q04 bookmark {index:03}")),
                description: Some("Synthetic disposable integration fixture.".to_owned()),
                notes: Some("Q04 notes".to_owned()),
                tag_names: tags_for_bookmark(index, &all_tags),
                is_archived: index % 4 >= 2,
                is_read: index % 4 == 1 || index % 4 == 3,
            })
            .await
            .unwrap_or_else(|error| panic!("create fixture bookmark {index}: {error:?}"));
        ids.push(bookmark.id);
        // The disposable image uses SQLite behind multiple uWSGI workers;
        // leave a short interval between writes rather than retrying a
        // mutation after an unknown outcome.
        std::thread::sleep(Duration::from_millis(250));
    }

    let queue = config
        .transport()
        .list_bookmarks(&ListBookmarksInput {
            generation: 1,
            scope: BookmarkScope::Queue,
            query: Some("Q04".to_owned()),
            tag: None,
            offset: 0,
            limit: Some(20),
        })
        .await
        .expect("queue query");
    assert_eq!(queue.count, 12);
    assert_eq!(queue.results.len(), 12);
    assert!(queue
        .results
        .iter()
        .all(|bookmark| bookmark.unread && !bookmark.is_archived));

    let archive = config
        .transport()
        .list_bookmarks(&ListBookmarksInput {
            generation: 1,
            scope: BookmarkScope::Archive,
            query: Some("Q04".to_owned()),
            tag: None,
            offset: 0,
            limit: Some(20),
        })
        .await
        .expect("archive query");
    assert_eq!(archive.count, 22);
    assert_eq!(archive.results.len(), 20);
    assert!(archive.results.iter().all(|bookmark| bookmark.is_archived));

    let tagged = config
        .transport()
        .list_bookmarks(&ListBookmarksInput {
            generation: 1,
            scope: BookmarkScope::Queue,
            query: None,
            tag: Some("café".to_owned()),
            offset: 0,
            limit: Some(20),
        })
        .await
        .expect("unicode tag query");
    assert_eq!(tagged.count, 1);
    assert!(tagged.results[0].tag_names.iter().any(|tag| tag == "café"));

    let mut listed_tags = Vec::with_capacity(TAG_COUNT);
    for offset in [0, 100, 200] {
        let page = config
            .transport()
            .list_tags(&ListTagsInput {
                generation: 1,
                offset,
                limit: Some(100),
            })
            .await
            .expect("tag page");
        listed_tags.extend(page.results.into_iter().map(|tag| tag.name));
    }
    assert_eq!(listed_tags.len(), TAG_COUNT);
    assert_eq!(listed_tags.iter().collect::<HashSet<_>>().len(), TAG_COUNT);
    assert!(listed_tags.iter().any(|tag| tag == "C++"));
    assert!(listed_tags.iter().any(|tag| tag == "ユニコード"));

    let first_id = ids[0];
    let updated = config
        .transport()
        .replace_bookmark_tags(&ReplaceTagsInput {
            generation: 1,
            bookmark_id: first_id,
            tag_names: vec!["q04-replaced".to_owned(), "C++".to_owned()],
        })
        .await
        .expect("replace tags");
    assert_eq!(updated.tag_names, ["C++", "q04-replaced"]);

    let updated = config
        .transport()
        .mark_read(&MarkReadInput {
            generation: 1,
            bookmark_id: first_id,
            is_read: true,
        })
        .await
        .expect("mark read");
    assert!(!updated.unread);
    config
        .transport()
        .archive_bookmark(first_id)
        .await
        .expect("archive bookmark");
    config
        .transport()
        .unarchive_bookmark(first_id)
        .await
        .expect("unarchive bookmark");
    config
        .transport()
        .delete_bookmark(first_id)
        .await
        .expect("delete bookmark");
}
