import Foundation
import Observation

/// Server-driven verdict for "is fiat funding open for this environment?".
///
/// Mirrors `GET /api/onramp/config` (web/app/api/onramp/config/route.ts), which
/// is driven by the single `ONRAMP_ENABLED` env var. iOS, Android and web all
/// read the SAME endpoint, so funding can be switched on per-environment with no
/// app release and no redeploy — replacing the compile-time `RampFlags` booleans
/// that used to hard-code the answer here.
struct OnrampConfig: Codable, Sendable, Equatable {
    /// The only field a screen should branch its primary flow on.
    let enabled: Bool
    /// "bridge" | "transak".
    let provider: String
    /// Provider credentials present server-side.
    let configured: Bool
    /// "switch_off" | "provider_unconfigured" | nil.
    let closedReason: String?
    /// "bank" (virtual account to wire to) | "widget" (hosted checkout).
    let funding: String
    /// "USDC" | "USDSUI" — what actually lands on the user's Sui address.
    let deliverAsset: String
    /// True when a USDC → USDsui conversion is needed after funds land.
    let requiresSwapToUsdsui: Bool

    /// FAIL-CLOSED default. Used before the first load and after any failure —
    /// we never assume funding is open on a network hiccup.
    static let closed = OnrampConfig(
        enabled: false,
        provider: "bridge",
        configured: false,
        closedReason: "switch_off",
        funding: "bank",
        deliverAsset: "USDC",
        requiresSwapToUsdsui: true
    )

    /// True when the on-ramp is open AND funds land via bank coordinates
    /// (Bridge virtual account) rather than a hosted widget.
    var bankFundingOpen: Bool { enabled && funding == "bank" }
}

/// Shared cache for `OnrampConfig`, mirroring the `CopilotSkin.shared` pattern
/// used elsewhere in the app. Re-fetch with `load(force: true)` on screen entry
/// so a server-side flip lands without an app relaunch (the endpoint is
/// `no-store` and returns nothing user-specific, so it is cheap).
@Observable
final class OnrampConfigStore {
    static let shared = OnrampConfigStore()
    private init() {}

    /// Fail-closed until the server has actually said otherwise.
    private(set) var config: OnrampConfig = .closed
    /// False until the first attempt finishes, so screens can show a neutral
    /// "checking…" state instead of flashing "not available".
    private(set) var loaded = false

    @MainActor
    func load(force: Bool = false) async {
        if loaded && !force { return }
        do {
            config = try await APIClient.shared.get("/api/onramp/config")
        } catch {
            // 401 / offline / 5xx → stay closed. Better a user told "not yet"
            // than one walked into a flow that dead-ends.
            config = .closed
        }
        loaded = true
    }
}
