import SwiftUI

/// Live yield comparison + sponsored supply into the best venue.
/// Reads /api/yield/comparison, supplies USDsui via /api/earn/supply/build
/// → ZkLoginCoordinator (Onara sponsored).
struct EarnView: View {
    @State private var comparison: YieldComparison?
    @State private var amount = ""
    @State private var loading = true
    @State private var supplying = false
    @State private var error: String?
    @State private var success: String?
    /// When non-nil, the full-screen "You just saved …" celebration
    /// (Figma node 130:2) is presented. Holds the localized, currency-
    /// formatted amount the user just invested, e.g. "$2.12" or
    /// "₦12,000.00". Cleared by the sheet's "Back to Invest" button.
    @State private var savingsPopupAmount: String?
    /// Active position (non-nil supplied amount) the user tapped on —
    /// drives the withdraw sheet. Reset to nil to dismiss.
    @State private var withdrawTarget: YieldVenue?
    /// Rewards summary fetched here (not via the Rewards tab) because
    /// `RoundupCard` lives on Invest now and needs the round-up config.
    /// Cheap GET; we refetch on pull-to-refresh + after the user
    /// toggles round-up so the "Saved this month" running tally stays
    /// in sync with the on-chain compound supplies.
    @State private var rewardsSummary: RewardsSummary?
    /// When true, the one-time Earn opt-in disclosure sheet is presented.
    /// We gate the FIRST supply behind it so the user explicitly accepts
    /// that Earn is a separate lending service — not a property of their
    /// balance, and yield is not guaranteed (master plan §8, §9: GENIUS
    /// recharacterization risk). Set by `supplyTapped()` when the user
    /// hasn't yet accepted; cleared on accept (which then runs the supply)
    /// or dismiss (which does nothing — we NEVER auto-supply).
    @State private var showEarnDisclosure = false

    var body: some View {
        // Invest = the money-management hub. Venues + Supply +
        // Withdraw are the explicit actions; Round-up, Goals, and
        // Insights round out the surface as "how your money's working
        // for you". Rewards keeps the points / perks / referral.
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 22) {
                header
                venueCards
                supplyCard
                // Money-management sections — relocated from Rewards.
                // Each owns its own data fetch via .task internally;
                // RoundupCard needs `summary` so we fetch it here.
                RoundupCard(summary: rewardsSummary, onChange: { Task { await loadRewards() } })
                GoalsSection()
                InsightsSection()
                if let error {
                    Text(error)
                        .font(TaliseFont.body(12, weight: .light))
                        .foregroundStyle(TaliseColor.danger)
                }
                // "Now earning" success state intentionally NOT rendered
                // here — it appears INSIDE supplyCard (replacing the
                // input form) so the user sees the confirmation where
                // they tapped, not at the bottom of the scroll below
                // RoundupCard / Goals / Insights. See `supplyCard`.
                Spacer(minLength: 120)
            }
            .padding(.horizontal, 24)
            .padding(.top, 24)
        }
        .refreshable { await load(); await loadRewards() }
        .taliseScreenBackground()
        .task { await load() }
        .task { await loadRewards() }
        .fullScreenCover(isPresented: Binding(
            get: { savingsPopupAmount != nil },
            set: { if !$0 { savingsPopupAmount = nil } }
        )) {
            SavingsSuccessView(
                amountText: savingsPopupAmount ?? "",
                onDismiss: { savingsPopupAmount = nil }
            )
        }
        .sheet(item: $withdrawTarget) { v in
            WithdrawSheet(venue: v, bestApy: comparison?.best?.apy ?? 0) {
                // After a successful withdraw, refresh the venue cards
                // so the supplied amount drops back to "Idle".
                Task { await load() }
            }
        }
        // One-time opt-in disclosure gate before the user's FIRST supply.
        // The user must explicitly accept that Earn is a separate lending
        // service (not a property of their balance, yield not guaranteed)
        // before any funds move — we NEVER auto-supply. On accept the
        // sheet persists acceptance and continues into the supply flow.
        .sheet(isPresented: $showEarnDisclosure) {
            EarnDisclosureSheet(
                apy: comparison?.best?.apy ?? 0,
                moneyWord: moneyWord,
                onAccept: {
                    Self.markEarnDisclosureAccepted()
                    showEarnDisclosure = false
                    Task { await supply() }
                },
                onCancel: { showEarnDisclosure = false }
            )
        }
        // Mount the PIN host at the EarnView root so its sheet
        // presents in this tab's context — supply/withdraw confirm
        // calls flow through here.
        .pinGateHost()
    }

    // MARK: - Header

    private var header: some View {
        // Dropped the "EARN" eyebrow — the tab bar already identifies
        // the screen and "Make your money work" + the APY line carry
        // the brand voice.
        VStack(alignment: .leading, spacing: 6) {
            // Fiat-framed headline — the user earns on *their money*, in
            // their display currency ("on your naira" / "on your dollars"),
            // never "supply USDsui to NAVI" (master plan §8: chain stays
            // invisible; §9 GENIUS: must read as earning on dollars, not a
            // stablecoin-balance yield feature).
            if let best = comparison?.best {
                Text(String(
                    format: "Earn up to %.2f%% on your %@",
                    best.apy * 100,
                    moneyWord
                ))
                .font(TaliseFont.heading(24, weight: .medium))
                .kerning(-1)
                .foregroundStyle(TaliseColor.fg)
            } else {
                Text(String(format: "Earn on your %@", moneyWord))
                    .font(TaliseFont.heading(24, weight: .medium))
                    .kerning(-1)
                    .foregroundStyle(TaliseColor.fg)
            }
            Text("A separate lending service, not part of your balance")
                .font(TaliseFont.body(12, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
        }
    }

    /// Plural "money word" for the user's display currency, used in the
    /// fiat-framed Earn copy ("Earn up to X% on your naira"). Falls back
    /// to the generic "money" for any currency we don't have a colloquial
    /// plural for. Kept local to EarnView so this reframe stays strictly
    /// additive and doesn't touch CurrencySettings.
    private var moneyWord: String {
        switch CurrencySettings.shared.current.code {
        case "USD", "CAD": return "dollars"
        case "NGN":        return "naira"
        case "GHS":        return "cedis"
        case "KES":        return "shillings"
        case "ZAR":        return "rand"
        case "EUR":        return "euros"
        case "GBP":        return "pounds"
        default:           return "money"
        }
    }

    // MARK: - Venue cards

    /// Filter the venue list before render. DeepBook USDsui margin
    /// sits at ~0% utilization → ~0% APY, so we don't surface it as
    /// a yield option for users who don't already have funds there.
    /// Hide unless the user has a position (`supplied > 0`) — that
    /// way existing DeepBook depositors can still tap their card to
    /// withdraw, but new users only see Navi.
    private func visibleVenues(_ venues: [YieldVenue]) -> [YieldVenue] {
        venues.filter { v in
            if v.venue == "deepbook" {
                return (v.supplied ?? 0) > 0
            }
            return true
        }
    }

    private var venueCards: some View {
        VStack(spacing: 12) {
            if loading {
                ForEach(0..<2, id: \.self) { _ in
                    venuePlaceholder
                }
            } else if let cmp = comparison, !cmp.venues.isEmpty {
                ForEach(visibleVenues(cmp.venues)) { v in
                    venueCard(v, best: v.venue == cmp.best?.venue)
                }
            } else {
                emptyState
            }
        }
    }

    private var venuePlaceholder: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                Capsule().fill(TaliseColor.line).frame(width: 70, height: 10)
                Capsule().fill(TaliseColor.line).frame(width: 110, height: 8)
            }
            Spacer()
            Capsule().fill(TaliseColor.line).frame(width: 60, height: 14)
        }
        .padding(16)
        .taliseGlass(cornerRadius: 20)
        .redacted(reason: .placeholder)
        .opacity(0.5)
    }

    private var emptyState: some View {
        VStack(spacing: 4) {
            Text("No live venues right now.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
            Text("Pull to refresh.")
                .font(TaliseFont.mono(10, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .taliseGlass(cornerRadius: 20)
    }

    private func venueCard(_ v: YieldVenue, best: Bool) -> some View {
        let hasPosition = (v.supplied ?? 0) > 0
        return Button {
            // Only opens a withdraw sheet when the user actually has
            // something to redeem — idle cards stay non-interactive.
            if hasPosition { withdrawTarget = v }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text(v.displayName)
                        .font(TaliseFont.heading(14, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                    if let supplied = v.supplied, supplied > 0 {
                        HStack(spacing: 6) {
                            // Localized — Nigerian user sees ₦, US user sees $,
                            // UK user sees £, etc. Routes through TaliseFormat
                            // which picks up CurrencySettings.shared.current.
                            Text("Supplied \(TaliseFormat.local2(supplied))")
                                .font(TaliseFont.mono(11, weight: .light))
                                .foregroundStyle(TaliseColor.fgMuted)
                            Image(systemName: "chevron.right")
                                .font(.system(size: 9, weight: .medium))
                                .foregroundStyle(TaliseColor.fgDim)
                        }
                    } else {
                        Text("Idle")
                            .font(TaliseFont.mono(11, weight: .light))
                            .foregroundStyle(TaliseColor.fgDim)
                    }
                }
                Spacer()
                // APY < 1bp reads as "—" instead of "0.00%". DeepBook's
                // USDsui margin pool currently has near-zero borrow
                // utilization (suppliers earn util × borrowRate × 0.8);
                // calling that "0.00% APY" misleads — it's "no demand
                // for loans right now" not "guaranteed to pay 0".
                Text(v.apy >= 0.0001
                     ? String(format: "%.2f%%", v.apy * 100)
                     : "—")
                    .font(TaliseFont.heading(22, weight: .medium))
                    .kerning(-0.8)
                    .foregroundStyle(v.apy >= 0.0001
                                     ? TaliseColor.fg
                                     : TaliseColor.fgDim)
            }
            .padding(16)
            .taliseGlass(cornerRadius: 20)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!hasPosition)
    }

    // MARK: - Supply card

    private var supplyCard: some View {
        // Success state takes over the entire card so the user sees
        // confirmation exactly where they tapped "Start earning",
        // instead of as a banner at the bottom of the Earn scroll
        // (which read as "appeared in History" — bug report 2026-05-29).
        // The card auto-clears the success state after ~2s so the
        // user returns to the input form ready to supply more, and
        // the Home tab's activity feed already optimistically inserts
        // the row via `.taliseTxCompleted` (see HomeView.applyOptimisticTx).
        if let success {
            return AnyView(supplySuccessCard(digest: success))
        }
        let currency = CurrencySettings.shared.current
        return AnyView(VStack(alignment: .leading, spacing: 14) {
            MicroLabel(text: "Amount", color: TaliseColor.fgDim).kerning(1.5)
            HStack {
                // Symbol prefix so the value reads naturally (₦12,000
                // not "12000 NGN"). Keeps a single source of truth for
                // formatting via TaliseFormat / CurrencySettings.
                Text(currency.symbol)
                    .font(TaliseFont.heading(28, weight: .medium))
                    .foregroundStyle(TaliseColor.fgMuted)
                TextField("0.00", text: $amount)
                    .keyboardType(.decimalPad)
                    .font(TaliseFont.heading(28, weight: .medium))
                    .kerning(-0.8)
                    .foregroundStyle(TaliseColor.fg)
                    .tint(TaliseColor.accent)
                Spacer()
                Text(currency.code)
                    .font(TaliseFont.heading(14, weight: .medium))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
            .padding(14)
            .taliseGlass(cornerRadius: 16)

            if let projection = earningsProjection {
                projectionBand(projection)
            }

            LiquidGlassButton(
                title: supplying ? "Supplying…" : supplyLabel,
                tint: TaliseColor.accent,
                size: .lg,
                loading: supplying
            ) {
                supplyTapped()
            }
            .disabled(!canSupply)
        }
        .padding(20)
        .taliseGlass(cornerRadius: 25))
    }

    /// Post-tap celebration that REPLACES the supply input form in
    /// place. Lives inside `supplyCard` so the user reads the success
    /// confirmation exactly where they triggered it — not as an inline
    /// banner at the bottom of the Earn scroll. Auto-clears after 2s.
    private func supplySuccessCard(digest: String) -> some View {
        VStack(spacing: 14) {
            ZStack {
                Circle().fill(TaliseColor.accent.opacity(0.18))
                    .frame(width: 56, height: 56)
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(TaliseColor.accent)
            }
            VStack(spacing: 4) {
                Text("Now earning")
                    .font(TaliseFont.heading(18, weight: .medium))
                    .kerning(-0.4)
                    .foregroundStyle(TaliseColor.fg)
                MicroLabel(
                    text: digest.prefix(20) + "…",
                    color: TaliseColor.fgDim
                )
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .padding(.horizontal, 20)
        .taliseGlass(cornerRadius: 25, tint: TaliseColor.accent)
        .transition(.opacity.combined(with: .scale(scale: 0.96)))
        .task {
            // Brief celebration, then drop back to the input form so
            // the user can supply again. The Home tab already shows
            // the new tx via the optimistic-insert pipeline, so we
            // don't need to keep the banner up.
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            success = nil
        }
    }

    private var canSupply: Bool {
        // Check the USD-converted amount, not the raw input — guards
        // against the FX rates not having loaded yet (convertToUsd
        // would return 0 in that edge case rather than letting a
        // local-currency value sneak through as USDsui).
        amountUsd > 0 && comparison?.best != nil && !supplying
    }

    // MARK: - Earnings projection

    /// User's typed amount, converted from their display currency to
    /// USD (USDsui is 1:1 USD). Single source of truth for everything
    /// downstream: the projection math, the supply button label, and
    /// the actual amount we POST to /api/earn/supply/prepare.
    /// Returns 0 when the input is empty / malformed.
    private var amountUsd: Double {
        guard let local = Double(amount), local > 0 else { return 0 }
        return CurrencySettings.shared.convertToUsd(local: local)
    }

    /// (daily, weekly, monthly, yearly) USD earnings at the best venue's
    /// APY, for the amount currently in the input. Nil when no amount /
    /// no venue / zero APY. Computed in USD so the format helper
    /// (`TaliseFormat.local`) can do one consistent conversion back
    /// to the user's display currency — earlier revision did the math
    /// in local units and then double-converted in the formatter.
    private var earningsProjection: (day: Double, week: Double, month: Double, year: Double)? {
        let usd = amountUsd
        guard usd > 0,
              let best = comparison?.best, best.apy > 0 else { return nil }
        let annual = usd * best.apy
        return (
            day:   annual / 365.0,
            week:  annual / 52.0,
            month: annual / 12.0,
            year:  annual
        )
    }

    private func projectionBand(
        _ p: (day: Double, week: Double, month: Double, year: Double)
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            MicroLabel(
                text: "You'll earn",
                color: TaliseColor.fgDim
            ).kerning(1.5)
            VStack(spacing: 0) {
                projectionRow(label: "Day",   value: p.day)
                projectionRowDivider
                projectionRow(label: "Week",  value: p.week)
                projectionRowDivider
                projectionRow(label: "Month", value: p.month)
                projectionRowDivider
                projectionRow(label: "Year",  value: p.year, accent: true)
            }
            .padding(.vertical, 4)
            .taliseGlass(cornerRadius: 16)
        }
        .transition(.opacity.combined(with: .move(edge: .top)))
        .animation(.easeInOut(duration: 0.18), value: amount)
    }

    private func projectionRow(label: String, value: Double, accent: Bool = false) -> some View {
        HStack {
            Text(label)
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
            Spacer()
            Text(formatProjection(value))
                .font(TaliseFont.heading(15, weight: .medium))
                .kerning(-0.4)
                .foregroundStyle(accent ? TaliseColor.accent : TaliseColor.fg)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
    }

    private var projectionRowDivider: some View {
        LiquidGlassDivider(inset: 12)
    }

    private func formatProjection(_ v: Double) -> String {
        // Routes through the user's display-currency setting so
        // earnings show in ₦ for a Nigerian, $ for a US user, etc.
        // Falls back to USD output until /api/fx has loaded.
        TaliseFormat.local(v)
    }

    private var supplyLabel: String {
        guard comparison?.best != nil else { return "Start earning" }
        guard let local = Double(amount), local > 0 else {
            return "Start earning"
        }
        // Render the button caption in the user's display currency
        // (₦12,000 not "$12000") so the action matches the input pill.
        // Drop the venue name — users care about the action ("Earn $X")
        // not which protocol routes underneath.
        return "Earn \(TaliseFormat.local2(amountUsd))"
    }

    // The inline `successBanner` was removed 2026-05-29 — the
    // "Now earning" celebration now renders inside `supplyCard` via
    // `supplySuccessCard(digest:)` so it surfaces where the user
    // tapped, not at the bottom of the Earn scroll.

    // MARK: - Data

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            comparison = try await APIClient.shared.get("/api/yield/comparison")
        } catch {
            // Refresh-during-refresh cancels show up as URLErrorCancelled;
            // those aren't real failures and shouldn't clobber the banner.
            if !APIError.isCancellation(error) {
                self.error = error.localizedDescription
            }
        }
    }

    /// Rewards summary fetch — fuels the `RoundupCard` config (toggle
    /// state + percentage + lifetime saved). Soft-fails on cancellation
    /// so a refresh-during-refresh doesn't clobber the previous value.
    private func loadRewards() async {
        do {
            rewardsSummary = try await APIClient.shared.get("/api/referral/summary")
        } catch {
            let ns = error as NSError
            // Quietly ignore cancellation; surface real errors via the
            // existing inline error label.
            if !(error is CancellationError ||
                 (ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled)) {
                self.error = error.localizedDescription
            }
        }
    }

    // MARK: - Opt-in disclosure gate

    /// UserDefaults key recording that the user has read + accepted the
    /// Earn opt-in disclosure. Once true we don't show the sheet again.
    private static let earnDisclosureKey = "io.talise.app.earnDisclosureAcceptedV1"

    /// Whether the user has already accepted the one-time Earn disclosure.
    static func hasAcceptedEarnDisclosure() -> Bool {
        UserDefaults.standard.bool(forKey: earnDisclosureKey)
    }

    /// Persist that the user accepted the Earn disclosure.
    static func markEarnDisclosureAccepted() {
        UserDefaults.standard.set(true, forKey: earnDisclosureKey)
    }

    /// Supply-button entry point. On the user's FIRST supply we present
    /// the opt-in disclosure sheet (which, on accept, runs `supply()`);
    /// once accepted we go straight to `supply()`. We NEVER auto-supply —
    /// the user always taps through this path explicitly.
    private func supplyTapped() {
        guard canSupply else { return }
        if Self.hasAcceptedEarnDisclosure() {
            Task { await supply() }
        } else {
            showEarnDisclosure = true
        }
    }

    private func supply() async {
        // amountUsd converts the user's local-currency input through
        // their selected FX rate to USDsui (1:1 USD). Backend +
        // notification payload both expect USDsui units — typed input
        // stays in the user's currency only on screen.
        let usd = amountUsd
        guard let best = comparison?.best, usd > 0 else { return }
        supplying = true
        error = nil
        success = nil
        defer { supplying = false }

        let localAmount = amount
        let attemptOrder: [String] = [best.venue]

        for venue in attemptOrder {
            do {
                struct Body: Encodable { let venue: String; let amount: Double }
                let built: BuildKindResponse = try await APIClient.shared.post(
                    "/api/earn/supply/prepare",
                    body: Body(venue: venue, amount: usd)
                )
                let symbol = CurrencySettings.shared.current.symbol
                let amountForPrompt = String(format: "$%.2f", usd)
                try await PinGate.shared.requireUserPresence(
                    reason: "Start earning on \(amountForPrompt)"
                )
                let result = try await ZkLoginCoordinator.shared.signAndSubmit(
                    transactionKindB64: built.transactionKindB64,
                    intent: "Earn \(symbol)\(localAmount)",
                    rewards: ZkLoginCoordinator.RewardsMeta(
                        kind: "invest",
                        amountUsd: usd,
                        venue: venue
                    )
                )
                success = result.digest
                // Capture the localized invested amount BEFORE clearing
                // the input, then raise the full-screen "You just
                // saved …" celebration (Figma 130:2). local2 converts
                // the USD-denominated supply back to the user's display
                // currency so a ₦ user sees ₦ and a $ user sees $.
                savingsPopupAmount = TaliseFormat.local2(usd)
                NotificationCenter.default.post(
                    name: .taliseTxCompleted,
                    object: TaliseTxEvent(
                        digest: result.digest,
                        direction: "invest",
                        amountUsdsui: usd,
                        counterparty: nil,
                        counterpartyName: nil,
                        venue: venue
                    )
                )
                amount = ""
                Task { await load() }
                return
            } catch PinError.cancelled {
                // Silent: user dismissed the prompt. Leave the form
                // intact so they can retry without re-typing.
                self.error = nil
                return
            } catch PinError.forgotSignOut {
                // PinService already cleared this user's hash.
                self.error = "Sign in again to set a new PIN."
                return
            } catch {
                self.error = error.localizedDescription
                return
            }
        }
    }
}

// MARK: - Withdraw sheet

/// Position-detail + redeem flow. Opens when the user taps a venue
/// card with a non-zero `supplied` balance. Shows the current position
/// (interest already accrued in-place — DeepBook's supply amount
/// includes earned yield), then offers two paths:
///   • "Withdraw all" — redeems every share including accrued interest
///   • amount field   — partial withdraw in USDsui
///
/// Both POST to /api/earn/withdraw/prepare → ZkLoginCoordinator. The
/// position display is live: APY × principal projects daily / yearly
/// gain at the moment the sheet opens.
private struct WithdrawSheet: View {
    let venue: YieldVenue
    let bestApy: Double
    let onClose: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var partial = ""
    @State private var withdrawing = false
    @State private var error: String?
    @State private var success: String?

    /// On-chain position in USDsui (1:1 USD). Wire-side value; the UI
    /// renders it through TaliseFormat.local so a Nigerian user sees
    /// ₦, a US user sees $, etc. — see `positionCard`.
    private var supplied: Double { venue.supplied ?? 0 }
    private var apy: Double { venue.apy }
    /// Daily yield in USD at this APY × current position. Prefer the
    /// server-computed value when present (matches the principal-only
    /// projection the comparison endpoint surfaces); fall back to the
    /// local supplied × apy formula for older server builds.
    private var dailyEarning: Double {
        venue.earningPerDay ?? (supplied * apy / 365.0)
    }
    /// Cumulative yield earned-so-far (server-side: `currentValue −
    /// principalSupplied`). `nil` for venues that don't expose the
    /// breakdown — UI hides the "Earned so far" row + the dedicated
    /// withdraw-earned button in that case.
    private var earnedSoFar: Double? { venue.earned }

    /// USD floor for showing the "Withdraw earned" button. Anything
    /// below this and the button is dust (sub-cent rounding noise) —
    /// we'd just be burning gas to redeem a value smaller than the
    /// PTB build cost. ₦ equivalent at typical FX is ~₦15 so the
    /// floor reads naturally in either currency.
    private static let WITHDRAW_EARNED_DUST_USD: Double = 0.01

    /// Whether the "Withdraw earned" button is visible. Three gates:
    ///   • Venue must expose `earned` (Navi today; Deepbook later)
    ///   • Earned amount must be above the dust floor
    ///   • A withdraw isn't already in-flight
    private var canWithdrawEarned: Bool {
        guard let e = earnedSoFar else { return false }
        return e >= Self.WITHDRAW_EARNED_DUST_USD && !withdrawing
    }

    /// User-typed partial-withdraw amount, in the display currency,
    /// converted to USD for the wire + cap check. Returns 0 when the
    /// input is empty or malformed.
    private var partialUsd: Double {
        guard let local = Double(partial), local > 0 else { return 0 }
        return CurrencySettings.shared.convertToUsd(local: local)
    }

    private var canWithdrawPartial: Bool {
        let usd = partialUsd
        // Tiny epsilon so a "MAX" tap whose local-→USD round-trip
        // gains a sub-cent rounding doesn't get rejected as
        // exceeding the supplied position.
        return usd > 0 && usd <= supplied + 0.0001 && !withdrawing
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 22) {
                    header
                    positionCard
                    partialField
                    if let error {
                        Text(error)
                            .font(TaliseFont.body(12, weight: .light))
                            .foregroundStyle(TaliseColor.danger)
                    }
                    if let success {
                        successBanner(success)
                    }
                    Spacer(minLength: 16)
                }
                .padding(.horizontal, 24)
                .padding(.top, 22)
            }
            actionBar
        }
        // Liquid Glass sheet treatment — the material backdrop +
        // accent top wash mirrors what the rest of the app does for
        // modals (see Profile, Send). Replaces the plain-black
        // ignore-safe-area background that read as a flat plate.
        .liquidGlassSheet(accent: TaliseColor.accent)
        // Large-only detent so the sheet opens with the position card,
        // withdraw-amount input, and both action buttons visible
        // without an extra drag. The `.medium` option made the sheet
        // land halfway up, cutting off the amount field — exactly the
        // case the user flagged.
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        // Host the PIN sheet inside this sheet's own presentation
        // context. EarnView's host is the parent presenter (it already
        // has this WithdrawSheet up), so the PIN call needs to surface
        // from inside.
        .pinGateHost()
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            MicroLabel(text: "Position", color: TaliseColor.fgDim).kerning(1.5)
            Text("Your earnings")
                .font(TaliseFont.heading(24, weight: .medium))
                .kerning(-1)
                .foregroundStyle(TaliseColor.fg)
        }
    }

    private var positionCard: some View {
        // Localized — Nigerian user sees ₦, US user sees $, GB sees £,
        // etc. The on-chain values are still USDsui (1:1 USD); the
        // local formatter applies CurrencySettings.shared.current.
        VStack(spacing: 0) {
            row(label: "Supplied", value: TaliseFormat.local2(supplied))
            rowDivider
            row(
                label: "APY",
                value: String(format: "%.2f%%", apy * 100),
                accent: true
            )
            // "Earned so far" — server-computed cumulative yield since
            // the user's first supply. Only shown when the venue
            // exposes the breakdown (Navi today). Green accent +
            // larger weight so the user reads it as the headline
            // number; the per-day burn rate sits beneath in muted
            // copy.
            if let earned = earnedSoFar {
                rowDivider
                row(
                    label: "Earned so far",
                    value: TaliseFormat.local2(earned),
                    accent: true
                )
            }
            rowDivider
            // Show actual amount whenever there's a position earning yield —
            // the previous `>= 0.0001 USD` threshold hid daily earnings for
            // small positions (e.g. a ₦57 supplied position earns ~₦0.10/day
            // which is below the USD threshold but still meaningful in local
            // currency). Use `local` (not `local2`) so sub-1 values render
            // with 4 decimals instead of rounding to ₦0.00.
            row(
                label: "Earning / day",
                value: (supplied > 0 && apy > 0)
                    ? TaliseFormat.local(dailyEarning)
                    : "—"
            )
        }
        .padding(.vertical, 4)
        .taliseGlass(cornerRadius: 20)
    }

    private func row(label: String, value: String, accent: Bool = false) -> some View {
        HStack {
            Text(label)
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
            Spacer()
            Text(value)
                .font(TaliseFont.heading(15, weight: .medium))
                .kerning(-0.4)
                .foregroundStyle(accent ? TaliseColor.accent : TaliseColor.fg)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 13)
    }

    private var rowDivider: some View {
        LiquidGlassDivider(inset: 14)
    }

    private var partialField: some View {
        let currency = CurrencySettings.shared.current
        return VStack(alignment: .leading, spacing: 10) {
            MicroLabel(text: "Withdraw amount", color: TaliseColor.fgDim).kerning(1.5)
            HStack {
                // Symbol prefix so the value reads naturally for the
                // user's locale. Input + display + the MAX shortcut
                // all stay in their selected currency; conversion to
                // USDsui happens once at submit via partialUsd.
                Text(currency.symbol)
                    .font(TaliseFont.heading(22, weight: .medium))
                    .foregroundStyle(TaliseColor.fgMuted)
                TextField("0.00", text: $partial)
                    .keyboardType(.decimalPad)
                    .font(TaliseFont.heading(22, weight: .medium))
                    .kerning(-0.6)
                    .foregroundStyle(TaliseColor.fg)
                    .tint(TaliseColor.accent)
                Spacer()
                LiquidGlassPill(title: "MAX", tint: TaliseColor.accent, compact: true) {
                    // Convert the on-chain supplied USDsui balance to
                    // the user's display currency so MAX fills the
                    // field in the units they're typing in.
                    let (localMax, _) = CurrencySettings.shared.convert(usd: supplied)
                    partial = String(format: "%.2f", localMax)
                }
                Text(currency.code)
                    .font(TaliseFont.heading(13, weight: .medium))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
            .padding(14)
            .taliseGlass(cornerRadius: 16)
        }
    }

    private var actionBar: some View {
        VStack(spacing: 10) {
            LiquidGlassButton(
                title: withdrawing
                    ? "Working…"
                    : (partial.isEmpty
                        ? "Withdraw"
                        : "Withdraw \(CurrencySettings.shared.current.symbol)\(partial)"),
                tint: TaliseColor.accent,
                size: .lg,
                loading: withdrawing
            ) {
                Task { await withdraw(all: false) }
            }
            .disabled(!canWithdrawPartial)

            // "Withdraw earned" — server computes the exact USDsui
            // earned amount at request time so the value on the
            // button label can lag chain truth by a few seconds
            // without a misclick burning the user's principal. The
            // button is only visible when there's enough accrued
            // yield to be worth the gas (see WITHDRAW_EARNED_DUST_USD).
            if let earned = earnedSoFar, canWithdrawEarned {
                let (local, _) = CurrencySettings.shared.convert(usd: earned)
                let label = "Withdraw earned (\(CurrencySettings.shared.current.symbol)\(String(format: "%.2f", local)))"
                LiquidGlassButton(
                    title: withdrawing ? "Working…" : label,
                    tint: TaliseColor.accent,
                    size: .md,
                    loading: withdrawing
                ) {
                    Task { await withdrawEarned() }
                }
                .disabled(withdrawing)
            }

            LiquidGlassButton(
                title: "Withdraw all + rewards",
                tint: nil,
                size: .md
            ) {
                Task { await withdraw(all: true) }
            }
            .disabled(withdrawing || supplied <= 0)
        }
        .padding(.horizontal, 24)
        .padding(.top, 12)
        .padding(.bottom, 32)
    }

    private func successBanner(_ digest: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(TaliseColor.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text("Withdrawn")
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.fg)
                MicroLabel(text: digest.prefix(20) + "…", color: TaliseColor.fgDim)
            }
            Spacer()
        }
        .padding(14)
        .taliseGlass(cornerRadius: 16, tint: TaliseColor.accent)
    }

    private func withdraw(all: Bool) async {
        withdrawing = true
        error = nil
        success = nil
        defer { withdrawing = false }
        do {
            struct Body: Encodable {
                let venue: String
                let amount: Double?
            }
            // Convert the user's local-currency input to USD at the
            // wire boundary. `all == true` means "redeem the full
            // supplied position" — the backend treats nil amount as
            // "withdraw everything" so no client-side conversion is
            // needed in that branch.
            let amtUsd: Double? = all ? nil : (partialUsd > 0 ? partialUsd : nil)
            let built: BuildKindResponse = try await APIClient.shared.post(
                "/api/earn/withdraw/prepare",
                body: Body(venue: venue.venue, amount: amtUsd)
            )
            let symbol = CurrencySettings.shared.current.symbol
            // For "withdraw all" we don't know the exact USDsui amount
            // yet (DeepBook redeems shares, not units). Server reads
            // the user's live position internally on the prepare leg;
            // here we just report the on-screen supplied snapshot for
            // rewards accounting. Withdraw earns 0 pts but still logs
            // for the audit trail.
            let rewardsAmount = all ? (venue.supplied ?? 0) : (amtUsd ?? 0)
            let reasonAmount: String = all
                ? String(format: "$%.2f", venue.supplied ?? 0)
                : String(format: "$%.2f", amtUsd ?? 0)
            try await PinGate.shared.requireUserPresence(
                reason: "Withdraw \(reasonAmount) from earnings"
            )
            let result = try await ZkLoginCoordinator.shared.signAndSubmit(
                transactionKindB64: built.transactionKindB64,
                intent: all
                    ? "Withdraw all earnings"
                    : "Withdraw \(symbol)\(partial) earnings",
                rewards: ZkLoginCoordinator.RewardsMeta(
                    kind: "withdraw",
                    amountUsd: rewardsAmount,
                    venue: venue.venue
                )
            )
            success = result.digest
            NotificationCenter.default.post(
                name: .taliseTxCompleted,
                object: TaliseTxEvent(
                    digest: result.digest,
                    direction: "withdraw",
                    // For "withdraw all" we don't know the exact
                    // accrued-interest yet (DeepBook redeems shares,
                    // not USDsui units). Fall back to the on-screen
                    // supplied snapshot — the 1.5s reconcile refresh
                    // will replace this with the canonical amount.
                    amountUsdsui: all ? (venue.supplied ?? 0) : (amtUsd ?? 0),
                    counterparty: nil,
                    counterpartyName: nil,
                    venue: venue.venue
                )
            )
            partial = ""
            onClose()
            // Give the user a beat to see the success state, then close.
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            dismiss()
        } catch PinError.cancelled {
            self.error = nil
        } catch PinError.forgotSignOut {
            self.error = "Sign in again to set a new PIN."
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Withdraw ONLY the accrued yield, leaving the principal in place
    /// to keep earning. The server computes `earned` at request time
    /// from a fresh on-chain replay — we don't send an amount on the
    /// wire so a stale UI value can't accidentally redeem more than
    /// the user has earned. Mirrors `withdraw(all:)` for everything
    /// after the prepare leg (sign + rewards + history reconcile).
    private func withdrawEarned() async {
        withdrawing = true
        error = nil
        success = nil
        defer { withdrawing = false }
        do {
            struct Body: Encodable { let venue: String }
            let built: BuildKindResponse = try await APIClient.shared.post(
                "/api/earn/withdraw-earned/prepare",
                body: Body(venue: venue.venue)
            )
            // For the rewards-engine hint we forward the UI-side
            // earned snapshot (USDsui = USD). Server clips to its
            // per-tx cap so a stale value doesn't grant extra points.
            let rewardsAmount = earnedSoFar ?? 0
            let result = try await ZkLoginCoordinator.shared.signAndSubmit(
                transactionKindB64: built.transactionKindB64,
                intent: "Withdraw earned yield",
                rewards: ZkLoginCoordinator.RewardsMeta(
                    kind: "withdraw",
                    amountUsd: rewardsAmount,
                    venue: venue.venue
                )
            )
            success = result.digest
            NotificationCenter.default.post(
                name: .taliseTxCompleted,
                object: TaliseTxEvent(
                    digest: result.digest,
                    direction: "withdraw",
                    // Server returned the precise USDsui earned in the
                    // prepare response, but the iOS-side snapshot is
                    // close enough for the optimistic activity row —
                    // the 1.5s reconcile picks up the canonical value.
                    amountUsdsui: rewardsAmount,
                    counterparty: nil,
                    counterpartyName: nil,
                    venue: venue.venue
                )
            )
            onClose()
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Earn opt-in disclosure

/// One-time disclosure presented before the user's FIRST supply. Its job
/// is regulatory + framing hygiene (master plan §8, §9 — GENIUS yield-ban
/// recharacterization risk): make it unmistakable that Earn is a SEPARATE,
/// opt-in lending service routed through a third-party DeFi protocol, NOT
/// a property of the Talise balance, and that yield is variable and not
/// guaranteed. The user must tap "I understand — continue" to proceed; the
/// supply only runs after that explicit acceptance. Dismissing without
/// accepting does nothing — Talise NEVER auto-supplies funds.
private struct EarnDisclosureSheet: View {
    /// Best venue APY (fraction, e.g. 0.04) used only to make the headline
    /// concrete ("around 4.00%") — copy stays honest about variability.
    let apy: Double
    /// Plural money word for the user's display currency ("naira", "dollars").
    let moneyWord: String
    let onAccept: () -> Void
    let onCancel: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 22) {
                    header
                    pointsCard
                    Text("By continuing you’re choosing to use this optional service. You can withdraw your money at any time. This is not financial advice.")
                        .font(TaliseFont.body(12, weight: .light))
                        .foregroundStyle(TaliseColor.fgDim)
                    Spacer(minLength: 8)
                }
                .padding(.horizontal, 24)
                .padding(.top, 26)
            }
            actionBar
        }
        .liquidGlassSheet(accent: TaliseColor.accent)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            MicroLabel(text: "Before you start", color: TaliseColor.fgDim).kerning(1.5)
            Text(apy > 0
                 ? String(format: "Earn around %.2f%% on your %@", apy * 100, moneyWord)
                 : "Earn on your \(moneyWord)")
                .font(TaliseFont.heading(24, weight: .medium))
                .kerning(-1)
                .foregroundStyle(TaliseColor.fg)
            Text("A few things to know first.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
        }
    }

    /// The three load-bearing disclosure points. Order is deliberate:
    /// (1) it's a separate service, (2) not part of your balance,
    /// (3) returns aren't guaranteed.
    private var pointsCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            point(
                icon: "building.columns",
                title: "A separate lending service",
                body: "Earn is optional and runs through a third-party lending protocol. It’s not a banking or savings product offered by Talise."
            )
            divider
            point(
                icon: "wallet.pass",
                title: "Not part of your balance",
                body: "Money you put into Earn is moved into the lending service, separate from your spendable balance. You choose what to add — nothing moves automatically."
            )
            divider
            point(
                icon: "chart.line.uptrend.xyaxis",
                title: "Returns aren’t guaranteed",
                body: "Rates vary and can change. Earnings are not guaranteed, and your money is not insured or protected against loss."
            )
        }
        .padding(.vertical, 6)
        .taliseGlass(cornerRadius: 20)
    }

    private func point(icon: String, title: String, body: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(TaliseColor.accent)
                .frame(width: 22, alignment: .center)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(TaliseFont.heading(15, weight: .medium))
                    .kerning(-0.3)
                    .foregroundStyle(TaliseColor.fg)
                Text(body)
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
    }

    private var divider: some View {
        LiquidGlassDivider(inset: 18)
    }

    private var actionBar: some View {
        VStack(spacing: 10) {
            LiquidGlassButton(
                title: "I understand — continue",
                tint: TaliseColor.accent,
                size: .lg
            ) {
                onAccept()
            }
            LiquidGlassButton(
                title: "Not now",
                tint: nil,
                size: .md
            ) {
                onCancel()
                dismiss()
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 12)
        .padding(.bottom, 32)
    }
}
