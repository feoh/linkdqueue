# Desktop distribution, identity, and migration decisions

Status: decisions recorded for implementation; no artifact has been published
and no release/tag is authorized by this task.

## Owner decisions

The owner confirmed in the workflow session on 2026-09-11:

| Decision | Recorded value |
| --- | --- |
| Product display name | **Linkdqueue Desktop** |
| Application identifier | `com.feoh.linkdqueue.desktop` |
| Whole-project release version | `2.0.0` (major replacement release) |
| macOS minimum | macOS 12 Monterey or newer |
| Windows minimum | Windows 10 1809 or newer |
| Linux target | x86_64 Linux with glibc 2.31 or newer |
| Store distribution | No App Store, Microsoft Store, or other app-store submission is planned |
| Release scope | A future release is for the **whole project**, not a desktop-only release |

These are product decisions, not evidence that each minimum OS or packaging
job has been validated. OS build and native smoke evidence are release gates.
The package identifier remains distinct from the legacy Flutter identity so
that the replacement cannot accidentally consume or overwrite legacy state;
the cutover process removes or disables the old desktop package separately.

## Artifact matrix

The eventual whole-project release must produce these separately identified
artifacts:

| OS | Architecture | Format | Required evidence |
| --- | --- | --- | --- |
| Linux | x86_64 | AppImage and `.deb` | Build, install/launch, Secret Service smoke |
| Windows | x86_64 | NSIS installer | Build, install/uninstall, Credential Manager smoke |
| macOS | arm64 | app bundle and DMG | Build, launch, Keychain smoke, manual Gatekeeper check |
| macOS | x86_64 | app bundle and DMG | Build, launch, Keychain smoke, manual Gatekeeper check |

There is no universal macOS claim: a universal bundle may be considered only
if both architectures are actually built, inspected, and native-smoke-tested
in the same release evidence. Do not substitute the current Flutter tar/zip
workflow for these targets.

## Signing and publishing policy

No store submission is planned. No signing or notarization credentials are
presented in this document or requested in chat. The following states are kept
separate:

1. **Developer artifact:** local build, never published as a release claim.
2. **Candidate artifact:** CI/manual artifact for owner review; may be
   unsigned, must be labelled as such, and is not a release.
3. **Public whole-project release:** blocked until the owner explicitly chooses
   either available signing/notarization evidence or an approved unsigned
   distribution policy. “No app store” does not by itself prove signing,
   notarization, Gatekeeper, or Windows SmartScreen behavior.

Until that final gate is recorded, release notes must warn that an artifact is
unsigned and users must verify its source. No certificates, keys, tags, or
GitHub Releases are created by this task.

## Desktop replacement and migration

The Tauri app is the sole supported desktop release after cutover. The release
process must remove or disable the legacy Flutter desktop package rather than
requiring both applications to coexist. The Tauri app uses the isolated
application ID and credential namespace in [`security.md`](security.md). It
does not read, import, rewrite, or delete the Flutter SharedPreferences file or
Flutter keyring entry. Existing bookmarks remain in Linkding and need no
database migration.

On first Tauri launch, setup is explicit:

1. enter the Linkding URL again;
2. enter the API token again and test it;
3. choose display theme and text scale again.

The migration guide must explain that the old Flutter client stored its token
in SharedPreferences in plaintext and recommend rotating that token after
switching. Uninstall instructions must not promise to remove old preferences
or keychain entries; users must use the old app's clear operation or their OS
credential manager if they need to clean legacy state. A Tauri clear operation
only addresses the Tauri namespace and follows the partial-failure contract.

## Browser automation and native checks

The Tauri WebDriver documentation says the direct `tauri-driver` route supports
Windows and Linux but has no WKWebView driver tool for macOS; the embedded
WebDriver service is the macOS-capable route. Evidence:

- [Tauri 2 WebDriver testing](https://v2.tauri.app/develop/tests/webdriver/)
- [Tauri manual WebDriver setup](https://v2.tauri.app/develop/tests/webdriver/manual-setup/)

CI must investigate whether the embedded service and its macOS runner are
available to this project rather than assuming they are. Where native
automation is unavailable, the release checklist requires a documented manual
macOS check: install/open the arm64 and x86_64 bundles on real matching hosts,
exercise setup, keychain save/read/clear, external URL open, quit/relaunch, and
capture pass/fail evidence without recording secrets.

## Version and tag gates

The existing Flutter workflow triggers on `v*.*.*`. Because the owner wants a
single whole-project release, do not create a desktop-only `v` tag and do not
create any tag while that workflow would publish the wrong artifacts.

Before the first release:

1. implement and validate the Tauri build matrix;
2. update the release workflow so the Tauri replacement is the sole supported
   desktop release and replaces the Flutter desktop release behavior;
3. verify that the final version is `2.0.0` in every shipped manifest;
4. run all PR, contract, browser/accessibility, and OS/native gates;
5. obtain explicit owner approval to publish.

Candidate builds use branch/workflow-dispatch artifacts or a namespace that
does not match `v*.*.*`; no candidate tag is required. After the workflow has
been replaced and the cutover gate is approved, the single project release may
use `v2.0.0`. This task does not create it.

## Release blockers

The following are intentionally open until delivery evidence exists:

- Tauri 2/npm/Rust versions and exact package metadata are pinned by F01;
- Linux AppImage/deb, Windows NSIS, and both macOS architecture builds are
  produced and inspected;
- native Keychain, Credential Manager, and Secret Service behavior is tested;
- macOS embedded automation availability is determined and manual fallback is
  recorded;
- signing/notarization availability or an explicit owner-approved unsigned
  public-release policy is recorded;
- the whole-project pipeline replaces the current Flutter-only release
  behavior with the Tauri desktop replacement without publishing a partial
  release.

No item above is treated as passed merely because the platform or a GitHub
runner is listed in documentation.
