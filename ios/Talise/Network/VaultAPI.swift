import Foundation

/// Thin namespace over the `/api/vault/*` endpoints introduced for the
/// auto-swap feature (see `move/talise/AUTOSWAP.md`).
///
/// Every PTB-building method returns a `VaultCreatePrepareResponse`
/// containing base64'd transaction-kind bytes. Callers feed those bytes
/// to `ZkLoginCoordinator.shared.signAndSubmit(transactionKindB64:…)`
/// to get Onara-sponsored execution — identical pattern to Send / Earn.
///
/// `getState` is a plain GET — used by `AutoSwapSettings` to drive the
/// list of source coins + their cap status.
@MainActor
enum VaultAPI {
    /// `GET /api/vault/migration-status` — read-only snapshot used by
    /// the Home banner to decide whether to surface an upgrade CTA for
    /// users who pre-date the vault feature. Returns a "done" stub with
    /// 503 when the package isn't deployed yet; the client treats that
    /// as "no banner."
    static func migrationStatus() async throws -> VaultMigrationStatus {
        return try await APIClient.shared.get("/api/vault/migration-status")
    }

    /// `POST /api/vault/create` — prepares the PTB that mints a fresh
    /// `TaliseVault` shared object for the signed-in user. Backend
    /// hardwires the user's address as `owner`. After this PTB settles,
    /// call `record(vaultId:digest:)` so the backend persists the new
    /// vault id on the user row.
    static func createPrepare() async throws -> VaultCreatePrepareResponse {
        struct EmptyBody: Encodable {}
        return try await APIClient.shared.post(
            "/api/vault/create",
            body: EmptyBody()
        )
    }

    /// `POST /api/vault/record` — server-side persistence step that
    /// runs after the on-chain vault creation tx is confirmed. The
    /// backend resolves the vault id from the digest's object-changes
    /// and writes it onto the user row so future state reads can
    /// short-circuit the SuiNS lookup.
    static func record(vaultId: String, digest: String) async throws {
        struct OK: Decodable { let ok: Bool }
        let _: OK = try await APIClient.shared.post(
            "/api/vault/record",
            body: VaultRecordRequest(vaultId: vaultId, digest: digest)
        )
    }

    /// `POST /api/vault/enable-autoswap` — prepares the PTB that mints
    /// an `AutoSwapCap<T>` for the given source coin type. The cap is
    /// owned by the user; the worker's admin authority is enforced at
    /// `validate_for_swap` time, not here.
    static func enableAutoSwap(
        sourceType: String,
        maxPerSwap: String,
        expiresAtMs: UInt64
    ) async throws -> VaultCreatePrepareResponse {
        try await APIClient.shared.post(
            "/api/vault/enable-autoswap",
            body: VaultEnableAutoSwapRequest(
                sourceType: sourceType,
                maxPerSwap: maxPerSwap,
                expiresAtMs: expiresAtMs
            )
        )
    }

    /// `POST /api/vault/pause` — builds the PTB that flips the cap's
    /// `paused` flag to `true`. Doesn't burn the cap; resume flips it
    /// back. Use disable() when the user wants to revoke entirely.
    static func pauseAutoSwap(
        capId: String,
        sourceType: String
    ) async throws -> VaultCreatePrepareResponse {
        try await APIClient.shared.post(
            "/api/vault/pause",
            body: VaultCapMutationRequest(capId: capId, sourceType: sourceType)
        )
    }

    /// `POST /api/vault/resume` — companion to `pauseAutoSwap`. Flips
    /// `paused` back to false.
    static func resumeAutoSwap(
        capId: String,
        sourceType: String
    ) async throws -> VaultCreatePrepareResponse {
        try await APIClient.shared.post(
            "/api/vault/resume",
            body: VaultCapMutationRequest(capId: capId, sourceType: sourceType)
        )
    }

    /// `POST /api/vault/disable` — burns the cap. The user can re-enable
    /// later, but doing so mints a fresh cap with fresh bounds.
    static func disableAutoSwap(
        capId: String,
        sourceType: String
    ) async throws -> VaultCreatePrepareResponse {
        try await APIClient.shared.post(
            "/api/vault/disable",
            body: VaultCapMutationRequest(capId: capId, sourceType: sourceType)
        )
    }

    /// `GET /api/vault/state` — returns the user's vault (or nil if
    /// they haven't created one yet) plus every active cap. Drives the
    /// `AutoSwapSettings` view's whole render pass.
    static func getState() async throws -> VaultStateResponse {
        try await APIClient.shared.get("/api/vault/state")
    }
}

/// Common Sui coin type tags surfaced by the settings list. Order is
/// the same order they're rendered on screen — USDsui sits at the
/// bottom as the destination users are auto-converting INTO, so
/// surfacing it as a source is a no-op edge case but kept here for
/// completeness so the row reads "off / not applicable".
enum AutoSwapSourceCoin: String, CaseIterable, Identifiable {
    case sui    = "0x2::sui::SUI"
    case usdc   = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"
    case usdt   = "0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN"
    case usdsui = "USDSUI_PLACEHOLDER"

    var id: String { rawValue }

    /// Branded display name for the row. iOS doesn't introspect the
    /// type tag — the server is the source of truth for coin metadata
    /// (decimals, real type) — but these short labels are enough for
    /// the row to read clearly.
    var displayName: String {
        switch self {
        case .sui:    return "SUI"
        case .usdc:   return "USDC"
        case .usdt:   return "USDT"
        case .usdsui: return "USDsui"
        }
    }

    /// SF Symbol for the row icon. Each maps to a quick visual handle
    /// — SUI gets the droplet, USDC/T the dollar disc, USDsui the leaf
    /// that matches every other "the destination is yield" surface.
    var iconName: String {
        switch self {
        case .sui:    return "drop.fill"
        case .usdc:   return "dollarsign.circle.fill"
        case .usdt:   return "dollarsign.circle.fill"
        case .usdsui: return "leaf.fill"
        }
    }
}
