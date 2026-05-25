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
    @State private var loading = true
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

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 22) {
                header
                vaultStatusCard
                if hasVault {
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
        .task { await load() }
        .sheet(item: $enableTarget) { source in
            AutoSwapEnableSheet(source: source) {
                // Refetch state so the row flips to "active" + the
                // success banner reads the digest on the next pass.
                Task { await load() }
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
                Divider().background(Color.white.opacity(0.06))
                vaultBalanceRows(v)
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

    @ViewBuilder
    private func coinRow(_ source: AutoSwapSourceCoin) -> some View {
        if let cap = cap(for: source) {
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
            Button {
                enableTarget = source
            } label: {
                Text("Enable")
                    .font(TaliseFont.heading(13, weight: .medium))
                    .foregroundStyle(TaliseColor.accent)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .overlay(
                        Capsule().stroke(TaliseColor.accent.opacity(0.5), lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
            .disabled(!hasVault)
        }
        .padding(14)
        .background(TaliseColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }

    /// Row for a coin with an active `AutoSwapCap`. Shows the cap
    /// amount + paused/active badge, plus inline Pause/Resume +
    /// Disable controls.
    private func enabledRow(source: AutoSwapSourceCoin, cap: AutoSwapCapDTO) -> some View {
        // `maxPerSwapUsdHint` is a presentation-only hint — the on-wire
        // value is raw u64 with coin-specific decimals, but we don't
        // have a per-coin decimals lookup on iOS. Default to the
        // 6-decimal convention used at submit; if the server later
        // exposes a decimals hint we'd thread it through here.
        let capUsdHint = cap.maxPerSwapDouble / 1_000_000.0
        let isPending = pendingCapId == cap.id
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill(TaliseColor.accent.opacity(cap.paused ? 0.12 : 0.22))
                        .frame(width: 36, height: 36)
                    Image(systemName: source.iconName)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(cap.paused
                                         ? TaliseColor.fgMuted
                                         : TaliseColor.accent)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(source.displayName)
                        .font(TaliseFont.heading(15, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                    HStack(spacing: 6) {
                        Circle()
                            .fill(cap.paused ? TaliseColor.fgDim : TaliseColor.accent)
                            .frame(width: 6, height: 6)
                        Text(cap.paused ? "Paused" : "Active")
                            .font(TaliseFont.mono(10, weight: .light))
                            .foregroundStyle(cap.paused
                                             ? TaliseColor.fgDim
                                             : TaliseColor.accent)
                    }
                }
                Spacer()
                Text("Max \(TaliseFormat.local2(capUsdHint))")
                    .font(TaliseFont.mono(11, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
            }

            Divider().background(Color.white.opacity(0.06))

            HStack(spacing: 10) {
                Button {
                    Task {
                        if cap.paused {
                            await mutate(cap: cap, action: .resume)
                        } else {
                            await mutate(cap: cap, action: .pause)
                        }
                    }
                } label: {
                    HStack(spacing: 6) {
                        if isPending {
                            ProgressView().controlSize(.mini).tint(TaliseColor.fg)
                        } else {
                            Image(systemName: cap.paused ? "play.fill" : "pause.fill")
                                .font(.system(size: 11, weight: .medium))
                        }
                        Text(cap.paused ? "Resume" : "Pause")
                            .font(TaliseFont.heading(13, weight: .medium))
                    }
                    .foregroundStyle(TaliseColor.fg)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(TaliseColor.surface2)
                    .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(isPending)

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
                    .overlay(
                        Capsule().stroke(TaliseColor.danger.opacity(0.45), lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
                .disabled(isPending)

                Spacer()
            }
        }
        .padding(14)
        .background(TaliseColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 18))
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
        .background(TaliseColor.accent.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    // MARK: - Data

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            state = try await VaultAPI.getState()
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
            try await VaultAPI.record(vaultId: "", digest: result.digest)
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
            success = result.digest
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
