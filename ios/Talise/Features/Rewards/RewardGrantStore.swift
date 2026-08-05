import Foundation
import SwiftUI

/// The user's pending gift, and the claim that opens it.
///
/// The server owns every bit of state that matters: `GET /api/rewards/grant`
/// returns only this user's unopened gift, and the claim POST is the sole thing
/// that moves money. Keeping "unclaimed" server-side means a gift opened on an
/// iPhone cannot be opened again on the web, and a reinstall does not replay it.
///
/// Reads fail silently — a gift is a delight, never a reason to interrupt an app
/// open. A failed CLAIM does surface, because the user asked for that one and
/// deserves to know it did not work.
@MainActor
@Observable
final class RewardGrantStore {
    struct Grant: Decodable, Equatable {
        let id: String
        let amountUsd: Double
        let reason: String
    }

    private struct Envelope: Decodable { let grant: Grant? }
    private struct ClaimAck: Decodable { let ok: Bool?; let amountUsd: Double?; let digest: String? }

    /// Non-nil when there is a gift to open. Drives the Home banner.
    var pending: Grant?
    /// Set by the banner tap. The sheet is deliberately NOT auto-presented:
    /// interrupting every app-open with a modal is worse news than the good
    /// news it carries, and an unclaimed gift is not urgent.
    var presenting = false
    var phase: RewardGiftSheet.Phase = .sealed
    var claimError: String?

    /// Guards a cold start where the initial task and the foreground handler
    /// both fire, which would otherwise present the same gift twice.
    private var inFlight = false

    func refresh() async {
        guard !inFlight, pending == nil else { return }
        inFlight = true
        defer { inFlight = false }
        guard let env: Envelope = try? await APIClient.shared.get("/api/rewards/grant") else { return }
        guard let g = env.grant, g.amountUsd > 0 else { return }
        pending = g
        phase = .sealed
        claimError = nil
    }

    /// Open the gift. The server locks the grant, pays from the treasury, and
    /// returns the settling digest; we only reveal the amount once that lands,
    /// so the reveal never promises money that did not move.
    func claim() async {
        guard let g = pending, phase == .sealed else { return }
        phase = .opening
        claimError = nil
        struct Body: Encodable { let id: String }
        do {
            let ack: ClaimAck = try await APIClient.shared.post(
                "/api/rewards/grant/claim", body: Body(id: g.id)
            )
            guard ack.ok == true else { throw APIError.invalidResponse }
            phase = .opened
        } catch APIError.status(let code, _) where code == 409 {
            // Already opened elsewhere. Not an error worth alarming anyone
            // about, the money is theirs either way.
            phase = .opened
        } catch {
            phase = .sealed
            claimError = "Couldn\u{2019}t open that just now. Try again."
        }
    }

    /// Close the sheet. The gift is only cleared once it has actually been
    /// opened; dismissing a SEALED gift just hides the sheet, so the banner
    /// stays on Home and nothing is lost by tapping away.
    func finish() {
        presenting = false
        if phase == .opened { pending = nil }
        phase = .sealed
        claimError = nil
    }
}
