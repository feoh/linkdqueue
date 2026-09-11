# Linkding HTTP contract

Status: frozen for the desktop client, pending live-server verification in Q04.

## Upstream evidence

This contract is based on the upstream API documentation and implementation at
Linkding **v1.46.2**, commit [`65813a7`](https://github.com/sissbruecker/linkding/tree/65813a75404b1319aca8b09700fadc0b15adabaf), retrieved 2026-09-11:

- [API documentation](https://github.com/sissbruecker/linkding/blob/65813a75404b1319aca8b09700fadc0b15adabaf/docs/src/content/docs/api.md)
- [API routes](https://github.com/sissbruecker/linkding/blob/65813a75404b1319aca8b09700fadc0b15adabaf/bookmarks/api/routes.py)
- [Serializers](https://github.com/sissbruecker/linkding/blob/65813a75404b1319aca8b09700fadc0b15adabaf/bookmarks/api/serializers.py)
- [Search parser](https://github.com/sissbruecker/linkding/blob/65813a75404b1319aca8b09700fadc0b15adabaf/bookmarks/services/search_query_parser.py)
- [REST framework settings](https://github.com/sissbruecker/linkding/blob/65813a75404b1319aca8b09700fadc0b15adabaf/bookmarks/settings/base.py)

The release version is evidence for the upstream source reviewed, not a
minimum version claim. Q04 must run the contract against the supported server
version before release.

## Common rules

- The configured base URL may contain a reverse-proxy context path. Append the
  relative paths below; do not follow a `next` URL returned by the server.
- Authenticate every request with `Authorization: Token <token>`. The current
  upstream authentication also accepts `Bearer`, but the desktop contract
  sends `Token` only.
- Send and accept JSON for the resource endpoints. Query parameters must be
  URL-encoded by the HTTP client.
- Upstream uses `unread`, not `is_read`, in bookmark JSON and filters. The
  legacy Flutter client used `is_read`; that spelling is not part of this
  contract and must not be sent by the desktop client.
- The normal list route excludes archived bookmarks. The archived route selects
  archived bookmarks. The desktop Queue additionally requests `unread=yes`.
- `count` is the server's total for the query. `next` and `previous` are
  informational URLs only. Pagination uses the requested `limit` and numeric
  `offset` (20 for bookmarks, 100 for tags).

## Endpoint contract

| Operation | Request | Success | Success body |
| --- | --- | --- | --- |
| Test connection | `GET /api/user/profile/` | `200` | Profile object (see below) |
| Queue/all bookmark page | `GET /api/bookmarks/?limit=20&offset=N[&q=...]` | `200` | Paginated bookmark envelope |
| Archived bookmark page | `GET /api/bookmarks/archived/?limit=20&offset=N[&q=...]` | `200` | Same envelope; all results archived |
| Create bookmark | `POST /api/bookmarks/` | `201` | Bookmark object |
| Edit bookmark | `PATCH /api/bookmarks/<id>/` | `200` | Updated bookmark object |
| Mark read/unread | `PATCH /api/bookmarks/<id>/` with `{"unread":false/true}` | `200` | Updated bookmark object |
| Replace tags | `PATCH /api/bookmarks/<id>/` with `{"tag_names":[...]}` | `200` | Updated bookmark object |
| Archive | `POST /api/bookmarks/<id>/archive/` | `204` | Empty body |
| Unarchive | `POST /api/bookmarks/<id>/unarchive/` | `204` | Empty body |
| Delete | `DELETE /api/bookmarks/<id>/` | `204` | Empty body |
| Tag page | `GET /api/tags/?limit=100&offset=N` | `200` | Paginated tag envelope |

The bookmark create body contains `url` and may contain `title`, `description`,
`notes`, `is_archived`, `unread`, `shared`, and `tag_names`. Empty title or
description can cause upstream website scraping; the desktop may explicitly
set `disable_scraping` only if its product behavior requires it. A duplicate
URL on create updates the existing bookmark rather than creating a second
one; the upstream docs warn that this may change, so the UI must not imply
unconditional creation.

PATCH is partial. Supported editable fields include `url`, `title`,
`description`, `notes`, `is_archived`, `unread`, and `shared`; `tag_names` is a
list of names and is replaced/normalized by Linkding. Derived/read-only fields
must not be sent. A duplicate URL during edit is a `400` validation error.

## Response shapes

### Profile

The profile response is a JSON object containing upstream display preferences,
including `theme`, `bookmark_date_display`, `bookmark_link_target`,
`web_archive_integration`, `tag_search`, sharing/favicon flags,
`search_preferences`, and read-only `version`. The complete sanitized success
shape is in `profile-success.json`.

### Bookmark

A bookmark object contains at least:

```json
{
  "id": 1,
  "url": "https://bookmark-001.invalid/articles/1",
  "title": "Fixture bookmark 001",
  "description": "Synthetic description for bookmark 001.",
  "notes": "Note 001",
  "web_archive_snapshot_url": "https://archive.invalid/fixture/bookmark-001",
  "favicon_url": null,
  "preview_image_url": null,
  "is_archived": false,
  "unread": true,
  "shared": false,
  "tag_names": ["fixture-02"],
  "date_added": "2026-01-01T12:00:00Z",
  "date_modified": "2026-02-01T12:00:00Z",
  "website_title": null,
  "website_description": null
}
```

`website_title` and `website_description` are retained upstream fields but the
current serializer returns them as null. `favicon_url`,
`preview_image_url`, and some derived/legacy fields may be null. Treat all
untrusted text as plain text and do not load any returned remote asset URL.
The desktop DTO maps `unread == false` to its `isRead == true` presentation
state; no `is_read` field is accepted from HTTP.

### Page envelope

```json
{"count": 45, "next": "...", "previous": null, "results": []}
```

`results` is an array of bookmark or tag objects. The client de-duplicates
bookmark/tag IDs across pages, stops on an empty page or a non-advancing
offset, and preserves earlier pages when a later request fails. It performs
only one load-more request per query at a time. `next` is never treated as an
instruction to change host, path, or query parameters.

## Search and tag syntax

`q` uses the same search language as the current Linkding UI:

- `term` searches title, description, notes, and URL;
- `#tag` searches a tag case-insensitively;
- whitespace is implicit `AND`; `and`, `or`, `not`, and parentheses are
  supported; quoted strings are terms;
- `unread` may be requested as `unread=yes` or as the `!unread` special keyword.

The desktop builds `q` by combining the debounced free-text query and the
selected tag with a space, then lets the HTTP client encode it. For example,
`rust` + tag `systems` becomes `q=rust%20%23systems` and means `rust AND
#systems`. Unicode term and tag values are passed as UTF-8 and percent-encoded.

The parser does **not** provide a quoted/escaped tag grammar: `#` reads until
whitespace or `(`, `)`, or a quote. Therefore names containing whitespace or
those delimiters cannot be represented losslessly in `q`; do not strip
characters, broaden the search, or silently substitute a different tag. The
UI must reject/disable a tag-filter request it cannot encode and explain the
limitation. Linkding's tag creation sanitizes spaces to hyphens, but the client
must use the returned catalogue name rather than assume that transformation.
Exact Unicode, punctuation, and mixed query behavior remains a blocking Q04
live-server check; this document records parser evidence, not a passed
integration test.

## Status and body contract

The following are the expected upstream application responses. Error bodies
are not rendered verbatim because they may contain server-controlled text.

| Status | Expected body / handling |
| --- | --- |
| `400` | JSON object of field names to validation-message arrays, e.g. `{"url":["This field is required."]}`. Keep edit/add UI open. |
| `401` | JSON `{"detail":"Invalid token."}` for a rejected token, or `{"detail":"Authentication credentials were not provided."}` when absent. Mark authentication failure; never retry automatically. |
| `403` | JSON `{"detail":...}`. Not expected for an owner request authenticated by token; surface as permission/policy failure. |
| `404` | JSON `{"detail":"Not found."}` for an unknown or non-owned bookmark/tag. Do not claim a mutation succeeded. |
| `429` | JSON `{"detail":...}` when a proxy/deployment throttles. Current upstream default REST framework settings configure no throttle, so this is a transport/deployment case; surface retry-later guidance without automatic mutation retry. |
| `5xx` | Server/proxy failure; body may be JSON or HTML and is not schema-stable. Preserve current rows for reads, show network/server failure, and offer explicit retry. |

A timeout or connection drop after a POST/PATCH/DELETE has an unknown outcome.
The client must not fabricate success or automatically replay it; offer
reconciliation guidance instead. Archive, unarchive, and delete success bodies
are empty (`204`), so a non-empty body is ignored after status validation.

## Fixtures

`desktop/tests/fixtures/linkding/` contains sanitized JSON for contract and
DTO tests:

- `profile-success.json`, `profile-empty.json`, and `profile-malformed.json`;
- bookmark success pages, empty page, optional-null object, malformed envelope,
  create response, and update response;
- three tag pages, an empty page, and a malformed envelope;
- `errors.json` for the status/body cases above;
- `dataset-recipes.json`, which defines 45 unique bookmark IDs over offsets
  0/20/40 and 205 unique tag IDs over offsets 0/100/200, plus a duplicate-page
  recipe.

Every fixture value is synthetic. Bookmark URLs use the reserved `.invalid`
TLD; no token, personal URL, username, or server response from a real account
is present. These fixtures are deterministic test inputs, not proof that a
live server accepts every documented query. Q04 owns live verification.
