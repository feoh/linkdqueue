# Security verification evidence

Status: implementation-phase evidence for Q02. This record covers automated
adversarial tests and local Linux checks; it is not a claim that every native
runtime or supported OS has been exercised.

## Adversarial coverage

The frontend security suite renders hostile bookmark title, description,
website metadata, notes, tag, and remote-resource fields containing an HTML
`img` payload. The assertions verify that the payload remains text, no script,
image, iframe, object, embed, or anchor is created, and the renderer performs
no `fetch`. Bookmark opening is still a single typed bridge call and does not
mark the bookmark read.

Rust security tests cover:

- bundled and debug-only origins, including attacker lookalikes, `file:`,
  `data:`, the IPC transport host, and external navigation;
- `http`/`https` external URL allowlisting, credential rejection, and
  preservation of path/query/fragment by the injected native opener;
- no-follow redirects and redacted HTTP/authentication errors;
- native credential missing/locked/unavailable behavior, scoped references,
  no plaintext fallback, and redacted diagnostics;
- failed save, partial clear, both-store clear failure, restart-risk warnings,
  pending-operation recovery, and stale-generation rejection.

The typed Tauri permission manifest is tested against the exact 14-command
allowlist. The packaged capability is restricted to the `main` window and
native menu events; no default, shell, filesystem, generic HTTP, SQL, remote
origin, or opener permission is present. Production CSP is tested separately
from the local Vite development CSP.

## Commands and results

All commands ran in the isolated Q02 worktree `/tmp/linkdqueue-q02` on
2026-09-13. No real credentials or external Linkding service were used.

- `npm ci`: passed; 245 packages installed, 0 vulnerabilities reported.
- `npm audit --audit-level=high`: passed; 0 vulnerabilities.
- `npm audit --omit=dev --audit-level=high`: passed; 0 vulnerabilities.
- `npm run format:check`: passed.
- `npm run lint`: passed.
- `npm run check`: passed with 0 diagnostics.
- `npm run test:unit`: passed, 21 files / 98 tests.
- `npm run test:contracts`: passed.
- `npm run build`: passed.
- `cargo fmt --all -- --check`: passed.
- `cargo test --all-targets --all-features`: passed, 58 unit tests and 2
  harness tests; 1 disposable live-Linkding test remained intentionally
  ignored because no CI service was supplied.
- `cargo clippy --all-targets --all-features -- -D warnings`: passed.
- `npm run tauri -- build --ci --no-sign --bundles deb`: passed and produced an
  unsigned local `amd64` Debian package. `file` identified it as a Debian
  binary package; checksum:
  `53d1f9cb1b13ca5773772eb2603757f58fdb343290a9ac71e973420353652c11`.
- `cargo audit --json`: passed with 0 vulnerability advisories. It reported
  transitive informational maintenance/unsoundness warnings for
  `proc-macro-error`, `unic-*`, and `glib 0.18.5`; none had a critical/high
  CVE severity. The GTK/Tauri dependency path and affected iterator APIs
  remain an upstream upgrade item; no renderer-controlled bookmark data calls
  those APIs directly.
- `cargo metadata --format-version 1 --locked`: completed. All 524 resolved
  packages exposed license metadata; observed expressions were MIT,
  Apache-2.0, BSD, ISC, Unicode-3.0, Zlib, Unlicense, MPL-2.0, and
  CDLA-Permissive-2.0. No package lacked license metadata. The MPL and CDLA
  dependencies are transitive (`cssparser` family and `webpki-roots`), not
  redistributed as standalone products.

Tool versions: Node `v24.15.0`, npm `11.12.1`, Rust `1.92.0`, Cargo
`1.92.0`, `cargo-audit 0.22.2`, Vitest `5.0.0`, Tauri CLI `2.11.4`, and
Tauri Rust `2.11.5`.

## Residual gates

The local Debian package was unsigned and was not launched in a native desktop
session here. Runtime denial of an unauthorized IPC invocation, keyring lock/
unavailability on each OS, browser CSP enforcement, and macOS/Windows
installer checks remain native CI/manual gates. The AppImage, macOS, and
Windows artifacts are not implied by this Linux result. No security finding
was waived, TLS validation was not disabled, and no secrets were written to
source, fixtures, logs, snapshots, or this evidence file.
