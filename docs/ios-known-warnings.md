# iOS Console — Known Benign Warnings

These warnings appear in the iOS Talise app console output. They are emitted
by Apple system frameworks (UIKit, URLSession, RemoteTextInput) — not by
Talise code — and have no observable user impact. They are documented here so
the next on-call engineer doesn't waste a debugging cycle chasing them.

If any of these starts correlating with a real user-facing regression, file an
issue and re-investigate — until then, treat them as background noise.

## 1. `assistantHeight == 72` UIKit constraint conflict

**Example log line**

```
Unable to simultaneously satisfy constraints.
  ...
  "<NSLayoutConstraint:… 'assistantHeight' SystemInputAssistantView.height == 72>",
  "<NSLayoutConstraint:… 'assistantView.bottom' SystemInputAssistantView.bottom == _UIKBCompatInputView.top>",
  ...
```

**When it fires**: every time a `TextField` gains focus and the QuickType /
predictive input bar is briefly resized during the keyboard animation.

**Root cause**: Apple's `SystemInputAssistantView` (the QuickType bar above
the keyboard) holds a `height == 72` constraint at default priority and the
keyboard placeholder view briefly violates it during the transition. The
auto-layout engine resolves it on the next pass — the constraint conflict is
purely cosmetic in the log.

**Confirmation we are not the cause**: we ship no custom
`inputAccessoryView`, no `ToolbarItemGroup(placement: .keyboard)`, and no
`.keyboardLayoutGuide` usage anywhere under `ios/Talise/Features/`. The
warning fires identically on a stock SwiftUI `TextField` in an empty Xcode
project. Confirmed with `grep -rn "placement: .keyboard|inputAccessoryView|
keyboardToolbar|keyboardLayoutGuide" ios/Talise/Features` — returns zero
matches.

**Status**: benign. Filter via `Process == "Talise" && !message CONTAINS
"assistantHeight"` in Console.app if it gets noisy locally.

## 2. `nw_connection_copy_connected_local_endpoint_block_invoke [Cn] Connection has no local endpoint`

**When it fires**: during HTTP/2 connection reuse against `app.talise.io`,
typically right after a connection is created but before the local
endpoint resolution completes.

**Root cause**: Apple's `URLSession` / Network.framework internal log,
emitted when the connection's local endpoint isn't yet bound at the moment
the callback runs. Harmless — the request proceeds and resolves normally.

**Status**: benign. Filed under known Apple framework noise. Do not
suppress globally (other `nw_connection_*` logs are diagnostic).

## 3. `-[RTIInputSystemClient remoteTextInputSessionWithID:performInputOperation:] perform input operation requires a valid sessionID`

**When it fires**: on `TextField` focus changes during a SwiftUI view
transition (e.g. navigating to/from the Send screen while a field is the
first responder).

**Root cause**: the Remote Text Input subsystem briefly loses its session
ID during the focus / view transition handoff. Apple's input system retries
on the next runloop and the keystroke pipeline is unaffected.

**Status**: benign. Indistinguishable from the same warning emitted by a
stock SwiftUI text field in an isolated test app.

## 4. `Failed to send CA Event for app launch measurements`

**Example log line**

```
Failed to send CA Event for app launch measurements with error: …
Error Domain=BiomeAgentErrorDomain Code=…
```

**When it fires**: once per cold launch of the app, emitted before our
own `main` runs.

**Root cause**: Apple's CoreAnalytics / Biome telemetry pipeline can't
reach its on-device aggregation daemon during early launch (sandbox not
fully set up yet, or the daemon hasn't been brought up since boot). The
event is queued and retried by the OS — no observable effect on the
app's launch path.

**Confirmation we are not the cause**: we don't link CoreAnalytics, ship
no `os_log` calls with the `CA` subsystem, and reproduce the same line
identically in a stock SwiftUI single-window project. Apple framework
emits this; we can't suppress it from app code.

**Status**: benign. Filter via `process:Talise AND NOT message CONTAINS
"CA Event for app launch"` in Console.app.

## 5. `nw_connection_add_timestamp_locked_on_nw_queue [Cn] Hit maximum timestamp count, removing all timestamps`

**When it fires**: on long-lived HTTP/2 connections to `app.talise.io`
that have served many sequential requests (e.g. the
`.task`/`.refreshable` race in HomeView burning through a dozen GETs in
a few seconds).

**Root cause**: Network.framework keeps a bounded ring of per-connection
timestamps for its own RTT statistics. When the ring fills, it flushes
and logs this notice. Connection stays open and continues to serve
requests; the log is purely an internal "ring rotated" notification.

**Confirmation we are not the cause**: we don't drive
`NWConnection`/`Network.framework` directly — all networking goes
through `URLSession` (see `ios/Talise/Network/APIClient.swift`). The
warning is emitted by URLSession's underlying transport and is
indistinguishable from the same line in an isolated test app that just
hits any HTTPS endpoint repeatedly.

**Status**: benign. Cannot be fixed from app code. Filter via `NOT
message CONTAINS "Hit maximum timestamp count"`.

## Filtering tip for Console.app

To hide all five at once while keeping app-relevant logs visible:

```
process:Talise AND NOT message CONTAINS "assistantHeight"
              AND NOT message CONTAINS "nw_connection_copy_connected_local_endpoint"
              AND NOT message CONTAINS "remoteTextInputSessionWithID"
              AND NOT message CONTAINS "CA Event for app launch"
              AND NOT message CONTAINS "Hit maximum timestamp count"
```
