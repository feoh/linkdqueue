# Q04 Linkding API evidence

Status: local disposable-server verification passed on 2026-09-12. This is not
personal-server or release evidence.

## Environment and safety

- Image: `sissbruecker/linkding:1.46.2` (reported API version `1.46.2`).
- The container used a random host port bound to `127.0.0.1` and an ephemeral
  `/etc/linkding/data` tmpfs. `LD_CONTEXT_PATH=linkding/` exercised the
  reverse-proxy subpath contract.
- The fixture token was created inside the disposable container and passed only
  to the test process. It was not printed, persisted in the repository, or
  included in this record.
- Cleanup was registered before startup and removed the container on both
  success and failure.

Local command:

```sh
LINKDING_TEST_BASE_URL=http://127.0.0.1:<random-port>/linkding \
LINKDING_TEST_TOKEN=<ephemeral-token> \
cargo test --manifest-path desktop/src-tauri/Cargo.toml \
  --test linkding_live -- --ignored
```

The equivalent command is the `linkding-integration` job in
`.github/workflows/desktop-ci.yml`; a hosted workflow run must still be
observed before CI is called passed.

## Observed contract

`desktop/src-tauri/tests/linkding_live.rs` seeded 45 synthetic bookmarks and
205 unique tags, covering all read/archive combinations, then exercised the
Rust transport against the real server:

- Profile returned HTTP 200 and `version: "1.46.2"`.
- Queue search returned 12 results, all `unread=true` and
  `is_archived=false`.
- Archive search returned 22 results, including read and unread archived
  bookmarks; the first page returned 20 records.
- Tag pagination returned three numeric-offset pages of 100, 100, and 5
  records, with 205 unique names and no server `next` URL followed.
- Unicode (`café`, `ユニコード`) and punctuation (`C++`) tag names survived
  creation, catalogue listing, and a Unicode tag query. Linkding returns
  `tag_names` sorted case-insensitively; the client treats response order as
  server-owned.
- Rust create returned 201, tag replacement and read update returned 200,
  archive/unarchive returned bodyless 204, and delete returned bodyless 204.
- The configured `/linkding/` path was retained for every request.

The disposable SQLite-backed image can intermittently reset a connection when
many writes are issued back-to-back across its two uWSGI workers. The harness
uses a short delay between fixture writes rather than retrying any mutation;
application mutations remain single-attempt and unknown outcomes are not
replayed.

Names containing whitespace, quotes, or parentheses remain intentionally
rejected by the client because Linkding's `q` parser cannot represent those
tags losslessly. Q04 did not widen that grammar or silently substitute a
search.
