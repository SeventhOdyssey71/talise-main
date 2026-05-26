import SwiftUI

/// Always-hold-USDsui settings screen. The user opts in once (mints
/// their `TaliseVault`), then toggles auto-conversion on/off per coin
/// type. See `move/talise/AUTOSWAP.md` for the full architecture.
///
/// Visual language mirrors `EarnView` — eyebrow + title header, glass
/// status card, then a list of per-coin rows. Each row is either:
///   • "off" — tap "Enable" to open `AutoSwapEnableSheet`.
///   • "active" — shows the configured cap, plus inline Pause/Resume
///     and Disable buttons.
struct AutoSwapSettings: View {
    @Environment(\.dismiss) private var dismiss

    @State private var state: VaultStateResponse?
    @State private var migration: VaultMigrationStatus?
    /// Snapshot of `/api/balances` — only used here for `suiPriceUsd`
    /// so the per-row cap labels can render the configured SUI cap in
    /// the user's display currency (otherwise SUI rows would read in
    /// raw SUI units, which looks broken next to USDC/USDT rows).
    @State private var balances: BalancesDTO?
    @State private var loading = true
    @State private var syncingSubname = false
    /// Per-row in-flight cap mutation (pause/resume/disable). Keyed by
    /// `capId` so two simultaneous rows can't share the spinner.
    @State private var pendingCapId: String?
    /// Set when the user taps "Enable" on a row — drives the modal
    /// sheet. Identifiable so SwiftUI's `.sheet(item:)` can present.
    @State private var enableTarget: AutoSwapSourceCoin?
    @State private var error: String?
    /// Server-confirmed success digest for the latest mutation — used
    /// by the inline success banner.
    @State private var success: String?
    /// True while the create-vault PTB is in flight. The vault status
    /// card disables its CTA while this is set.
    @State private var creatingVault = false
    /// True while a `share_existing_cap` PTB is in flight, gated to a
    /// single cap at a time. Keyed by `capId` so the spinner sticks to
    /// the row being migrated.
    @State private var migratingCapId: String?
    /// True while the "Migrate all" banner action is iterating through
    /// every user-owned cap. Disables both the banner CTA and the per-
    /// row CTAs to avoid double-fire.
    @State private var migratingAll = false
    /// True while the one-tap "Enable all coins" PTB is in flight. Drives
    /// the inline default-caps banner — when set we swap the CTA copy
    /// for a spinner so the user knows the round-trip is alive.
    @State private var enablingDefaults = false

    // MARK: - Optimistic state (Bug A fix)
    //
    // After a successful pause/resume/disable PTB lands, `load()` refetches
    // the chain state — but the fullnode isn't always indexed yet, so the
    // refresh can briefly return the PRE-mutation state and flip the row
    // back to its old paused/active value before the next poll corrects it.
    // The user sees a visible flicker. We hold the freshly-mutated value
    // authoritative for ~3 seconds and ignore conflicting server state in
    // that window.
    @State private var optimisticPauseState: [String: Bool] = [:]
    @State private var optimisticDisabled: [String: Bool] = [:]
    @State private var optimisticUntil: [String: Date] = [:]
    private static let optimisticHoldSeconds: TimeInterval = 3

    /// Bug B fix — track the most recent `load()` task so we can cancel
    /// stale ones. Two near-simultaneous `load()` calls (e.g. sheet
    /// dismiss + an explicit refetch) could otherwise resolve out of order
    /// and let the older response overwrite the newer one.
    @State private var loadTask: Task<Void, Never>?

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 22) {
                header
                if allCapsNeedMigration {
                    migrateAllBanner
                }
                vaultStatusCard
                if hasVault {
                    if missingDefaultCaps {
                        enableDefaultsBanner
                    }
                    coinList
                }
                if let error {
                    Text(error)
                        .font(TaliseFont.body(12, weight: .light))
                        .foregroundStyle(TaliseColor.danger)
                }
                if let success {
                    successBanner(success)
                }
                Spacer(minLength: 120)
            }
            .padding(.horizontal, 24)
            .padding(.top, 24)
        }
        .refreshable { await load() }
        .taliseScreenBackground()
        .task { reload() }
        .onDisappear { loadTask?.cancel() }
        .sheet(item: $enableTarget) { source in
            AutoSwapEnableSheet(source: source) {
                // Refetch state so the row flips to "active" + the
                // success banner reads the digest on the next pass.
                // Use `reload()` (not bare `Task { load() }`) so an
                // older in-flight load can't land after this one and
                // clobber the freshly-enabled row.
                reload()
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            MicroLabel(text: "AUTO-SWAP", color: TaliseColor.fgDim).kerning(1.5)
            Text("Always hold USDsui.")
                .font(TaliseFont.heading(24, weight: .medium))
                .kerning(-1)
                .foregroundStyle(TaliseColor.fg)
            Text("Anyone can send any coin to your @talise handle — we auto-convert it to USDsui. Gas sponsored by Onara, no per-swap signature.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
        }
    }

    // MARK: - Vault status card

    private var hasVault: Bool { state?.vault != nil }

    private var vaultStatusCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    MicroLabel(text: "Vault", color: TaliseColor.fgDim).kerning(1.5)
                    Text(vaultStatusTitle)
                        .font(TaliseFont.heading(18, weight: .medium))
                        .kerning(-0.4)
                        .foregroundStyle(TaliseColor.fg)
                }
                Spacer()
                Image(systemName: hasVault ? "checkmark.seal.fill" : "tray")
                    .font(.system(size: 22, weight: .medium))
                    .foregroundStyle(hasVault ? TaliseColor.accent : TaliseColor.fgMuted)
            }

            if hasVault, let v = state?.vault {
                LiquidGlassDivider()
                vaultBalanceRows(v)
                if needsRepoint {
                    LiquidGlassDivider()
                    repointWarning
                }
            } else if !loading {
                // Pre-vault state — explain what creating one does and
                // offer the single CTA. Keeps the surface mostly empty
                // so the user's eye lands on "Create vault".
                Text("Mint a single shared vault that holds your balances. Every coin you receive gets routed here so auto-swap can convert it for you.")
                    .font(TaliseFont.body(12, weight: .light))
                    .foregroundStyle(TaliseColor.fgDim)
                    .fixedSize(horizontal: false, vertical: true)
                createVaultButton
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .taliseGlass(cornerRadius: 22)
    }

    /// Inline warning + one-tap recovery for vaults whose @talise
    /// subname still targets an old address (typical for users who
    /// migrated through an earlier broken version of the create-vault
    /// flow that dropped the repoint PTB silently). Without this leg,
    /// every send to `name@talise` lands at the stale address and
    /// auto-swap never picks it up.
    private var repointWarning: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(TaliseColor.accent)
                Text("Subname not pointing here")
                    .font(TaliseFont.heading(13, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
            }
            Text("Sends to your @talise handle still go to your old address. One tap to repoint them at the vault.")
                .font(TaliseFont.body(12, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: { Task { await syncSubname() } }) {
                Text(syncingSubname ? "Repointing…" : "Sync subname")
                    .font(TaliseFont.heading(13, weight: .medium))
                    .foregroundStyle(TaliseColor.bg)
                    .frame(maxWidth: .infinity)
                    .frame(height: 42)
                    .background(TaliseColor.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(syncingSubname)
        }
    }

    private var vaultStatusTitle: String {
        if loading { return "Loading…" }
        if hasVault { return "Active" }
        return "Not set up"
    }

    /// "USDsui · $12.40" style rows — one per balance entry in the bag.
    /// Limited to the first four so a verbose vault doesn't push the
    /// coin list off-screen.
    private func vaultBalanceRows(_ v: VaultDTO) -> some View {
        VStack(spacing: 10) {
            ForEach(v.balances.prefix(4)) { b in
                HStack {
                    Text(shortCoinLabel(b.coinType))
                        .font(TaliseFont.mono(11, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted)
                    Spacer()
                    Text(b.amount)
                        .font(TaliseFont.heading(13, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
            }
            if v.balances.count > 4 {
                HStack {
                    Spacer()
                    Text("+\(v.balances.count - 4) more")
                        .font(TaliseFont.mono(10, weight: .light))
                        .foregroundStyle(TaliseColor.fgDim)
                }
            }
        }
    }

    /// Strip the module path off `0x….usdc::USDC` and surface the
    /// trailing struct name. Server's coin-metadata table is the real
    /// source of truth — this is just a cosmetic hint.
    private func shortCoinLabel(_ coinType: String) -> String {
        coinType.split(separator: ":").last.map(String.init) ?? coinType
    }

    private var createVaultButton: some View {
        Button(action: { Task { await createVault() } }) {
            HStack(spacing: 10) {
                if creatingVault {
                    ProgressView().tint(TaliseColor.bg)
                }
                Text(creatingVault ? "Creating vault…" : "Create vault")
                    .font(TaliseFont.heading(15, weight: .medium))
            }
            .foregroundStyle(TaliseColor.bg)
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(creatingVault
                        ? TaliseColor.fg.opacity(0.35)
                        : TaliseColor.fg)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(creatingVault)
        .padding(.top, 4)
    }

    // MARK: - Coin list

    /// One row per common source coin. The "is this coin enabled?"
    /// check is a linear scan over `state.caps` — the list is small
    /// (≤8 coins in practice), so the cost is negligible and we don't
    /// have to build a dict on every render.
    private var coinList: some View {
        VStack(alignment: .leading, spacing: 12) {
            MicroLabel(text: "Source coins", color: TaliseColor.fgDim).kerning(1.5)
            VStack(spacing: 10) {
                ForEach(AutoSwapSourceCoin.allCases) { source in
                    coinRow(source)
                }
            }
        }
    }

    /// `cap(for:)` finds the matching `AutoSwapCap` (if any) for a
    /// source coin. Nil → row is "off"; non-nil → row renders the
    /// configured cap + Pause/Resume/Disable controls.
    private func cap(for source: AutoSwapSourceCoin) -> AutoSwapCapDTO? {
        state?.caps.first { $0.sourceType == source.rawValue }
    }

    /// True when a cap was optimistically disabled within the hold
    /// window — we hide the row so the user doesn't see it flicker
    /// back in before the chain catches up.
    private func isOptimisticallyDisabled(_ capId: String) -> Bool {
        guard let until = optimisticUntil[capId], until > Date() else {
            return false
        }
        return optimisticDisabled[capId] == true
    }

    /// Resolved paused state — prefers the optimistic value while inside
    /// its hold window, otherwise the server-reported value. See
    /// `optimisticPauseState` comment for the why.
    private func resolvedPaused(_ cap: AutoSwapCapDTO) -> Bool {
        if let until = optimisticUntil[cap.id], until > Date(),
           let optimistic = optimisticPauseState[cap.id] {
            return optimistic
        }
        return cap.paused
    }

    @ViewBuilder
    private func coinRow(_ source: AutoSwapSourceCoin) -> some View {
        if let cap = cap(for: source), !isOptimisticallyDisabled(cap.id) {
            enabledRow(source: source, cap: cap)
        } else {
            disabledRow(source: source)
        }
    }

    /// Row for a coin the user has NOT opted in for. Tapping "Enable"
    /// opens the `AutoSwapEnableSheet`.
    private func disabledRow(source: AutoSwapSourceCoin) -> some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().fill(TaliseColor.surface2).frame(width: 36, height: 36)
                Image(systemName: source.iconName)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(source.displayName)
                    .font(TaliseFont.heading(15, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                Text("Off")
                    .font(TaliseFont.mono(10, weight: .light))
                    .foregroundStyle(TaliseColor.fgDim)
            }
            Spacer()
            LiquidGlassPill(title: "Enable", tint: TaliseColor.accent) {
                enableTarget = source
            }
            .disabled(!hasVault)
        }
        .padding(14)
        .taliseGlass(cornerRadius: 18)
    }

    /// Row for a coin with an active `AutoSwapCap`. Shows the cap
    /// amount + paused/active badge, plus inline Pause/Resume +
    /// Disable controls.
    private func enabledRow(source: AutoSwapSourceCoin, cap: AutoSwapCapDTO) -> some View {
        // The on-chain `AutoSwapCap.max_per_swap` is a u64 in the source
        // coin's native decimals (9 for SUI, 6 for USDC/USDT). Recover
        // the human-tier coin amount by scaling down, then multiply by
        // the coin's USD price so we can render the cap in the user's
        // chosen display currency (matches what they typed when they
        // enabled the cap). For stables we short-circuit price=1.
        let scale = pow(10.0, Double(source.decimals))
        let coinAmount = cap.maxPerSwapDouble / scale
        let priceUsd: Double = source.isStable
            ? 1.0
            : (balances?.suiPriceUsd ?? 0)
        let capUsdHint = coinAmount * priceUsd
        let isPending = pendingCapId == cap.id
        // Caps that still need migration get their per-row CTA + visually
        // de-emphasize the pause/disable row so the user's eye lands on
        // the migrate action first.
        let needsMigration = cap.requiresMigration
        // Honor the optimistic-hold window (Bug A) — server may briefly
        // return stale state right after a successful pause/resume.
        let paused = resolvedPaused(cap)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill(TaliseColor.accent.opacity(paused ? 0.12 : 0.22))
                        .frame(width: 36, height: 36)
                    Image(systemName: source.iconName)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(paused
                                         ? TaliseColor.fgMuted
                                         : TaliseColor.accent)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(source.displayName)
                        .font(TaliseFont.heading(15, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                    HStack(spacing: 6) {
                        Circle()
                            .fill(paused ? TaliseColor.fgDim : TaliseColor.accent)
                            .frame(width: 6, height: 6)
                        Text(paused ? "Paused" : "Active")
                            .font(TaliseFont.mono(10, weight: .light))
                            .foregroundStyle(paused
                                             ? TaliseColor.fgDim
                                             : TaliseColor.accent)
                    }
                }
                Spacer()
                Text("Max \(TaliseFormat.local2(capUsdHint))")
                    .font(TaliseFont.mono(11, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
            }

            LiquidGlassDivider()

            HStack(spacing: 10) {
                LiquidGlassPill(
                    title: paused ? "Resume" : "Pause",
                    icon: paused ? "play.fill" : "pause.fill"
                ) {
                    Task {
                        if paused {
                            await mutate(cap: cap, action: .resume)
                        } else {
                            await mutate(cap: cap, action: .pause)
                        }
                    }
                }
                .disabled(isPending)

                // Destructive — keep red glyph + red text on top of a
                // danger-tinted glass capsule. LiquidGlassPill bakes in
                // white foreground, which would erase the destructive
                // affordance, so we use the danger-tinted glass
                // directly with a Button.
                Button {
                    Task { await mutate(cap: cap, action: .disable) }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .medium))
                        Text("Disable")
                            .font(TaliseFont.heading(13, weight: .medium))
                    }
                    .foregroundStyle(TaliseColor.danger)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(
                        Capsule().fill(.ultraThinMaterial)
                    )
                    .background(
                        Capsule().fill(TaliseColor.danger.opacity(0.12))
                    )
                    .overlay(
                        Capsule().stroke(TaliseColor.danger.opacity(0.45), lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
                .disabled(isPending)

                Spacer()
            }
            .opacity(needsMigration ? 0.55 : 1.0)

            if needsMigration {
                LiquidGlassDivider()
                migrateCapCTA(cap: cap)
            }
        }
        .padding(14)
        .taliseGlass(cornerRadius: 18)
    }

    // MARK: - Default caps (one-tap enable for SUI + USDC + USDT)

    /// True when the user has a vault but is missing an active (non-paused
    /// or paused — either counts as "exists") cap for any of the default
    /// source coins. Drives the one-tap "Enable all coins" banner — we
    /// want auto-swap to cover every coin a sender might use to pay this
    /// user, otherwise inbound USDC/USDT/SUI strands at the vault.
    ///
    /// Migration-pending caps still count as present here — they need a
    /// separate migrate action surfaced by the per-row CTA, and conflating
    /// the two banners would clutter the page.
    private var missingDefaultCaps: Bool {
        guard let caps = state?.caps else { return false }
        let owned = Set(caps.map { $0.sourceType })
        for source in AutoSwapSourceCoin.allCases where !owned.contains(source.rawValue) {
            return true
        }
        return false
    }

    /// Inline banner shown beneath the vault status card when one or more
    /// of the default source coins (SUI / USDC / USDT) doesn't yet have a
    /// cap. One tap mints all three via the
    /// `/api/vault/enable-default-caps` PTB — three MoveCalls in one
    /// transaction so the user signs once.
    private var enableDefaultsBanner: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(TaliseColor.accent)
                Text("Cover every coin")
                    .font(TaliseFont.heading(13, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
            }
            Text("Enable auto-swap for SUI, USDC, and USDT in one tap. Senders can pay you in any of them and we'll convert to USDsui automatically.")
                .font(TaliseFont.body(12, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: { Task { await enableDefaultCaps() } }) {
                HStack(spacing: 8) {
                    if enablingDefaults {
                        ProgressView().controlSize(.mini).tint(TaliseColor.bg)
                    }
                    Text(enablingDefaults ? "Enabling…" : "Enable all coins")
                        .font(TaliseFont.heading(13, weight: .medium))
                }
                .foregroundStyle(TaliseColor.bg)
                .frame(maxWidth: .infinity)
                .frame(height: 42)
                .background(enablingDefaults
                            ? TaliseColor.accent.opacity(0.5)
                            : TaliseColor.accent)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            .disabled(enablingDefaults)
        }
        .padding(14)
        .taliseGlass(cornerRadius: 16, tint: TaliseColor.accent)
    }

    /// Build → sign → sponsor-execute → refetch the one-tap default-caps
    /// PTB. After it settles, `load()` repopulates `state.caps` so the
    /// banner disappears and the SUI / USDC / USDT rows flip to Active.
    private func enableDefaultCaps() async {
        if enablingDefaults { return }
        enablingDefaults = true
        error = nil
        success = nil
        defer { enablingDefaults = false }
        do {
            let built = try await VaultAPI.enableDefaultCaps()
            let result = try await ZkLoginCoordinator.shared.signAndSubmit(
                transactionKindB64: built.bytesB64,
                intent: "Enable auto-swap for SUI, USDC, USDT",
                rewards: nil
            )
            success = result.digest
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Migration

    /// True when the user has at least one cap AND every cap returned by
    /// the server is flagged `needsMigration`. Drives the top-of-screen
    /// "Migrate all" banner — we suppress it the moment any cap is
    /// already shared, since piecemeal migration is the path forward
    /// once part of the inventory is on v3.
    private var allCapsNeedMigration: Bool {
        guard let caps = state?.caps, !caps.isEmpty else { return false }
        return caps.allSatisfy { $0.requiresMigration }
    }

    /// Inline banner at the top of the screen — shown only when every
    /// cap the user owns is still v2 user-owned. One tap kicks off a
    /// sequential migration over every cap. Matches the visual language
    /// of the in-card `repointWarning` (accent triangle, dim explainer,
    /// solid accent CTA) so the surface reads as part of the same
    /// system upgrade flow.
    private var migrateAllBanner: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(TaliseColor.accent)
                Text("Quick migration needed")
                    .font(TaliseFont.heading(13, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
            }
            Text("Auto-swap needs a quick migration to work with the new system. Tap to migrate all.")
                .font(TaliseFont.body(12, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: { Task { await migrateAllCaps() } }) {
                HStack(spacing: 8) {
                    if migratingAll {
                        ProgressView().controlSize(.mini).tint(TaliseColor.bg)
                    }
                    Text(migratingAll ? "Migrating…" : "Migrate all")
                        .font(TaliseFont.heading(13, weight: .medium))
                }
                .foregroundStyle(TaliseColor.bg)
                .frame(maxWidth: .infinity)
                .frame(height: 42)
                .background(migratingAll
                            ? TaliseColor.accent.opacity(0.5)
                            : TaliseColor.accent)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            .disabled(migratingAll)
        }
        .padding(14)
        .taliseGlass(cornerRadius: 16, tint: TaliseColor.accent)
    }

    /// Per-row migrate CTA shown beneath enabled rows whose cap is still
    /// v2 user-owned. Kept visually quiet (small accent capsule) — the
    /// banner above carries the loud copy. While the migrate PTB is in
    /// flight, the row's pause/disable controls are de-emphasized by the
    /// enabledRow body (it checks `migratingCapId`).
    private func migrateCapCTA(cap: AutoSwapCapDTO) -> some View {
        let isPending = migratingCapId == cap.id
        return VStack(alignment: .leading, spacing: 6) {
            Text("This auto-swap predates a system upgrade. Tap to migrate.")
                .font(TaliseFont.body(11, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                Task { await migrateCap(cap: cap) }
            } label: {
                HStack(spacing: 6) {
                    if isPending {
                        ProgressView().controlSize(.mini).tint(TaliseColor.accent)
                    } else {
                        Image(systemName: "arrow.triangle.2.circlepath")
                            .font(.system(size: 11, weight: .medium))
                    }
                    Text(isPending ? "Migrating…" : "Migrate")
                        .font(TaliseFont.heading(12, weight: .medium))
                }
                .foregroundStyle(TaliseColor.accent)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .overlay(
                    Capsule().stroke(TaliseColor.accent.opacity(0.5), lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
            .disabled(isPending || migratingAll)
        }
    }

    /// Migrate a single cap. Build → sign → sponsor-execute → refetch.
    /// Refuses to start when ANOTHER cap is already migrating (the
    /// `migrateAllCaps` loop drives that case sequentially).
    private func migrateCap(cap: AutoSwapCapDTO) async {
        if migratingCapId != nil { return }
        migratingCapId = cap.id
        error = nil
        defer { migratingCapId = nil }
        do {
            let built = try await VaultAPI.migrateCap(
                capId: cap.id, sourceType: cap.sourceType
            )
            let result = try await ZkLoginCoordinator.shared.signAndSubmit(
                transactionKindB64: built.bytesB64,
                intent: "Migrate auto-swap",
                rewards: nil
            )
            success = result.digest
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Drive `migrateCap` once per cap in `state.caps` that still needs
    /// migration. Sequential — Sui PTBs against the same owner can't
    /// share a gas object concurrently and the sponsor flow will queue
    /// them server-side anyway, so we keep the client honest.
    private func migrateAllCaps() async {
        if migratingAll { return }
        migratingAll = true
        error = nil
        defer { migratingAll = false }
        let pending = (state?.caps ?? []).filter { $0.requiresMigration }
        for cap in pending {
            // `migrateCap` is gated on `migratingCapId`; we don't drive
            // it through that helper because the helper bails when
            // anything else is in flight. Inline the build + execute
            // here so the loop stays serial without that guard tripping.
            migratingCapId = cap.id
            do {
                let built = try await VaultAPI.migrateCap(
                    capId: cap.id, sourceType: cap.sourceType
                )
                let result = try await ZkLoginCoordinator.shared.signAndSubmit(
                    transactionKindB64: built.bytesB64,
                    intent: "Migrate auto-swap",
                    rewards: nil
                )
                success = result.digest
            } catch {
                self.error = error.localizedDescription
                // Stop on the first failure so the user can see the
                // error and retry — better than silently barreling
                // through every remaining cap.
                migratingCapId = nil
                await load()
                return
            }
            migratingCapId = nil
        }
        await load()
    }

    // MARK: - Success banner

    private func successBanner(_ digest: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(TaliseColor.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text("Updated")
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.fg)
                MicroLabel(text: digest.prefix(20) + "…", color: TaliseColor.fgDim)
            }
            Spacer()
        }
        .padding(14)
        .taliseGlass(cornerRadius: 16, tint: TaliseColor.accent)
    }

    // MARK: - Data

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            // Run state + migration-status + balances in parallel so
            // the page renders the vault card + the "subname not
            // pointing at your vault" warning + per-row fiat-formatted
            // caps in one network round-trip.
            async let s = VaultAPI.getState()
            async let m = VaultAPI.migrationStatus()
            async let bb: BalancesDTO = APIClient.shared.get("/api/balances")
            let resolved = try await s
            // migration-status 503s gracefully when the package isn't
            // deployed; treat any failure here as "no banner".
            let m2 = (try? await m)
            let bb2 = (try? await bb)
            // Bail before mutating @State if a newer load() superseded
            // us mid-flight (Bug B). Without this guard, an older
            // response that returns last can overwrite the newer one.
            if Task.isCancelled { return }
            state = resolved
            migration = m2
            balances = bb2
        } catch {
            if Task.isCancelled { return }
            self.error = error.localizedDescription
        }
    }

    /// Cancel any in-flight `load()` and start a fresh one. This is the
    /// Bug B fix: bare `Task { await load() }` calls could land out of
    /// order — an older PTB's refetch could finish AFTER a newer one and
    /// overwrite the corrected state. Routing every refetch through here
    /// guarantees only the most recent task gets to commit.
    private func reload() {
        loadTask?.cancel()
        loadTask = Task { await load() }
    }

    /// Whether the user's `@talise` subname still targets an address
    /// other than the vault. Drives the inline "Sync subname" CTA
    /// in the vault status card — without this, sends to
    /// `name@talise` keep landing in the user's pre-vault address
    /// and auto-swap never sees the deposits.
    private var needsRepoint: Bool {
        migration?.reason == "subname-not-repointed"
    }

    /// Stage-B repoint: server hands back the SuiNS `set_target_address`
    /// PTB → we sign + sponsor-execute → confirm with the digest. Used
    /// for migrating users whose vault was created before this fix
    /// landed (vault recorded, subname stranded on an old address).
    private func syncSubname() async {
        if syncingSubname { return }
        syncingSubname = true
        error = nil
        defer { syncingSubname = false }
        do {
            let bundle = try await VaultAPI.migrateBundle(stage: "repoint")
            guard let bytes = bundle.bytesB64 else {
                // No-op: server says nothing to repoint (already
                // correct, or no subname). Refetch to clear the CTA.
                await load()
                return
            }
            let result = try await ZkLoginCoordinator.shared.signAndSubmit(
                transactionKindB64: bytes,
                intent: "Point @talise → vault",
                rewards: nil
            )
            try await VaultAPI.migrateConfirm(
                stage: "repoint",
                digest: result.digest
            )
            success = result.digest
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Create the vault PTB → sign → sponsor-execute → record. Two
    /// network legs: the on-chain mint (Onara-sponsored) and the
    /// /api/vault/record persistence call. We refetch state at the end
    /// so the status card flips to "Active" without a second tap.
    private func createVault() async {
        if creatingVault { return }
        creatingVault = true
        error = nil
        success = nil
        defer { creatingVault = false }
        do {
            let built = try await VaultAPI.createPrepare()
            let result = try await ZkLoginCoordinator.shared.signAndSubmit(
                transactionKindB64: built.bytesB64,
                intent: "Create Talise vault",
                rewards: nil
            )
            success = result.digest
            // Persist the vault id server-side. We don't know the id
            // from iOS — the backend resolves it from the digest's
            // object-changes. We pass an empty placeholder so the
            // contract still matches; the server treats empty as
            // "derive it".
            let recorded = try await VaultAPI.record(
                vaultId: "",
                digest: result.digest
            )

            // SuiNS repoint stage. When the user already had a Talise
            // subname (the common case for migrating users), the
            // backend hands back a second PTB that re-targets the
            // subname at the new vault id. Without this leg, every
            // send to `name@talise` keeps landing in the user's
            // pre-vault address — auto-swap never sees the deposits.
            // Skip silently when `repoint == nil` (user with no
            // subname yet, or already-correct target).
            if let repoint = recorded.repoint {
                let _ = try await ZkLoginCoordinator.shared.signAndSubmit(
                    transactionKindB64: repoint.bytesB64,
                    intent: "Point \(repoint.fullName) → vault",
                    rewards: nil
                )
            }
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Generic cap mutation — pause/resume/disable share the same
    /// build → sign → execute → refetch shape, so we collapse them
    /// into one helper.
    private enum CapAction {
        case pause, resume, disable

        var intent: String {
            switch self {
            case .pause:   return "Pause auto-swap"
            case .resume:  return "Resume auto-swap"
            case .disable: return "Disable auto-swap"
            }
        }
    }

    private func mutate(cap: AutoSwapCapDTO, action: CapAction) async {
        if pendingCapId != nil { return }
        pendingCapId = cap.id
        error = nil
        success = nil
        defer { pendingCapId = nil }
        do {
            let built: VaultCreatePrepareResponse
            switch action {
            case .pause:
                built = try await VaultAPI.pauseAutoSwap(
                    capId: cap.id, sourceType: cap.sourceType
                )
            case .resume:
                built = try await VaultAPI.resumeAutoSwap(
                    capId: cap.id, sourceType: cap.sourceType
                )
            case .disable:
                built = try await VaultAPI.disableAutoSwap(
                    capId: cap.id, sourceType: cap.sourceType
                )
            }
            let result = try await ZkLoginCoordinator.shared.signAndSubmit(
                transactionKindB64: built.bytesB64,
                intent: action.intent,
                rewards: nil
            )
            // Bug A — set the optimistic-hold window before the refetch
            // so the upcoming `load()` can't briefly flip the row back
            // to the pre-mutation state if the fullnode isn't indexed yet.
            let holdUntil = Date().addingTimeInterval(Self.optimisticHoldSeconds)
            optimisticUntil[cap.id] = holdUntil
            switch action {
            case .pause:
                optimisticPauseState[cap.id] = true
            case .resume:
                optimisticPauseState[cap.id] = false
            case .disable:
                optimisticDisabled[cap.id] = true
            }
            success = result.digest
            reload()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
