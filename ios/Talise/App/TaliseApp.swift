import SwiftUI
import CoreText
import UIKit
import UserNotifications
#if DEBUG
import ObjectiveC.runtime
#endif

@main
struct TaliseApp: App {
    @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate
    @State private var session = AppSession()
    /// RECEIVE side of private sends — scans for claimable shielded notes and
    /// drives the home-logo badge. Lazy internals, so it costs nothing until used.
    @State private var shieldInbox = ShieldInbox()
    /// Pending treasury reward, if any. Fetched per-user, so the sheet only
    /// ever appears on a beneficiary's device.
    @State private var rewards = RewardGrantStore()
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

        // Roomier shared cache so remote images (market logos, avatars) persist
        // to disk and are already there on the next view — no re-fetch flash.
        URLCache.shared = URLCache(memoryCapacity: 24 * 1024 * 1024,
                                   diskCapacity: 200 * 1024 * 1024)

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
                .environment(shieldInbox)
                .environment(rewards)
                .task {
                    // app_open on launch — the keystone retention event. One
                    // per 30-min session window, so this is free on re-entry.
                    Growth.shared.appOpen()
                    await session.bootstrap()
                }
                .overlay {
                    if locked {
                        AppLockOverlay()
                            .transition(.opacity)
                    }
                }
                // The gift. A fullScreenCover presents ABOVE the privacy
                // overlay, so it is gated on `!locked` rather than z-order:
                // otherwise a backgrounded phone would show someone's reward on
                // the app-switcher card.
                //
                // Hiding on lock must NOT consume the gift. The setter only
                // clears on a real user action; a lock just stops presenting
                // and the sheet returns on unlock.
                .fullScreenCover(
                    isPresented: Binding(
                        get: { rewards.presenting && rewards.pending != nil && !locked },
                        set: { shown in
                            if !shown && !locked { rewards.finish() }
                        }
                    )
                ) {
                    if let g = rewards.pending {
                        RewardGiftSheet(
                            reason: g.reason,
                            amountText: TaliseFormat.local2(g.amountUsd),
                            phase: rewards.phase,
                            errorText: rewards.claimError,
                            onClaim: { Task { await rewards.claim() } },
                            onDone: { rewards.finish() }
                        )
                    }
                }
                .onOpenURL { url in
                    // talise://auth/callback is handled inside the
                    // ASWebAuthenticationSession completion. Here we route
                    // cheque deep links: talise://c/<id>#<secret>.
                    DeepLink.route(url)
                }
                // Universal links: https://(www.)talise.io/c/<id>#<secret>.
                // Same routing as the custom scheme.
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { DeepLink.route(url) }
                }
                .onChange(of: scenePhase) { _, newPhase in
                    switch newPhase {
                    case .background:
                        // Fully left the app — arm the 60s session timer and
                        // show the privacy lock.
                        locked = true
                        session.appDidEnterBackground()
                        // Push the queued events out before iOS suspends us,
                        // otherwise the last events of every session (i.e. the
                        // drop-off signal) are lost.
                        Growth.shared.flush()
                    case .inactive:
                        // Transient (app switcher, notification pull) — lock the
                        // screen but don't arm the timer.
                        locked = true
                    case .active:
                        // Returned — drop the session if it sat backgrounded past
                        // the grace window (→ fresh sign-in + fresh proof).
                        session.appWillEnterForeground()
                        locked = false
                        // A return after >30 idle minutes is a new session and
                        // therefore a new app_open; inside the window it no-ops.
                        Growth.shared.appOpen()
                        // Re-scan for claimable private receipts on return — but
                        // ONLY when signed in. The scan reaches the note-master
                        // store, which mints + pins a NEW master if the keychain
                        // is empty and the escrow read fails. Unauthenticated the
                        // escrow GET 401s, so scanning while signed out (this
                        // fires during the OAuth round-trip) would mint a second
                        // master and permanently orphan any existing shielded
                        // notes on this device.
                        if case .ready = session.phase {
                            Task { await shieldInbox.refresh() }
                            // Reconcile the cached user with the server. The
                            // snapshot is only written at sign-in, so anything
                            // that changes afterwards (most visibly a handle
                            // claimed on the web) stayed stale on the device
                            // until the next full sign-out. Quiet and best
                            // effort: a failure keeps the current user.
                            Task { await session.refreshUser() }
                            // Cheap per-user read; returns null for everyone
                            // who has not been rewarded.
                            Task { await rewards.refresh() }
                        }
                    @unknown default:
                        break
                    }
                }
                .onChange(of: session.phase) { _, newPhase in
                    // Register for push + sync the device token once the user
                    // is signed in, so /api/devices/register carries a bearer.
                    // Idempotent — safe to fire on every transition to ready.
                    if case .ready = newPhase {
                        PushRegistrar.shared.register()
                        PushRegistrar.shared.syncIfNeeded()
                        // Covers the sign-in path: `.active` already fired
                        // before the session became ready, so without this a
                        // fresh sign-in would not see a waiting reward until
                        // the next foreground.
                        Task { await rewards.refresh() }
                    }
                }
        }
    }

    /// Registers DM Sans Variable (bundled at Resources/DMSans/) so
    /// `TaliseFont.displayFamily = "DM Sans"` resolves. If the .ttf is
    /// missing the call quietly no-ops and fonts fall back to SF Pro —
    /// useful in dev when the asset hasn't been pulled.
    private static func registerFonts() {
        let names = ["DMSans-Variable.ttf"]
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

// MARK: - Push notifications

/// Requests APNs authorization, registers for remote notifications, and syncs
/// the device token to the backend (`POST /api/devices/register`). Push
/// DELIVERY is server-gated on the Talise APNs credentials — this side just
/// gets permission, the token, and hands it to the server.
final class PushRegistrar {
    static let shared = PushRegistrar()
    private init() {}

    /// Latest APNs device token (hex), set by the app delegate callback.
    private(set) var lastToken: String?

    /// Request notification authorization (the system prompts only once) and
    /// register for remote notifications. Idempotent — safe to call on every
    /// transition to `.ready`.
    func register() {
        UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                DispatchQueue.main.async {
                    // Push reachability: the opt-in rate was previously only
                    // inferable from `device_token` rows, which can't tell a
                    // denial from a token that never synced.
                    Growth.shared.track(granted ? .pushPermissionGranted : .pushPermissionDenied)
                    guard granted else { return }
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
    }

    /// Called from the app delegate when APNs hands us a token. Stores it and
    /// POSTs it (best-effort; APIClient attaches the bearer when signed in).
    func didReceive(deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        lastToken = hex
        Task { await sync(token: hex) }
    }

    /// Re-POST the last-known token (e.g. right after sign-in completes, when
    /// a token captured pre-auth can finally be associated with the account).
    func syncIfNeeded() {
        guard let t = lastToken else { return }
        Task { await sync(token: t) }
    }

    private func sync(token: String) async {
        struct Body: Encodable { let token: String; let platform: String }
        struct Ack: Decodable { let ok: Bool? }
        do {
            let _: Ack = try await APIClient.shared.post(
                "/api/devices/register",
                body: Body(token: token, platform: "ios")
            )
        } catch {
            // Best-effort: a 401 before sign-in is expected; we re-sync on ready.
        }
    }
}

/// Minimal app delegate purely to receive the APNs device-token callbacks
/// (SwiftUI's App lifecycle doesn't surface them).
final class PushAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        PushRegistrar.shared.didReceive(deviceToken: deviceToken)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        #if DEBUG
        print("[push] APNs registration failed: \(error.localizedDescription)")
        #endif
    }
}
