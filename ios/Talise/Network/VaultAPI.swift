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
    /// and writes it onto the user row.
    ///
    /// Returns the optional `repoint` PTB. When non-nil, the user's
    /// `*.talise.sui` subname currently targets an address that ISN'T
    /// the new vault — caller MUST sign + sponsor-execute the PTB
    /// otherwise sends to `name@talise` keep landing in the wrong
    /// address and auto-swap never sees the deposits. Earlier this
    /// method decoded only `{ ok: Bool }` and silently discarded the
    /// repoint payload, leaving every migrated user with a stranded
    /// subname target.
    static func record(vaultId: String, digest: String) async throws -> VaultRecordResponse {
        try await APIClient.shared.post(
            "/api/vault/record",
            body: VaultRecordRequest(vaultId: vaultId, digest: digest)
        )
    }

    /// `POST /api/vault/migrate-bundle` — two-stage migration helper.
    /// Stage `"create-vault"` returns the same PTB as `/api/vault/create`;
    /// stage `"repoint"` returns the SuiNS `set_target_address` PTB
    /// the user must sign so `name@talise` resolves to their vault.
    /// 503s when the package isn't deployed; 200 + `bytesB64: nil` when
    /// the stage is a no-op (e.g. already-repointed or no subname).
    static func migrateBundle(stage: String) async throws -> MigrateBundleResponse {
        try await APIClient.shared.post(
            "/api/vault/migrate-bundle",
            body: MigrateBundleRequest(stage: stage)
        )
    }

    /// `POST /api/vault/migrate-confirm` — books a migration stage's
    /// digest server-side. Pair with `migrateBundle` after the user
    /// signs each returned PTB. `vaultId` only required for the
    /// `create-vault` stage.
    static func migrateConfirm(
        stage: String,
        digest: String,
        vaultId: String? = nil
    ) async throws {
        struct OK: Decodable { let ok: Bool }
        let _: OK = try await APIClient.shared.post(
            "/api/vault/migrate-confirm",
            body: MigrateConfirmRequest(
                stage: stage, vaultId: vaultId, digest: digest
            )
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

/// Common Sui coin type tags surfaced by the settings list. Only the
/// coins users can sensibly opt in for — USDsui is the DESTINATION
/// (you don't auto-swap USDsui → USDsui), so it's intentionally
/// absent. The earlier `usdsui` enum case had a placeholder type tag
/// that backend validation rejected with HTTP 400, surfacing as
/// "Couldn't read response from server" on the settings view.
enum AutoSwapSourceCoin: String, CaseIterable, Identifiable {
    case sui    = "0x2::sui::SUI"
    case usdc   = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"
    case usdt   = "0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN"

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
        }
    }

    /// SF Symbol for the row icon. Each maps to a quick visual handle
    /// — SUI gets the droplet, USDC/T the dollar disc.
    var iconName: String {
        switch self {
        case .sui:    return "drop.fill"
        case .usdc:   return "dollarsign.circle.fill"
        case .usdt:   return "dollarsign.circle.fill"
        }
    }

    /// Native on-chain decimals for this coin. The Move contract stores
    /// `AutoSwapCap.max_per_swap` as a u64 in the source coin's native
    /// units (e.g. MIST for SUI), so when the user types a fiat budget
    /// we must scale by 10^decimals — NOT a fixed 6 — to produce a cap
    /// that actually permits the swap. Hard-coding 6 here is the bug
    /// that turned a "₦250 cap" into ~0.000167 SUI on chain.
    var decimals: Int {
        switch self {
        case .sui:    return 9
        case .usdc:   return 6
        case .usdt:   return 6
        }
    }

    /// Whether this coin is a USD stable (USDC/USDT) — used to short-
    /// circuit the price lookup when computing the cap. Stables don't
    /// need an oracle hit; everything else does.
    var isStable: Bool {
        switch self {
        case .sui:    return false
        case .usdc:   return true
        case .usdt:   return true
        }
    }
}
