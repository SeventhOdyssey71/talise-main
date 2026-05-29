import SwiftUI
import CoreText
import UIKit
#if DEBUG
import ObjectiveC.runtime
#endif

@main
struct TaliseApp: App {
    @State private var session = AppSession()
    @Environment(\.scenePhase) private var scenePhase
    @State private var locked = false

    init() {
        #if DEBUG
        // KeyboardInputWarningMitigation.install() — REMOVED (2026-05-29).
        // The swizzle tried to silence the benign
        // "assistantHeight == 72" UIKit constraint warning, but
        // method_exchangeImplementations on UITextField/UITextView's
        // inherited didMoveToWindow swapped the IMP on the UIView
        // Method object, which is shared with EVERY UIView subclass —
        // including UIKit's private UITransitionView. At app launch
        // when UIKit created a UITransitionView and called
        // didMoveToWindow, dispatch went into our taliseDidMoveToWindow
        // selector, which UITransitionView does not implement →
        // NSInvalidArgumentException → crash. The warning is benign and
        // documented in docs/ios-known-warnings.md; we'd rather see it
        // in the console than crash the app.
        // Silence URLSession's chatty CFNetwork / Network.framework
        // logs in dev builds — specifically the
        //   `nw_connection_copy_connected_local_endpoint_block_invoke
        //    [C2] Connection has no local endpoint`
        // and friends that fire on every cancelled task. They're
        // harmless but they drown out our own `print` statements in
        // the Xcode console. `OS_ACTIVITY_MODE=disable` mutes the
        // os_log stream that those frames are emitted into.
        //
        // setenv must run BEFORE URLSession is instantiated (i.e.
        // before APIClient.shared is touched) for the system loggers
        // to pick it up. App `init()` is the earliest hook we have.
        setenv("OS_ACTIVITY_MODE", "disable", 1)
        #endif

        Self.registerFonts()
        #if DEBUG
        // Cross-check our pure-Swift BLAKE2b-256 against @noble/hashes
        // vectors at launch. A mismatch on any vector means the iOS
        // digest is wrong → sponsor-execute will reject the signature
        // with "Invalid signature was given to the function". Logged
        // (not asserted) so the app still launches and a developer
        // can see exactly which vector diverged.
        let failures = Blake2b.runSelfTest()
        if failures.isEmpty {
            if AppConfig.shared.verboseConsoleLogging {
                print("[zk] Blake2b self-test: OK")
            }
        } else {
            print("[zk] Blake2b self-test FAILED — signing will reject on chain:")
            for f in failures { print("    \(f)") }
        }
        #endif
    }

    var body: some Scene {
        WindowGroup {
            AppRoot()
                .environment(session)
                .task { await session.bootstrap() }
                .overlay {
                    if locked {
                        AppLockOverlay()
                            .transition(.opacity)
                    }
                }
                .onOpenURL { url in
                    // talise://auth/callback handled inside the
                    // ASWebAuthenticationSession completion. Reserved here
                    // for talise://pay/<handle>?amount=... in future.
                }
                .onChange(of: scenePhase) { _, newPhase in
                    switch newPhase {
                    case .background, .inactive:
                        locked = true
                    case .active:
                        locked = false
                    @unknown default:
                        break
                    }
                }
        }
    }

    /// Registers Google Sans Variable (bundled at Resources/GoogleSans).
    /// If the .ttf isn't present in dev, fonts fall back to SF Pro and the
    /// app still works.
    private static func registerFonts() {
        let names = ["GoogleSans-Variable.ttf"]
        for name in names {
            let parts = name.split(separator: ".")
            guard parts.count == 2,
                  let url = Bundle.main.url(forResource: String(parts[0]), withExtension: String(parts[1])) else {
                continue
            }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
}

// KeyboardInputWarningMitigation removed (2026-05-29). See the
// comment at the install() call site for the full rationale. The
// "assistantHeight == 72" warning is benign per
// docs/ios-known-warnings.md; the swizzle was crashing the app
// at launch because method_exchangeImplementations on an
// inherited Method swaps the IMP class-wide on UIView.

private struct AppLockOverlay: View {
    var body: some View {
        ZStack {
            TaliseColor.bg.ignoresSafeArea()
            VStack(spacing: 12) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 28, weight: .medium))
                    .foregroundStyle(TaliseColor.fgDim)
                Text("Talise")
                    .font(TaliseFont.heading(20))
                    .foregroundStyle(TaliseColor.fg)
            }
        }
    }
}
