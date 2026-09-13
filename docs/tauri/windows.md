# Windows x86_64 packaging

Status: implementation-phase configuration for N04. A hosted Windows build
and native install smoke test are required before this becomes release
evidence. No installer is published by this task.

## Target and identity

The CI job targets `x86_64-pc-windows-msvc` on `windows-2022` and builds only
an NSIS installer. The app identity is `Linkdqueue Desktop`, version `2.0.0`,
and `com.feoh.linkdqueue.desktop`, as recorded in
[`distribution.md`](distribution.md). ARM64 and MSI are intentionally out of
scope.

The job compiles the actual Windows credential backend before bundling. It
records the target-specific Cargo feature tree and checks for `keyring 3.6.3`
and `windows-sys`; the application therefore uses Windows Credential Manager
rather than a plaintext or file fallback. Tauri app configuration and the
credential namespace remain isolated from the legacy Flutter application.

## Installer policy

`desktop/src-tauri/tauri.conf.json` explicitly selects:

- NSIS `installMode: currentUser`, which avoids unnecessary administrator
  rights and stores installer metadata per user;
- WebView2 `downloadBootstrapper`, silently downloading the Evergreen
  bootstrapper only when WebView2 is missing.

A clean test host must have network access during installation when WebView2
is absent, or have the supported Evergreen WebView2 Runtime preinstalled.
Offline installation is not claimed. The installed app must be launched on a
Windows 10 1809-or-newer x86_64 host with and without a pre-existing WebView2
runtime, if both environments are available.

The CI inspection step parses the NSIS executable's PE header and requires
machine type `0x8664`, checks the file version begins with `2.0.0`, records the
Authenticode status, and emits a SHA-256 checksum. Candidate artifacts are
unsigned unless signing is later configured through owner-approved secret
references. Unsigned status and the expected SmartScreen warning must never
be described as a signed release.

## Required native evidence

The Windows job is a candidate-build gate, not a complete release gate. Q08
must additionally install and uninstall the candidate on a clean Windows
host, confirm no unnecessary elevation, launch/relaunch the app, exercise
Credential Manager save/read/clear and external URL opening, and verify that
legacy Flutter preferences are neither imported nor removed. It must record
WebView2 setup, architecture, version, signing status, and pass/fail results
without capturing credentials.

Signing, publication, registry cleanup, and release tags remain outside N04.
If the hosted job or a native clean-host check is unavailable, that is an
explicit release blocker rather than a green result.
