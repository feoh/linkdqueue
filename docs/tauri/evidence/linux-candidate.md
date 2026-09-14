# Q06 Linux candidate and Secret Service evidence

Status: **blocked for final acceptance; candidate and partial Linux gates
passed**. This record covers immutable candidate `294a07dbe0b56eff68a3643e411db6cd523c10ca` and does not claim Linux release support. The candidate includes the native IPC payload fix. Locked/wrong-auth stores, browser opening, complete native menu coverage, and Flutter coexistence remain unverified.

## Candidate provenance

- GitHub Actions run: [34794691403](https://github.com/feoh/linkdqueue/actions/runs/34794691403)
- Candidate commit: `294a07dbe0b56eff68a3643e411db6cd523c10ca`
- Candidate manifest SHA-256: `d2083fc34dabac036af1550a17eede91257c1c3fa4779264488cbd6883abc2dc`
- Manifest toolchains: Node `24.15.0`, Rust `1.92.0`
- Version: `2.0.0`
- Signing: unsigned, non-public Actions artifacts only
- Linux AppImage SHA-256: `7f46c020698ee2fb1489e8d3a4bf3cb646b6f2641aa4a0f166ba5c1d30e676a1`
- Linux `.deb` SHA-256: `faf20bce61616ee6d2f28122d22ab4c056e5b9b357060ec9021e7772f3abf370`

The downloaded Linux artifact checksum file passed `sha256sum -c`, and all
21 downloaded manifest asset digests plus the manifest checksum matched. The
manifest includes the Linux AppImage, `.deb`, both macOS architectures, and
the Windows installer, all tied to the same immutable commit. The complete
candidate workflow passed its validation, Linux, macOS arm64, macOS x86_64,
Windows, and manifest jobs.

## Disposable test environment

- Ubuntu `24.04.4 LTS` x86_64 Docker container, image `ubuntu:24.04`
- WebKitGTK `2.52.6`, GTK 3 `3.24.41`, Xvfb `21.1.12`, gnome-keyring
  `46.1-2ubuntu0.2`, libsecret `0.21.4-1build3`
- Runtime libraries installed from Ubuntu packages: WebKitGTK 4.1, GTK 3,
  Ayatana AppIndicator, libsecret, XDG utilities, and software-rendered X11
- All containers, temporary XDG directories, disposable credentials, and
  mounted candidate files were removed after testing
- No personal credentials, personal Linkding service, or legacy preferences
  were used

## Automated and artifact checks

The exact candidate source checks in the hosted run passed:

```text
Validate frontend: format:check, lint, check, unit tests (98), contracts, build — passed
Validate Rust: fmt, clippy -D warnings, cargo test — passed (58 unit + 2 harness; 1 live test not part of hosted job)
Linux x86_64: AppImage and .deb build, architecture/metadata inspection, checksum upload — passed
macOS arm64 and x86_64: build, architecture/metadata inspection, checksum upload — passed
Windows x86_64: target compile, NSIS build, payload PE inspection, checksum upload — passed
Candidate manifest: same commit/version and all platform artifacts/checksums — passed
```

The disposable pinned Linkding image `sissbruecker/linkding:1.46.2` was run on
loopback with a temporary account and token. From the candidate Rust source:

```text
cargo test --manifest-path src-tauri/Cargo.toml \
  --test linkding_live -- --ignored --nocapture — passed (1 test)
```

That test exercised profile compatibility, queue/archive scopes, tag filtering,
20/100-item pagination, bookmark creation, tag replacement, mark-read,
archive/unarchive, and deletion. The token was supplied only through the
process environment and was not printed.

## Native package and launch checks

- Downloaded the Linux artifacts from run `34794691403`; the per-platform
  checksum file and manifest asset digests passed verification.
- Installed the candidate `.deb` in an Ubuntu `24.04` x86_64 container with
  `dpkg -i`. `dpkg-query` reported `linkdqueue-desktop 2.0.0 amd64`; the
  application binary and desktop entry were present.
- Launched the installed `.deb` under Xvfb and a private DBus session. The
  native window opened and `Ctrl+Q` exited cleanly.
- Removed the `.deb` with `dpkg -r linkdqueue-desktop`; package state and
  `/usr/bin/linkdqueue-desktop` were gone afterward.
- Launched the candidate AppImage with its supported
  `--appimage-extract-and-run` mode under Xvfb; the native window reported
  `800x600`. Ctrl+Q could not be conclusively exercised because the disposable
  Xvfb session has no window manager and Tauri's native accelerator did not
  receive a real desktop focus event. This remains a native desktop gate.
- The container had no Flutter installation, so package coexistence with an
  installed Flutter desktop app and preservation of its desktop entry were not
  proven. No Flutter or server data was touched.

## Secret Service lifecycle checks

A host-level disposable check against the production `NativeCredentialStore`
used the current isolated service namespace and a temporary Secret Service
entry. Create/read/delete passed against the host's unlocked KWallet-backed
Secret Service. The entry was deleted and no secret value was recorded.

In the Ubuntu native launch container, gnome-keyring had no login collection
available. A native save attempt against the disposable Linkding server
reached the server's profile endpoint, then failed closed when the credential
store could not provide a collection. The UI displayed its desktop operation
error page, and no preference file or plaintext token was created under the
isolated XDG configuration directory. This is evidence for the unavailable
store/error path, not a successful persistence test.

The following required scenarios were not completed against the immutable
candidate:

- intentionally locked store and wrong-auth behavior;
- native UI browser opening and complete menu coverage; and
- Flutter coexistence on the same desktop.

The rebuilt source passed native save/read across an actual restart,
successful clear followed by reopen/no reconnect, and native bookmark creation.
Those results are recorded below, but the hosted candidate artifact was only
validated through package launch and quit; its native credential lifecycle
still requires a supported interactive Linux run.

## Native IPC fix and disposable Secret Service run

The native bridge originally sent each typed command payload as the top-level
Tauri argument object, while the Rust commands accept a named `input`
argument. Browser tests did not expose this mismatch because their mock bridge
bypasses Tauri serialization. `desktop/src/lib/api/bridge.ts` now sends
`{ input }` for every typed command, and its bridge unit test asserts the
nested payload. Candidate run `34794691403` includes this fix.

The following local run used the rebuilt release binary (not the old Actions
artifact), a disposable Ubuntu 24.04 x86_64 container, Xvfb, a private
`dbus-run-session`, and a freshly unlocked gnome-keyring Secret Service
collection. The pinned disposable Linkding `1.46.2` server was exposed only
on loopback at a temporary port; its temporary account and token were deleted
with the environment.

- `npm run test:unit -- --run src/lib/api/bridge.test.ts` — 2 tests passed.
- `npm run tauri -- build --bundles deb --ci` — rebuilt the post-fix `.deb` and
  release binary successfully. Local AppImage bundling still cannot complete
  on this host because linuxdeploy rejects the host's RELR sections; this is
  not used as AppImage candidate evidence. The hosted candidate workflow then
  rebuilt both Linux artifacts from the immutable fix commit.
- Native onboarding through the rebuilt binary: HTTP consent, Test connection,
  Save connection, and the connected Queue view passed against Linkding.
- Native bookmark creation with URL/title/description/tag passed; the
  disposable server reported the created bookmark. No token appeared in the
  isolated preferences directory or application log.
- Relaunch in the same isolated session showed `CONNECTED`, proving saved
  native credential and display state survived an application restart.
- Settings → Clear connection → confirm passed. The isolated Secret Service
  lookup returned no entry, preferences contained `state: disconnected`, and
  the next relaunch showed the unconfigured connection form without
  reconnecting.

This run materially verifies the unlocked save/restart/clear lifecycle for
source that is now included in candidate `294a07d`, but the hosted artifact
still needs the interactive credential and full workflow gates below.

## Gate result

| Gate | Result | Evidence / residual risk |
| --- | --- | --- |
| Immutable candidate and manifest | **Pass** | Run `34794691403`; manifest checksum and 21 asset digests tied to commit `294a07d` |
| x86_64 AppImage | **Pass (artifact/launch)** | Hosted artifact built and launched at 800x600 with extract-and-run; Ctrl+Q and standard installed AppImage acceptance need a supported desktop window manager |
| x86_64 `.deb` | **Pass (artifact/install)** | Current run artifact installed, inspected, launched with Ctrl+Q, and removed in disposable Ubuntu container |
| Supported install/coexistence | **Partial** | Ubuntu package lifecycle passed; Flutter coexistence was not available to test |
| Real disposable Linkding API | **Pass (Rust integration)** | Pinned 1.46.2 live test passed; native UI path remains unverified |
| Secret Service unlocked CRUD | **Pass (adapter + rebuilt source)** | Production adapter create/read/delete passed on host KWallet; rebuilt native save/read/clear passed in disposable Ubuntu run |
| Missing/unavailable Secret Service | **Partial pass** | Native save failed closed with no plaintext fallback; full user-facing recovery needs a supported unlocked/locked setup |
| Locked/wrong-auth Secret Service | **Blocked** | No safe isolated locked/wrong-auth scenario completed |
| Native restart persistence and clear | **Pass (rebuilt source; candidate artifact gate pending)** | Rebuilt binary saved, survived restart, cleared durably, and reopened disconnected; current candidate includes the bridge fix but was not interactively credential-tested |
| Menus/quit/window minimum | **Partial pass** | Native `Ctrl+Q` and 800x600 passed; all menu actions were not interactively exercised |
| Browser open and native bookmark mutations | **Partial (rebuilt source)** | Native bookmark creation passed against disposable Linkding; browser opening and complete native workflow remain unverified |

Q06 must remain open. The next run needs a supported Linux desktop with a
working unlocked Secret Service collection (and a controllable locked/wrong
auth state), then must exercise candidate `294a07d`—not an older artifact—for
native save/restart/clear, browser, menu, and disposable Linkding UI gates.
