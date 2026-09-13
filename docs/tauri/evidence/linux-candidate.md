# Q06 Linux candidate and Secret Service evidence

Status: **blocked; implementation-phase evidence only**. This record does not
claim Linux release support. The required CI candidate manifest and a
supported disposable Linux install environment were not available during this
run.

## Test environment

- Date: 2026-09-13
- Host: CachyOS rolling, kernel `7.2.3-1-cachyos`, x86_64, Wayland
- WebKitGTK reported by `pkg-config`: `2.52.6`
- GTK 3 reported by `pkg-config`: `3.24.52`
- Secret Service: `org.freedesktop.secrets` active; KWallet 6.29.0-1.1;
  `libsecret` 0.21.7-1.1
- Toolchain: Node `v24.15.0`, npm `11.12.1`, Rust/Cargo `1.92.0`
- Candidate source: local commit
  `f99238406648173a36c809807f54e701738358d9`
- No real credentials, personal Linkding service, or legacy preferences were
  used. Temporary XDG config/data/cache directories were removed after the
  launch attempt.

The workflow file exists only in the local checkout at this revision;
`gh run list --workflow desktop-candidate.yml` against `feoh/linkdqueue` returned
HTTP 404 because it has not been pushed to the default branch. Consequently
there is no CI run ID, candidate manifest, or platform artifact checksum to
record or install.

## Automated candidate-source validation

Run from `/tmp/linkdqueue-q06/desktop`:

```text
npm ci                                      passed (245 packages, 0 vulnerabilities)
npm run format:check                        passed
npm run lint                                passed
npm run check                               passed (0 diagnostics)
npm run test:unit                           passed (21 files, 98 tests)
npm run test:contracts                      passed
npm run build                               passed
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
                                            passed
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
                                            passed
cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features
                                            passed (58 unit tests, 2 harness tests;
                                            1 disposable live-Linkding test ignored)
```

The exact Rust feature set compiled `keyring 3.6.3` with the synchronous
Secret Service backend. These checks are source/build evidence, not native
application acceptance.

## Local bundle checks

- `npm run tauri -- build --bundles deb --ci --no-sign`: **passed**.
- The resulting unsigned Debian package was inspected without installing it
  (this host has no `dpkg-deb`): `Package: linkdqueue-desktop`, `Version:
2.0.0`, `Architecture: amd64`, and dependencies include GTK/WebKitGTK,
  Ayatana AppIndicator, and libsecret.
- Local Debian package SHA-256:
  `7ce5b1dc4e0f341661aa0ddc2ed0ebb7ad077d245157c31e639bc7e0b44e60fd`.
- Package contents were extracted under `/tmp` only and removed afterward.
- `npm run tauri -- build --bundles appimage --ci --no-sign`: **failed** during
  linuxdeploy. The host's rolling-distribution shared libraries use RELR
  sections that the bundled linuxdeploy `strip` cannot recognize. The log
  reports `unknown type [0x13] section .relr.dyn` for libraries including
  `libwebkit2gtk-4.1.so.0`; this is not a successful AppImage candidate.
  Rebuild on the pinned Ubuntu 22.04 candidate runner is required.

The combined `appimage,deb` build was also attempted and failed at the
AppImage step. The successful `.deb` checksum above must not be confused with
a CI candidate-manifest checksum.

## Native launch and Secret Service checks

- A release binary launch with temporary XDG directories under the current
  Wayland session exited immediately with `Gdk-Message: Error 71 (Protocol
error) dispatching to Wayland display`.
- Retrying with `GDK_BACKEND=x11` kept the process alive for the eight-second
  observation window, but emitted `Failed to create GBM buffer of size
1600x1200: Invalid argument`. No interactive UI, menu, quit, restart, or
  Linkding workflow assertion was made from this attempt.
- A temporary Rust example using the production `NativeCredentialStore` and
  the isolated service namespace created a disposable entry, read it back, and
  deleted it successfully. The test printed only `native Secret Service
disposable create/read/delete: passed`; its disposable entry was deleted.
  This proves only the unlocked create/read/delete path for the current
  KWallet-backed Secret Service.
- Missing-entry behavior is covered by the Rust unit suite. Locked-store,
  unavailable-store, wrong-auth, native application restart/clear, and real
  Linkding list/mutation scenarios were not exercised. No safe simulation or
  supported disposable Linkding server was available.

## Gate result and blockers

| Gate                                               | Result          | Evidence / blocker                                                          |
| -------------------------------------------------- | --------------- | --------------------------------------------------------------------------- |
| Immutable CI candidate and manifest                | Blocked         | Workflow absent from origin; no run or manifest                             |
| x86_64 AppImage                                    | Blocked         | linuxdeploy RELR/rolling-host failure; Ubuntu runner rebuild required       |
| x86_64 `.deb` build/metadata                       | Local pass only | Unsigned package built and inspected; not installed                         |
| Supported disposable install/coexistence/uninstall | Blocked         | No Ubuntu-compatible disposable desktop VM and no `dpkg-deb` installer path |
| Real Linkding workflow                             | Blocked         | No disposable Linkding service/account                                      |
| Secret Service unlocked path                       | Local pass only | Production backend disposable create/read/delete passed                     |
| Secret Service locked/unavailable/wrong-auth       | Blocked         | No isolated safe simulation available                                       |
| Native restart/clear/menu/browser/keyboard gates   | Blocked         | GUI session launch was not stable for interactive testing                   |

Q06 must remain open. The next run needs an immutable CI candidate after the
workflow manifest import bug is corrected, then a disposable Ubuntu 22.04-or-
newer desktop environment with WebKitGTK, a Secret Service provider, and a
non-personal Linkding test service. No release support, native lifecycle pass,
or publication authorization is inferred from this evidence.
