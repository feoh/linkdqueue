# Migrating from the Flutter client

The Tauri application is a replacement that coexists with the Flutter client
while implementation and acceptance proceed. It uses the new application ID
`com.feoh.linkdqueue.desktop` and the native credential namespace
`com.feoh.linkdqueue.desktop.v1`. It does not read, import, rewrite, or delete
Flutter preferences or Flutter keyring entries.

## What moves and what does not

Bookmarks remain in Linkding, so there is no bookmark database migration. The
server remains the source of truth. The following values must be entered again
in the desktop replacement:

1. the canonical Linkding URL, including any reverse-proxy path;
2. the API token, which is tested and then stored in the OS credential store;
3. the display theme and text scale.

The replacement has one Linkding connection and does not import a legacy
account automatically. Keep the Flutter app installed until desktop
acceptance and rollback checks are complete. Rollback means returning to the
Flutter app; it does not mean copying preferences between applications.

## Legacy token warning

The old client stored its token in Flutter `SharedPreferences`, which may have
left plaintext credentials on disk. The desktop app cannot safely determine
where every legacy installation stored its data and therefore never imports or
deletes it. After confirming that the replacement works, rotate the Linkding
token through Linkding and enter the new token in the desktop app. Do not paste
a token into an issue, log, screenshot, support recording, or shell history.

Uninstalling either application is not proof that the other application's
preferences or credentials were removed. Use the old app's own clear operation
or the relevant OS preference/credential manager if legacy cleanup is needed.
The desktop Clear operation only addresses the Tauri namespace. A failed
native deletion is shown as incomplete and must be retried; it is never
reported as successful erasure.

## First run and reconnect

On first launch, complete setup from Settings. HTTPS is required by default.
HTTP is accepted only when explicitly enabled for localhost, loopback, private,
link-local, or another approved local self-hosted address; the warning is
persisted with the connection. TLS certificate and hostname verification are
never disabled. Reverse-proxy paths are preserved, while credentials, query
strings, and fragments in the base URL are rejected.

If setup reports authentication failure, re-enter the token and verify the
server URL. If the native credential store is locked or unavailable, unlock or
start the OS credential service and retry. There is no plaintext fallback.

## Cutover and rollback checklist

- Confirm the desktop candidate was obtained from the intended non-public CI
  run and note its version, architecture, and signing status.
- Enter the URL and token manually; verify a queue and an archived bookmark.
- Confirm that tags and bookmarks are still present on the Linkding server.
- Exercise an external bookmark open and confirm it uses the system browser.
- Verify Settings, Clear, restart, and reconnect behavior without recording a
  token.
- Keep the Flutter installation untouched until the owner authorizes cutover.

Mobile integration, offline storage/sync, embedded reading, tray/background
sync, auto-update, multi-account, bulk operations, and global tag CRUD are not
part of this migration.
