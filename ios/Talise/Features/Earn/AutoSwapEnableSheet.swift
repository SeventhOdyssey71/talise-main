import SwiftUI

/// Modal sheet that walks the user through enabling auto-swap for a
/// single source coin type. Shown when they tap "Enable" on a row in
/// `AutoSwapSettings`.
///
/// Flow:
///   1. User enters a max-per-swap amount via `SendNumpad`.
///   2. Tap "Enable" → `VaultAPI.enableAutoSwap` returns the PTB bytes.
///   3. Sign + Onara-sponsor-execute via `ZkLoginCoordinator`.
///   4. Dismiss + parent refetches `/api/vault/state` to flip the row.
struct AutoSwapEnableSheet: View {
    /// Source coin the user is enabling. The view uses this for the
    /// title + as the `sourceType` parameter on the enable call.
    let source: AutoSwapSourceCoin

    /// Called after a successful enable so the parent (`AutoSwapSettings`)
    /// can refetch state and flip this row to "active".
    let onEnabled: () -> Void

    @Environment(\.dismiss) private var dismiss

    /// The amount-input string driven by `SendNumpad`. Lives in the
    /// user's display currency (₦, $, €, …); converted to USDsui at
    /// submit. Empty = no value typed yet.
    @State private var input: String = ""
    @State private var submitting = false
    @State private var error: String?
    /// USD price of the source coin, fetched on appear when `source`
    /// is non-stable (currently just SUI). Nil until the balances call
    /// resolves; the submit button stays disabled until it does so we
    /// never round a ₦250 cap down to 166 raw MIST.
    @State private var sourceCoinPriceUsd: Double?

    /// 1-year cap on the AutoSwapCap's `expires_at_ms`. The Move code
    /// enforces an upper bound server-side too — this is just our
    /// default before any explicit picker UI lands.
    private var defaultExpiryMs: UInt64 {
        let nowMs = UInt64(Date().timeIntervalSince1970 * 1000)
        let yearMs: UInt64 = 365 * 24 * 60 * 60 * 1000
        return nowMs + yearMs
    }

    /// User's typed local-currency amount converted to USD. Used both
    /// for the can-submit check and to derive the raw u64 max-per-swap
    /// that goes over the wire. Falls back to 0 when input is empty.
    private var amountUsd: Double {
        guard let local = Double(input), local > 0 else { return 0 }
        return CurrencySettings.shared.convertToUsd(local: local)
    }

    /// Resolved USD price of the source coin. Stables short-circuit
    /// to 1.0 so we never need an oracle call for USDC/USDT. SUI uses
    /// the value fetched from `/api/balances` on appear.
    private var resolvedCoinPriceUsd: Double? {
        if source.isStable { return 1.0 }
        return sourceCoinPriceUsd
    }

    /// Convert the user's fiat budget → raw u64 in the source coin's
    /// native units. The on-chain `AutoSwapCap.max_per_swap` is
    /// compared against the actual coin amount (e.g. MIST for SUI),
    /// not a USD value — so we MUST go through coin price + native
    /// decimals here. The earlier version skipped both legs and hard-
    /// coded 6 decimals, which capped SUI swaps at ~0.000167 SUI
    /// (basically nothing) regardless of the user's fiat budget.
    ///
    /// Math: raw = floor((usd_budget / coinPriceUsd) * 10^decimals)
    ///
    /// We still send `maxPerSwap` as a String to match the wire schema
    /// (preserves precision through the JSON roundtrip).
    private var maxPerSwapWire: String {
        guard let priceUsd = resolvedCoinPriceUsd, priceUsd > 0 else {
            return "0"
        }
        let coinAmount = amountUsd / priceUsd
        let scale = pow(10.0, Double(source.decimals))
        let raw = (coinAmount * scale).rounded(.down)
        // Clamp to a u64 range. Anything wildly large is the user's
        // typo; backend would also reject it.
        let clamped = max(0, min(raw, Double(UInt64.max)))
        return String(UInt64(clamped))
    }

    private var canSubmit: Bool {
        amountUsd > 0 && resolvedCoinPriceUsd != nil && !submitting
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 22) {
                    header
                    explainer
                    amountField
                    if let error {
                        Text(error)
                            .font(TaliseFont.body(12, weight: .light))
                            .foregroundStyle(TaliseColor.danger)
                    }
                    Spacer(minLength: 8)
                    numpad
                }
                .padding(.horizontal, 24)
                .padding(.top, 22)
            }
            actionBar
        }
        // Plain black background — TopGlow belongs only on root tab
        // screens. Sheets sit over the (already-blurred) tab content.
        .background(TaliseColor.bg.ignoresSafeArea())
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .task { await loadSourceCoinPrice() }
    }

    /// Pulls the source coin's USD price so `maxPerSwapWire` can scale
    /// the fiat budget into native coin units. Stables short-circuit
    /// without a network hit. For SUI we reuse `/api/balances` (which
    /// already carries `suiPriceUsd` for the Home view) — keeps the
    /// dependency surface minimal and avoids a new endpoint just for
    /// this sheet.
    private func loadSourceCoinPrice() async {
        if source.isStable {
            sourceCoinPriceUsd = 1.0
            return
        }
        do {
            let b: BalancesDTO = try await APIClient.shared.get("/api/balances")
            // Guard against a zero/missing price snapshot — we'd rather
            // keep the button disabled than mint a cap that lets
            // arbitrary swaps through.
            if b.suiPriceUsd > 0 {
                sourceCoinPriceUsd = b.suiPriceUsd
            }
        } catch {
            // Soft-fail: leave price nil so canSubmit stays false and
            // the user sees the "Enable" button disabled rather than
            // a silently-broken cap.
        }
    }

    // MARK: - Header / explainer

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            MicroLabel(text: "AUTO-SWAP", color: TaliseColor.fgDim).kerning(1.5)
            Text("Auto-swap \(source.displayName) to USDsui")
                .font(TaliseFont.heading(24, weight: .medium))
                .kerning(-1)
                .foregroundStyle(TaliseColor.fg)
        }
    }

    private var explainer: some View {
        Text("Any \(source.displayName) sent to your @talise handle will be auto-converted to USDsui. You set the cap per swap; Onara pays the gas. Pause or disable any time.")
            .font(TaliseFont.body(13, weight: .light))
            .foregroundStyle(TaliseColor.fgMuted)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: - Amount field

    private var amountField: some View {
        let currency = CurrencySettings.shared.current
        return VStack(alignment: .leading, spacing: 10) {
            MicroLabel(text: "Max per swap", color: TaliseColor.fgDim).kerning(1.5)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(currency.symbol)
                    .font(TaliseFont.heading(28, weight: .medium))
                    .foregroundStyle(TaliseColor.fgMuted)
                Text(input.isEmpty ? "0" : input)
                    .font(TaliseFont.heading(34, weight: .medium))
                    .kerning(-1)
                    .foregroundStyle(input.isEmpty ? TaliseColor.fgDim : TaliseColor.fg)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Spacer()
                Text(currency.code)
                    .font(TaliseFont.heading(14, weight: .medium))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
            .padding(14)
            .background(TaliseColor.usernameCard)
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
    }

    // MARK: - Numpad

    /// Tap-only digit pad — reuses the Send flow's numpad so the feel
    /// is identical (haptics, decimal/backspace rules, 2-fraction cap).
    private var numpad: some View {
        SendNumpad(input: $input)
            .padding(.top, 8)
    }

    // MARK: - Action bar

    private var actionBar: some View {
        VStack(spacing: 10) {
            Button(action: { Task { await enable() } }) {
                HStack(spacing: 10) {
                    if submitting {
                        ProgressView().tint(TaliseColor.bg)
                    }
                    Text(submitting
                         ? "Enabling…"
                         : "Enable auto-swap")
                        .font(TaliseFont.heading(15, weight: .medium))
                }
                .foregroundStyle(TaliseColor.bg)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(canSubmit ? TaliseColor.fg : TaliseColor.fg.opacity(0.35))
                .clipShape(Capsule())
            }
            .disabled(!canSubmit)
        }
        .padding(.horizontal, 24)
        .padding(.top, 12)
        .padding(.bottom, 32)
        .background(TaliseColor.bg)
    }

    // MARK: - Network

    /// Build the enable PTB → sign → sponsor-execute. Mirrors the Send
    /// + Supply flows — the only thing that differs is the PTB shape
    /// the server returns. On success we dismiss + ask the parent to
    /// refetch state so the row flips to "active".
    private func enable() async {
        guard canSubmit else { return }
        submitting = true
        error = nil
        defer { submitting = false }
        do {
            let built = try await VaultAPI.enableAutoSwap(
                sourceType: source.rawValue,
                maxPerSwap: maxPerSwapWire,
                expiresAtMs: defaultExpiryMs
            )
            let symbol = CurrencySettings.shared.current.symbol
            let _ = try await ZkLoginCoordinator.shared.signAndSubmit(
                transactionKindB64: built.bytesB64,
                intent: "Enable auto-swap \(source.displayName) → USDsui (max \(symbol)\(input))",
                rewards: nil
            )
            onEnabled()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
