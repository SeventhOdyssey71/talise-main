import SwiftUI

/// "Move to wallet" sheet for the user's `TaliseVault`.
///
/// Why this exists: incoming deposits (via the user's @talise handle)
/// land in the shared vault, get auto-swapped to USDsui by the cron, and
/// then sit there. The user's "spendable" wallet — the one the Send /
/// Earn flows read from — is their plain wallet address. This sheet
/// builds a `vault::withdraw_and_send<T>` PTB so the user can pull
/// vault-held coins back into their wallet in one tap.
///
/// For the demo we keep it minimal: load `/api/vault/state`, surface
/// the USDsui balance, and offer a single "Move all to wallet" button.
/// Other coin types (rare — auto-swap is supposed to drain them) get
/// a secondary row each, but the primary CTA always targets USDsui.
///
/// Pattern mirrors `AutoSwapEnableSheet`:
///   1. `VaultAPI.withdrawFromVault(coinType:amount:)` returns PTB bytes
///   2. `ZkLoginCoordinator.signAndSubmit` hands to Onara for execution
///   3. Dismiss + parent refreshes
struct VaultWithdrawSheet: View {
    /// Called after a successful withdrawal so the parent can refresh
    /// `/api/balances` (the user's spendable wallet just grew) and
    /// `/api/vault/state` (the vault just shrank).
    var onWithdrew: () -> Void = {}

    @Environment(\.dismiss) private var dismiss

    @State private var loading = true
    @State private var submitting = false
    @State private var error: String?
    @State private var state: VaultStateResponse?
    /// Which balance row is the user moving? Defaults to the first
    /// USDsui entry on appear; if the vault has none we fall back to
    /// whatever's largest.
    @State private var selected: VaultBalance?

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 22) {
                    header
                    if loading {
                        loadingState
                    } else if let v = state?.vault, !v.balances.isEmpty {
                        balancesList(v)
                        amountSummary
                    } else {
                        emptyState
                    }
                    if let error {
                        Text(error)
                            .font(TaliseFont.body(12, weight: .light))
                            .foregroundStyle(TaliseColor.danger)
                    }
                    Spacer(minLength: 8)
                }
                .padding(.horizontal, 24)
                .padding(.top, 22)
            }
            actionBar
        }
        .liquidGlassSheet(accent: TaliseColor.accent)
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
        .task { await load() }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            MicroLabel(text: "VAULT", color: TaliseColor.fgDim).kerning(1.5)
            Text("Move to wallet")
                .font(TaliseFont.heading(24, weight: .medium))
                .kerning(-1)
                .foregroundStyle(TaliseColor.fg)
            Text("Pull auto-swapped funds out of your vault and into your spendable wallet. Onara pays the gas.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
        }
    }

    // MARK: - States

    private var loadingState: some View {
        VStack(spacing: 12) {
            ForEach(0..<2, id: \.self) { _ in
                HStack {
                    Capsule().fill(TaliseColor.line).frame(width: 80, height: 12)
                    Spacer()
                    Capsule().fill(TaliseColor.line).frame(width: 100, height: 14)
                }
                .padding(14)
                .taliseGlass(cornerRadius: 16)
                .redacted(reason: .placeholder)
                .opacity(0.55)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 6) {
            Text("Vault is empty")
                .font(TaliseFont.body(14, weight: .light))
                .foregroundStyle(TaliseColor.fg)
            Text("Nothing to move right now.")
                .font(TaliseFont.mono(10, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
    }

    /// Per-coin balance rows. Each row is selectable so a user with
    /// stranded non-USDsui dust can still pull it out, but the default
    /// selection (set in `load()`) targets USDsui.
    private func balancesList(_ v: VaultDTO) -> some View {
        VStack(spacing: 8) {
            ForEach(v.balances) { b in
                Button {
                    selected = b
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(displaySymbol(b.coinType))
                                .font(TaliseFont.heading(14, weight: .medium))
                                .foregroundStyle(TaliseColor.fg)
                            Text(shortCoinLabel(b.coinType))
                                .font(TaliseFont.mono(10, weight: .light))
                                .foregroundStyle(TaliseColor.fgDim)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(displayAmount(b))
                                .font(TaliseFont.heading(14, weight: .medium))
                                .foregroundStyle(TaliseColor.fg)
                            if selected?.coinType == b.coinType {
                                Text("Selected")
                                    .font(TaliseFont.mono(9, weight: .light))
                                    .foregroundStyle(TaliseColor.accent)
                            }
                        }
                    }
                    .padding(14)
                    .taliseGlass(cornerRadius: 16)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(
                                selected?.coinType == b.coinType
                                    ? TaliseColor.accent.opacity(0.55)
                                    : Color.clear,
                                lineWidth: 1
                            )
                    )
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// One-line "Withdraw all 0.2609 USDsui" summary above the action
    /// bar. For the demo the only quantity choice is "all", so we don't
    /// surface a numpad — the row selection is the input.
    private var amountSummary: some View {
        HStack {
            Text("Withdraw all")
                .font(TaliseFont.body(12, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
            Spacer()
            if let s = selected {
                Text(displayAmount(s))
                    .font(TaliseFont.heading(14, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
            }
        }
        .padding(.horizontal, 4)
    }

    // MARK: - Action bar

    private var actionBar: some View {
        VStack(spacing: 10) {
            LiquidGlassButton(
                title: submitting ? "Moving…" : "Move to wallet  ·  PIN",
                tint: TaliseColor.accent,
                size: .lg,
                loading: submitting
            ) {
                Task { await submit() }
            }
            .disabled(!canSubmit)
        }
        .padding(.horizontal, 24)
        .padding(.top, 12)
        .padding(.bottom, 32)
    }

    private var canSubmit: Bool {
        guard let s = selected else { return false }
        // Raw amount must be > 0 — Move asserts E_ZERO_AMOUNT otherwise.
        guard let raw = UInt64(s.amount), raw > 0 else { return false }
        return !submitting
    }

    // MARK: - Network

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let s = try await VaultAPI.getState()
            self.state = s
            // Default to USDsui if present, else the largest balance —
            // there's almost always exactly one (auto-swap is supposed to
            // drain everything else), so this is just defensive.
            if let v = s.vault {
                if let usd = v.balances.first(where: { isUsdsui($0.coinType) }) {
                    selected = usd
                } else {
                    selected = v.balances.max(by: { lhs, rhs in
                        (UInt64(lhs.amount) ?? 0) < (UInt64(rhs.amount) ?? 0)
                    })
                }
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Sign + sponsor-execute the withdraw PTB. Same shape as Enable
    /// auto-swap: server builds, we sign with the zkLogin ephemeral key,
    /// Onara broadcasts. The Move entry hard-asserts vault ownership so
    /// a tampered request would 500 here on chain — the 4xx checks on
    /// the server side are just ergonomics.
    private func submit() async {
        guard let s = selected else { return }
        submitting = true
        error = nil
        defer { submitting = false }
        do {
            let built = try await VaultAPI.withdrawFromVault(
                coinType: s.coinType,
                amount: s.amount
            )
            let intent = "Move \(displayAmount(s)) from vault to wallet"
            try await PinGate.shared.requireUserPresence(
                reason: "Withdraw \(displayAmount(s)) from Vault to your wallet"
            )
            _ = try await ZkLoginCoordinator.shared.signAndSubmit(
                transactionKindB64: built.bytesB64,
                intent: intent,
                rewards: nil
            )
            onWithdrew()
            dismiss()
        } catch PinError.cancelled {
            self.error = nil
        } catch PinError.forgotSignOut {
            // PinService already cleared this user's hash.
            self.error = "Sign in again to set a new PIN."
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Formatting helpers

    /// Cosmetic symbol — strips the trailing struct name out of the
    /// fully-qualified coin type and applies a couple of branded
    /// renames so USDsui doesn't show up as `USDSUI`. The server's
    /// coin-metadata is the real source of truth; this is just for
    /// the sheet's row labels.
    private func displaySymbol(_ coinType: String) -> String {
        let tail = coinType.split(separator: ":").last.map(String.init) ?? coinType
        switch tail.uppercased() {
        case "USDSUI": return "USDsui"
        case "SUI":    return "SUI"
        default:       return tail
        }
    }

    /// Full module path for the secondary mono line — same compaction
    /// as `AutoSwapSettings.shortCoinLabel`.
    private func shortCoinLabel(_ coinType: String) -> String {
        coinType.split(separator: ":").last.map(String.init) ?? coinType
    }

    /// True if the coin type looks like USDsui. We match on the struct
    /// name suffix because the package id can change across testnet /
    /// mainnet deploys and we don't want to ship a brittle hardcode.
    private func isUsdsui(_ coinType: String) -> Bool {
        let tail = coinType.split(separator: ":").last.map(String.init) ?? ""
        return tail.uppercased() == "USDSUI"
    }

    /// Scale the raw u64 amount into a human-readable string using
    /// known decimals for the common coin types. Unknown coins fall
    /// back to the raw value — better than guessing wrong and showing
    /// e.g. 0.000000 for what's actually 260920 raw units.
    private func displayAmount(_ b: VaultBalance) -> String {
        let symbol = displaySymbol(b.coinType)
        let decimals: Int = {
            switch symbol.uppercased() {
            case "USDSUI", "USDC", "USDT": return 6
            case "SUI":                    return 9
            default:                       return 0
            }
        }()
        guard decimals > 0, let raw = Double(b.amount) else {
            return "\(b.amount) \(symbol)"
        }
        let scaled = raw / pow(10.0, Double(decimals))
        if scaled < 0.0001 {
            return String(format: "%.6f %@", scaled, symbol)
        }
        return String(format: "%.4f %@", scaled, symbol)
    }
}
