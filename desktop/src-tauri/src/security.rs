use url::Url;

/// Keep the renderer on the bundled application origin. External bookmark
/// URLs must go through the validated `open_external_url` command instead.
pub fn allows_navigation(url: &Url) -> bool {
    if url.scheme() == "tauri" && url.host_str() == Some("localhost") {
        return true;
    }

    if matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost") {
        return true;
    }

    // The Vite server is needed only for the debug development window. Keep
    // its origin and port explicit so a release build cannot navigate to it.
    cfg!(debug_assertions)
        && url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(1420)
}

#[cfg(test)]
mod tests {
    use super::allows_navigation;

    fn url(value: &str) -> url::Url {
        value.parse().expect("valid fixture URL")
    }

    #[test]
    fn permits_only_bundled_and_debug_vite_origins() {
        assert!(allows_navigation(&url("tauri://localhost/")));
        assert!(allows_navigation(&url("https://tauri.localhost/")));
        assert!(allows_navigation(&url(
            "http://tauri.localhost/assets/app.js"
        )));
        assert_eq!(
            allows_navigation(&url("http://127.0.0.1:1420/")),
            cfg!(debug_assertions)
        );
    }

    #[test]
    fn rejects_external_and_unexpected_local_origins() {
        for value in [
            "https://bookmarks.example/",
            "http://127.0.0.1:9090/",
            "http://localhost:1420/",
            "file:///tmp/index.html",
            "data:text/html,<script>alert(1)</script>",
            "tauri://evil.example/",
            "tauri://localhost.attacker.example/",
            "https://tauri.localhost.attacker.example/",
            "http://ipc.localhost/",
        ] {
            assert!(
                !allows_navigation(&url(value)),
                "unexpectedly allowed {value}"
            );
        }
    }
}
