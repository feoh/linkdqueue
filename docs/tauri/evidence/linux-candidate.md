# Q06 Linux candidate and Secret Service evidence

Status: **blocked for final acceptance; candidate and partial Linux gates
passed**. This record covers immutable candidate `294a07dbe0b56eff68a3643e411db6cd523c10ca` and does not claim Linux release support. The candidate includes the native IPC payload fix. Locked stores, browser opening, and complete native menu coverage remain unverified. Flutter coexistence is intentionally not a requirement: the Tauri rewrite is the replacement desktop client.

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
  `--appimage-extract-and-run` mode under Xvfb and Openbox; the native window
  reported `800x600`, and Ctrl+Q exited cleanly. A real window manager was
  required for this accelerator check.
- Flutter coexistence was not tested because it is not a product requirement.
  The replacement does not read, rewrite, or delete legacy Flutter preferences
  or credentials. No Flutter or server data was touched.

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

- intentionally locked Secret Service behavior; and
- native UI browser opening and complete menu coverage.

## Native IPC fix and disposable Secret Service run

The native bridge originally sent each typed command payload as the top-level
Tauri argument object, while the Rust commands accept a named `input`
argument. Browser tests did not expose this mismatch because their mock bridge
bypasses Tauri serialization. `desktop/src/lib/api/bridge.ts` now sends
`{ input }` for every typed command, and its bridge unit test asserts the
nested payload. Candidate run `34794691403` includes this fix.

The native candidate run used the exact AppImage from run `34794691403`, a
disposable Ubuntu 24.04 x86_64 container, Xvfb, Openbox, a private
`dbus-run-session`, and a freshly initialized gnome-keyring Secret Service
collection. The pinned disposable Linkding `1.46.2` server was exposed on
loopback at a temporary port; its temporary account, API tokens, and XDG
state were deleted with the environment.

- Native onboarding through the candidate: HTTP consent, Test connection, and
  Save connection passed against Linkding. The connected Queue view rendered
  the seeded disposable bookmark and first-page requests returned 200.
- The preferences file contained only the canonical endpoint, credential
  reference, and display settings; it did not contain the API token. A
  Secret Service lookup confirmed the token was stored under the isolated
  `com.feoh.linkdqueue.desktop.v1` namespace.
- Relaunching the same candidate in the same unlocked session retained the
  configured state and successfully read the credential.
- Settings → Clear connection → confirm passed. The preferences state became
  `disconnected`, the Secret Service lookup returned no entry, and the
  candidate did not reconnect after the next relaunch.
- A separate candidate run with a synthetic invalid token displayed
  `Linkding authentication failed` and created no preferences file.
- The host-level disposable production `NativeCredentialStore` create/read/
  delete check passed against the unlocked KWallet-backed Secret Service.

These checks materially verify the unlocked save/restart/clear lifecycle and
wrong-auth handling on the exact immutable candidate. Locked-store behavior,
browser opening, and complete menu actions remain open.

## Gate result

| Gate | Result | Evidence / residual risk |
| --- | --- | --- |
| Immutable candidate and manifest | **Pass** | Run `34794691403`; manifest checksum and 21 asset digests tied to commit `294a07d` |
| x86_64 AppImage | **Pass (artifact/launch/quit)** | Hosted artifact built and launched at 800x600 with extract-and-run; Ctrl+Q passed with Openbox; standard installed AppImage acceptance remains |
| x86_64 `.deb` | **Pass (artifact/install)** | Current run artifact installed, inspected, launched with Ctrl+Q, and removed in disposable Ubuntu container |
| Supported install/uninstall | **Pass (Linux package lifecycle)** | Ubuntu `.deb` install, launch, quit, and uninstall passed; the Tauri rewrite is the sole supported desktop client at cutover |
| Real disposable Linkding API | **Pass (Rust + native first page)** | Pinned 1.46.2 live test passed; exact candidate connected to the disposable server and rendered a seeded queue bookmark |
| Secret Service unlocked CRUD | **Pass (exact candidate + adapter)** | Exact candidate saved/read/cleared through disposable gnome-keyring; production adapter create/read/delete also passed on host KWallet |
| Missing/unavailable Secret Service | **Partial pass** | Native save failed closed with no plaintext fallback; full user-facing recovery needs a supported unlocked/locked setup |
| Locked/wrong-auth Secret Service | **Blocked** | No safe isolated locked/wrong-auth scenario completed |
| Native restart persistence and clear | **Pass (exact candidate)** | Exact AppImage retained configured state after relaunch, cleared durably, and reopened disconnected without reconnecting |
| Menus/quit/window minimum | **Partial pass** | Exact AppImage Ctrl+Q passed with Openbox and 800x600 passed; new/search/refresh/settings menu actions remain unverified |
| Browser open and native bookmark mutations | **Blocked** | Seeded bookmark rendered in the exact candidate; browser opening and native mutations remain unverified |

Q06 must remain open. The next run needs a supported Linux desktop with a
controllable locked Secret Service state, then must exercise candidate
`294a07d`—not an older artifact—for browser opening, every required menu action,
and native mutations. Flutter coexistence is explicitly out of scope.
