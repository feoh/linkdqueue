# macOS candidate artifacts

Tauri references: [macOS application bundle](https://v2.tauri.app/distribute/macos-application-bundle/) and [macOS code signing](https://v2.tauri.app/distribute/sign/macos/).

Status: CI configuration and static validation only. This task does not claim a
macOS runner, native launch, Keychain smoke test, signing, notarization, or
Gatekeeper result. The existing Flutter release workflow is unchanged and
still must not be used as evidence for these Tauri artifacts.

## Identity, minimum OS, and entitlements

The Tauri application uses the owner-approved identity
`com.feoh.linkdqueue.desktop`, which is distinct from the Flutter application's
`com.feoh.linkdqueue` identity. `desktop/src-tauri/tauri.conf.json` declares
macOS 12.0 (Monterey) as `LSMinimumSystemVersion` and points at
`src-tauri/entitlements/macos.plist`.

The entitlements preserve the existing unsandboxed macOS model used by the
Flutter app: `com.apple.security.app-sandbox` is explicitly false and
`com.apple.security.network.client` is the only capability. The Rust client
uses the native Keychain backend without a `keychain-access-groups` entitlement
(the app is not sandboxed, and no owner-approved team ID or shared keychain
access group exists). The Keychain service is the isolated
`com.feoh.linkdqueue.desktop.v1` namespace documented in
[`security.md`](security.md); no Flutter credential is read or shared.

## Architecture matrix

The non-publishing Desktop CI workflow creates separate jobs and artifacts:

| Artifact         | GitHub runner              | Rust target            | Minimum OS |
| ---------------- | -------------------------- | ---------------------- | ---------- |
| arm64 app + DMG  | `macos-14` (Apple Silicon) | `aarch64-apple-darwin` | macOS 12.0 |
| x86_64 app + DMG | `macos-13` (Intel)         | `x86_64-apple-darwin`  | macOS 12.0 |

Each artifact name contains `unsigned` and `developer`. There is no universal
bundle claim. The workflow does not publish, tag, or create a GitHub Release.

## Build and evidence gates

On the matching runner, CI runs:

```sh
cargo tree --manifest-path src-tauri/Cargo.toml \
  --target aarch64-apple-darwin -e features
cargo check --manifest-path src-tauri/Cargo.toml \
  --target aarch64-apple-darwin
npm run tauri -- build --ci --no-sign --target aarch64-apple-darwin \
  --bundles app,dmg
./scripts/validate-macos-bundle.sh arm64 <app-path> <dmg-path>
```

The x86_64 job substitutes `x86_64-apple-darwin` and `x86_64`. The Cargo tree
and target check are compilation evidence that the pinned `keyring = 3.6.3`
`apple-native` backend (including `security-framework`) is selected and
compiled for the requested target. The validator records and enforces:

- exactly one architecture using `lipo` (no accidental universal binary);
- `CFBundleIdentifier = com.feoh.linkdqueue.desktop`;
- `LSMinimumSystemVersion = 12.0`; and
- the same architecture and plist values in the app extracted from the DMG.

The generated evidence text and SHA-256 checksums are uploaded beside each
unsigned candidate artifact. A successful build or static inspection is not a
substitute for launching on matching macOS 12-or-newer hosts and exercising
setup, Keychain save/read/clear, external URL opening, quit/relaunch, and
Gatekeeper behavior without recording secrets.

## Optional signing and notarization gate

Signing and notarization are intentionally disabled for the candidate CI path;
`--no-sign` makes that gate explicit rather than relying on runner defaults.
No certificate, password, Apple ID, team ID, or app-specific password is stored
in the repository or passed in this task. If the owner later enables a signing
job, it must be opt-in, use GitHub secret references only, sign the isolated
bundle with hardened runtime and the checked-in entitlements, verify with
`codesign --verify --deep --strict`, submit the DMG with `xcrun notarytool`,
verify/staple the ticket, and rerun the architecture/plist checks. The job must
fail closed when any required secret reference is absent and must remain
separate from unsigned developer artifacts. No notarization or publication is
claimed here.
