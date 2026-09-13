# Q01 regression evidence

Status: deterministic unit/component evidence for the desktop replacement. The
suite uses injected bridge functions, controlled promises, and fake timers. It
does not use a production network, sleeps, retries, or timing-based race
workarounds.

## Regression map

The D01 IDs below are the regression IDs for the old defects/scenarios covered
by this evidence. Each entry names the exact test (including the parameterized
test title where applicable).

| D01 ID | Old defect / contract scenario | Exact test evidence |
|---|---|---|
| D01-R01 | Startup rendered protected content or fetched bookmarks while delayed bootstrap was still initializing (B05; scenario 1) | `desktop/src/lib/regressions.test.ts`: `waits through delayed bootstrap without issuing a protected read` |
| D01-R02 | A stale filter response repopulated the result after A → B → A, or a same-key refresh accepted the prior response (B09/B11; scenario 7) | `desktop/src/lib/regressions.test.ts`: `retires A-to-B-to-A and same-key refresh responses by revision` |
| D01-R03 | A delayed page 2 appended to a refreshed identity (B11; scenario 8) | `desktop/src/lib/regressions.test.ts`: `discards a delayed page two after a same-identity refresh` |
| D01-R04 | Account clear left authenticated cache entries available while disconnect was in flight (B04/B05; scenario 3) | `desktop/src/lib/regressions.test.ts`: `clears the authenticated cache before a controlled account disconnect completes` |
| D01-R05 | Removing a record at offset 40/45 and merely splicing the visible row caused a reload to skip or duplicate records (B14/B15/B16; scenario 10) | `desktop/src/lib/regressions.test.ts`: parameterized `refreshes every page after %s at the page boundary` for `delete`, `read`, `archive`, `unarchive`, and `tag removal`; it asserts the complete ID list, count, uniqueness, and offsets `[0, 20, 40]` after refresh |
| D01-R06 | A late write from the old account changed current rows/cache, including late success and late error paths (B03/B05/B21; scenario 2) | `desktop/src/lib/regressions.test.ts`: `keeps the current account cache clean when old-account writes finish or reject late`; `desktop/src/lib/state/session.test.ts`: `retires account queries when a new credential generation is saved` |
| D01-R07 | Confirmed mutation plus failed refresh was reported as ordinary success, or rejected/unknown writes were reported as success (B20/B21; scenario 10/12) | `desktop/src/lib/regressions.test.ts`: `distinguishes confirmed-write refresh failure, rejection, and unknown timeout`; `desktop/src/lib/queries/mutations.test.ts`: `does not report success after a failed or unknown-outcome write` and `labels confirmed write plus failed refetch as sync failure` |
| D01-R08 | Failed complete tag replacement closed the editor or discarded its draft (B17; scenario 11) | `desktop/src/lib/features/bookmarks/EditTagsDialog.test.ts`: parameterized `retains the draft and safely reports %s writes` and `emits only confirmed saves, allowing the owner to refresh an active tag filter` |
| D01-R09 | Display persistence failure made Settings unreachable or discarded the usable connection (B05/B22; scenario 13) | `desktop/src/App.test.ts`: `uses the current generation and recovers visibly when display persistence fails`; `desktop/src/lib/regressions.test.ts`: `uses a controlled bootstrap retry and keeps settings reachable after display changes` |

## Cross-layer assertions

The mutation boundary test uses one in-memory 45-record source-of-truth and
runs each mutation through `BookmarkMutations`, `QueryClient` invalidation, and
`BookmarkPager` reload/pagination. It verifies the resulting set and order of
IDs rather than only checking that a row disappeared. The pager race tests
resolve stale requests after the current request, proving stale guards—not
request ordering or retries—protect the current result.

The account tests use generation envelopes and an account-scoped query key. A
late generation-1 completion is allowed to settle, but cannot call the active
refetch or alter generation-2 cache data. Disconnect retires the generation-1
cache before the controlled native clear promise settles.

The component evidence is intentionally kept at the user boundary: a failed
tag save leaves the dialog and selected draft visible, while a display write
failure restores the previous display and leaves the Settings route mounted.

## Local commands

Run from `desktop/`:

```sh
npm run test:unit
npm run check
npm run lint
npm run format:check
npm run build
npm run test:contracts
```

These commands are local-only. Rust service and harness checks remain separate
from this frontend evidence and should be run by the desktop CI gate when Rust
files or the native harness are changed.
