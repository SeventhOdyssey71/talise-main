import Foundation
import Observation

/// Parsed result of `window.taliseShieldBalance`: the claimable shielded sum in
/// micros plus the COUNT of unspent notes (each ≈ one private receipt). Accepts
/// both the JSON shape `{"micros":"..","notes":N}` and a bare micros number, so
/// it works whether or not the newer web harness is deployed.
struct ShieldBalanceInfo {
    let micros: UInt64
    let notes: Int

    static let zero = ShieldBalanceInfo(micros: 0, notes: 0)

    static func parse(_ raw: String) -> ShieldBalanceInfo {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("{"),
           let data = trimmed.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            let micros = UInt64((obj["micros"] as? String) ?? "") ?? 0
            let notes = (obj["notes"] as? NSNumber)?.intValue ?? (obj["notes"] as? Int ?? 0)
            return ShieldBalanceInfo(micros: micros, notes: notes)
        }
        // Backward-compat: an older harness returns a bare micros string.
        let m = UInt64(trimmed) ?? 0
        return ShieldBalanceInfo(micros: m, notes: m > 0 ? 1 : 0)
    }
}

/// The RECEIVE side of private sends.
///
/// A private payment lands as a shielded NOTE the recipient owns in the pool —
/// their public balance does not move. This app-level state surfaces that: it
/// scans (client-side, server-blind) for claimable shielded balance, drives the
/// badge on the home logo, and sweeps the balance into the user's spendable
/// wallet on demand.
///
/// The scan + sweep both run through the same hidden shield-prove WebView the
/// send flow uses (`ShieldProverController`), created lazily so a user who never
/// touches private sends pays nothing for it.
@MainActor
@Observable
final class ShieldInbox {
    /// Claimable shielded balance, in micros (1e6 = $1).
    private(set) var pendingMicros: UInt64 = 0
    /// Number of unspent notes — the badge count.
    private(set) var pendingCount: Int = 0
    private(set) var isRefreshing = false
    var isSweeping = false

    /// The webview-backed prover. Lazily created on first refresh/sweep so it is
    /// never loaded for users who don't use private sends.
    @ObservationIgnored private var prover: ShieldProverController?
    @ObservationIgnored private var lastRefresh: Date?

    var hasPending: Bool { pendingMicros > 0 }
    var pendingUsd: Double { Double(pendingMicros) / 1_000_000 }

    /// Cap the badge text so a big note count never blows the badge geometry.
    var badgeText: String { pendingCount > 9 ? "9+" : String(pendingCount) }

    private func ensureProver() -> ShieldProverController {
        if let p = prover { return p }
        let p = ShieldProverController()
        prover = p
        return p
    }

    /// Best-effort background refresh. Silent on every failure (no badge churn,
    /// no error surfaced). Throttled so app-foreground bursts don't rescan.
    func refresh(force: Bool = false) async {
        // Never scan while a sweep is mid-flight: both drive the single shared
        // prover, and overlapping ops would clobber each other's continuation.
        if isRefreshing || isSweeping { return }
        if !force, let last = lastRefresh, Date().timeIntervalSince(last) < 20 { return }
        isRefreshing = true
        defer { isRefreshing = false }

        let seed = await ShieldKeyStore.noteMasterHex()
        guard !seed.isEmpty else { return }
        let prover = ensureProver()

        // The prover's WebView loads the shield-prove harness async; a fresh
        // prover may not have installed `window.taliseShieldBalance` yet. Retry a
        // few times with backoff, then give up quietly.
        for attempt in 0..<6 {
            do {
                let info = try await prover.shieldedBalance(seedHex: seed)
                pendingMicros = info.micros
                pendingCount = info.notes
                lastRefresh = Date()
                return
            } catch {
                if attempt < 5 {
                    try? await Task.sleep(nanoseconds: 1_200_000_000)
                }
            }
        }
    }

    /// Sweep ALL claimable shielded balance into `address` (the user's own
    /// wallet). Returns the withdraw digest. Refreshes after, clearing the badge.
    func sweep(to address: String) async throws -> String {
        isSweeping = true
        let seed = await ShieldKeyStore.noteMasterHex()
        do {
            let digest = try await ensureProver().recover(seedHex: seed, destination: address)
            isSweeping = false          // clear BEFORE the refresh so it isn't skipped
            await refresh(force: true)  // swept notes are now spent → badge clears
            return digest
        } catch {
            isSweeping = false
            throw error
        }
    }
}
