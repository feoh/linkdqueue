# Tauri desktop development

The desktop replacement is an isolated static Svelte/Vite application with a
Tauri 2 Rust shell. Flutter remains the existing application and is not part of
desktop development commands.

## Toolchain

F01 pins the foundation to:

- Node.js 24.15.0 and npm 11.12.1;
- Rust 1.92.0 for CI, with the Tauri crate version pinned in
  `desktop/src-tauri/Cargo.toml` and exact dependency resolution in
  `Cargo.lock`;
- Svelte 5.57.0, Vite 8.3.0, TypeScript 6.0.3, Tauri CLI 2.11.4, and Tauri
  Rust 2.11.5.

The package manager is npm. Run commands from `desktop/` unless a command gives
an explicit manifest path.

## Local setup

```sh
cd desktop
npm ci
npm run check
npm run test:unit
npm run test:contracts
npm run lint
npm run format:check
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Run the local Tauri window with `npm run tauri -- dev`. The application starts a
Vite server on `127.0.0.1:1420` and loads only bundled local assets. The
foundation window has an 800x600 minimum size and makes no Linkding requests.

## Linux prerequisites

For a native Linux build, install the Tauri/WebKit development prerequisites
for the chosen distribution. On Debian/Ubuntu, the CI baseline installs:

```sh
sudo apt-get install \
  build-essential curl file libayatana-appindicator3-dev libssl-dev \
  libwebkit2gtk-4.1-dev libxdo-dev librsvg2-dev patchelf wget
```

A Secret Service daemon and user session are additionally required once the
credential backend is implemented. CI foundation tests use a fake keyring and
a loopback-only mock server; they never inspect the host keyring or network.

## Test boundaries

- `npm run test:unit` uses Vitest, jsdom, Svelte Testing Library, fake timers,
  and the typed bridge mock in `src/lib/testing/`.
- `npm run test:contracts` checks the shared IPC fixture and the frozen
  Linkding `unread` field. It must fail if a test intentionally changes a
  required field name; revert such experiments before committing.
- Rust integration tests under `src-tauri/tests/support/` use temporary
  preferences, failure-injectable fake storage, and a server bound to
  `127.0.0.1`. No test accepts a real token or discovers real credentials.
- Browser/axe, disposable live-Linkding, native keyring, packaging, and
  cross-OS checks are later tasks. They are not represented by skipped CI jobs
  or by a green placeholder.

## CI policy

`.github/workflows/desktop-ci.yml` runs for desktop changes in pull requests or
by explicit manual dispatch. It has `contents: read`, does not publish
artifacts, does not need secrets, and does not alter the existing Flutter
release workflow. It runs the same npm and Cargo checks listed above on a pinned
Ubuntu/Node/Rust toolchain and caches only dependency/build paths keyed by lock
file and toolchain.

The workflow intentionally does not claim Windows/macOS packaging or native
keyring coverage. Those gates require their own OS evidence. macOS WebDriver
availability and manual native alternatives are recorded in
[`distribution.md`](distribution.md).
