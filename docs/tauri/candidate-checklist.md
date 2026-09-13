# Non-public desktop candidate checklist

This checklist applies to `desktop-candidate.yml`. The workflow is
`workflow_dispatch` only and accepts a full 40-character commit SHA. It never
creates a Git tag, GitHub Release, or desktop-only `v*.*.*` release.

## Before dispatch

- Confirm the requested commit is immutable and contains the candidate
  workflow.
- Confirm `package.json`, `src-tauri/tauri.conf.json`, and
  `src-tauri/Cargo.toml` all report version `2.0.0`.
- Confirm the commit does not contain real credentials, signing material, or
  unpublished tokens in fixtures/logging changes.
- Record the intended workflow run URL and the exact SHA entered in the
  dispatch input.

## Workflow gates

1. `validate` checks out the exact SHA, verifies version agreement, runs the
   complete frontend and Rust validation suite, and has no release permission.
2. `linux` builds and inspects x86_64 AppImage and `.deb` bundles.
3. `macos` builds and inspects separate arm64 and x86_64 app/DMG bundles,
   including Keychain backend compilation.
4. `windows` builds and inspects the x86_64 NSIS PE, including Credential
   Manager backend compilation, version, architecture, and Authenticode state.
5. `manifest` downloads only the platform candidate artifacts and publishes a
   checksummed manifest containing the exact SHA, run ID, artifact names,
   platform/architecture asset paths, toolchains, and unsigned state.

All platform jobs require `validate`; the manifest requires all platform jobs.
No artifact is assembled from a different source commit. A failed or skipped
platform job is a failed candidate, not a partial green result.

## Candidate review

- Verify every artifact name contains the requested commit SHA.
- Verify every platform checksum and the manifest checksum.
- Verify the manifest says `unsigned` unless an owner-approved signing policy
  and scoped CI secret references have been added separately.
- Treat SmartScreen, Gatekeeper, WebView2, installer/uninstaller, and native
  credential checks as outstanding until Q08 records them on real hosts.
- Use the candidate artifacts only for owner-approved testing; do not publish
  them or create a release from this workflow.

## Evidence handoff

Give Q06-Q08 testers the workflow run ID, exact commit SHA, manifest checksum,
and the artifact names. Testers must record platform/architecture, install
method, app version, signing status, WebView2/keyring behavior, restart/clear
results, and browser-opening behavior without recording secrets. Retain the
workflow's platform logs and checksums with the candidate evidence.
