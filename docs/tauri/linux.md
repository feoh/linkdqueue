# Linux candidate artifacts

The Linux target is x86_64 with glibc 2.31 or newer. This is a candidate-build
configuration, not a public release or portability claim.

## Build

Use the pinned Node, Rust, and npm lockfiles from
[`development.md`](development.md) on Ubuntu 22.04 or a compatible Linux host:

```sh
cd desktop
npm ci
npm run build
npm run tauri -- build --bundles appimage,deb --ci
```

The Tauri configuration produces separate AppImage and `.deb` artifacts with
product name **Linkdqueue Desktop**, identifier
`com.feoh.linkdqueue.desktop`, and version `2.0.0`. The package metadata lists
the WebKitGTK, GTK, and Ayatana AppIndicator runtime libraries. The AppImage
does not bundle the media framework because this application has no media
content.

The non-publishing Linux CI job performs the same build, records SHA-256
checksums, inspects the AppImage as an x86_64 ELF payload and checks the deb
control metadata, then uploads those files only as workflow artifacts. It does
not create a tag, GitHub Release, or package-repository upload.

## Runtime prerequisites

For a native install, use a desktop session with WebKitGTK 4.1, GTK 3, and the
Ayatana AppIndicator runtime available. Linkdqueue's secure credential backend
also needs an unlocked Secret Service provider such as GNOME Keyring or KWallet
and a working session D-Bus. Installing a `libsecret` package alone does not
prove that a Secret Service provider is running or unlocked.

The Tauri app uses an isolated application identity and never imports the
Flutter app's preferences or credentials. No token or preference is embedded in
an artifact.

## Manual candidate check

On a clean x86_64 Ubuntu 22.04-or-newer desktop:

1. install the `.deb`, launch the bundled application, and confirm the window
   opens at the 800x600 minimum;
2. launch the AppImage and confirm it has the same identifier/version and no
   Flutter runtime assets;
3. exercise setup with a disposable Linkding account, including Secret Service
   save/read/clear and external browser opening;
4. quit and relaunch to check disconnected and configured states; and
5. uninstall the `.deb` and verify only the package is removed. Do not claim
   that uninstall removes Flutter preferences or legacy credentials.

These native and keyring checks belong to Q06/N05 acceptance evidence. A
successful Linux build alone does not pass them.
