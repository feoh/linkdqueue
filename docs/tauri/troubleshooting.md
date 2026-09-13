# Desktop troubleshooting

Use the status shown in Settings and the safe error code when reporting a
problem. Never include an API token, authorization header, keyring value, full
server response, or untrusted bookmark text in diagnostics.

## Setup and connection

| Symptom                             | Action                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| First launch shows setup            | Enter the Linkding URL and token manually, test the connection, then save.                                                                   |
| Authentication failed               | Check the canonical URL and token in Linkding, then re-enter both. The token is never read back into the UI.                                 |
| Invalid base URL                    | Use an absolute `https://` URL without credentials, query, or fragment. Preserve a reverse-proxy path, but remove only trailing slashes.     |
| HTTP rejected                       | HTTPS is the default. Enable the explicit warning only for an approved local/private self-hosted endpoint. TLS verification remains enabled. |
| Credential missing                  | Re-enter the token and save a new connection. The app does not recover it from plaintext preferences.                                        |
| Credential store locked/unavailable | Unlock/start the OS credential service and retry. On Linux, use an unlocked Secret Service provider such as GNOME Keyring or KWallet.        |

A new connection invalidates old in-memory requests and drafts. A late result
from the old connection is discarded. In-flight writes may already have
reached the old server, so changing or clearing a connection warns about that
possibility and does not claim cancellation.

## Lists and mutations

Use Refresh after a confirmed archive, read-state, tag, or delete mutation.
The app resets affected pagination after a confirmed mutation because offsets
may have shifted. A failed page keeps rows already displayed and provides a
retry action. A timeout during POST/PATCH/DELETE has unknown outcome: check
Linkding before retrying rather than assuming it failed or replaying it.

An edit dialog remains open when the server rejects the write. Correct the
input or connection and retry. A tag selection is not considered saved until
Linkding confirms the complete replacement.

External bookmark opening accepts only `http` and `https` URLs. `file:`,
`javascript:`, `data:`, custom schemes, credentials, and unexpected origins
are rejected; external content is opened by the native browser and never
loaded inside the app.

## Display and accessibility

Settings remains available from the sidebar after setup. If text is too large,
choose a smaller supported scale from Settings or resize the window; essential
controls must remain keyboard reachable at 200%. Use the app's normal theme
controls rather than editing preference files by hand.

## Recovery after Clear

Clear disconnects the current process before attempting persistent cleanup.

- `durable` success means the disconnected marker and credential deletion both
  completed.
- A pending-cleanup warning means retry Clear after the credential service is
  available.
- A preferences-write warning means the process is disconnected, but restart
  safety still needs recovery.
- `old_state_may_return` means both persistent guarantees could not be made;
  do not assume the old saved connection is erased. Keep the app disconnected,
  retry cleanup, and use the OS credential manager if necessary.

A successful durable clear prevents reconnecting after restart. It never
removes Flutter preferences or credentials.

## Development diagnostics

From a clean checkout, run the commands in
[`development.md`](development.md). The local unit and browser suites use fake
bridges, fake credentials, and loopback fixtures. The ignored disposable
Linkding test requires the CI harness and is not a local pass. Native keyring,
installer, signing, WebView2, and cross-OS checks must be recorded separately;
do not replace missing evidence with a skipped green test.
