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

## Filtering tip for Console.app

To hide all three at once while keeping app-relevant logs visible:

```
process:Talise AND NOT message CONTAINS "assistantHeight"
              AND NOT message CONTAINS "nw_connection_copy_connected_local_endpoint"
              AND NOT message CONTAINS "remoteTextInputSessionWithID"
```
