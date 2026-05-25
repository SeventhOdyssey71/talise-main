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
    /// Active position (non-nil supplied amount) the user tapped on —
    /// drives the withdraw sheet. Reset to nil to dismiss.
    @State private var withdrawTarget: YieldVenue?
    /// Rewards summary fetched here (not via the Rewards tab) because
    /// `RoundupCard` lives on Invest now and needs the round-up config.
    /// Cheap GET; we refetch on pull-to-refresh + after the user
    /// toggles round-up so the "Saved this month" running tally stays
    /// in sync with the on-chain compound supplies.
    @State private var rewardsSummary: RewardsSummary?

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
                if let success {
                    successBanner(success)
                }
                Spacer(minLength: 120)
            }
            .padding(.horizontal, 24)
            .padding(.top, 24)
        }
        .refreshable { await load(); await loadRewards() }
        .taliseScreenBackground()
        .task { await load() }
        .task { await loadRewards() }
        .sheet(item: $withdrawTarget) { v in
            WithdrawSheet(venue: v, bestApy: comparison?.best?.apy ?? 0) {
                // After a successful withdraw, refresh the venue cards
                // so the supplied amount drops back to "Idle".
                Task { await load() }
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            MicroLabel(text: "Earn", color: TaliseColor.fgDim).kerning(1.5)
            Text("Make your money work")
                .font(TaliseFont.heading(24, weight: .medium))
                .kerning(-1)
                .foregroundStyle(TaliseColor.fg)
            if let best = comparison?.best {
                Text(String(format: "Best: %@ · %.2f%% APY", best.displayName, best.apy * 100))
                    .font(TaliseFont.mono(11, weight: .light))
                    .foregroundStyle(TaliseColor.accent)
            }
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
        .background(TaliseColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20))
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
        .background(TaliseColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20))
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
                    HStack(spacing: 8) {
                        Text(v.displayName)
                            .font(TaliseFont.heading(14, weight: .medium))
                            .foregroundStyle(TaliseColor.fg)
                        if best {
                            Text("BEST")
                                .font(TaliseFont.mono(9, weight: .light))
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(TaliseColor.accent.opacity(0.18))
                                .foregroundStyle(TaliseColor.accent)
                                .clipShape(Capsule())
                        }
                    }
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
            .background(TaliseColor.surface)
            .overlay(
                RoundedRectangle(cornerRadius: 20)
                    .stroke(best ? TaliseColor.accent.opacity(0.4) : Color.clear, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 20))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!hasPosition)
    }

    // MARK: - Supply card

    private var supplyCard: some View {
        let currency = CurrencySettings.shared.current
        return VStack(alignment: .leading, spacing: 14) {
            MicroLabel(text: "Supply \(currency.code)", color: TaliseColor.fgDim).kerning(1.5)
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
            .background(TaliseColor.usernameCard)
            .clipShape(RoundedRectangle(cornerRadius: 16))

            if let projection = earningsProjection {
                projectionBand(projection)
            }

            Button(action: { Task { await supply() } }) {
                HStack(spacing: 10) {
                    if supplying {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(TaliseColor.bg)
                    }
                    Text(supplying ? "Supplying…" : supplyLabel)
                        .font(TaliseFont.heading(15, weight: .medium))
                }
                .foregroundStyle(TaliseColor.bg)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(canSupply ? TaliseColor.fg : TaliseColor.fg.opacity(0.35))
                .clipShape(Capsule())
            }
            .disabled(!canSupply)
        }
        .padding(20)
        .background(TaliseColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 25))
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
            .background(TaliseColor.usernameCard)
            .clipShape(RoundedRectangle(cornerRadius: 16))
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
        Rectangle()
            .fill(Color.white.opacity(0.05))
            .frame(height: 1)
            .padding(.horizontal, 12)
    }

    private func formatProjection(_ v: Double) -> String {
        // Routes through the user's display-currency setting so
        // earnings show in ₦ for a Nigerian, $ for a US user, etc.
        // Falls back to USD output until /api/fx has loaded.
        TaliseFormat.local(v)
    }

    private var supplyLabel: String {
        guard let best = comparison?.best else { return "Supply" }
        guard let local = Double(amount), local > 0 else {
            return "Supply to \(best.displayName)"
        }
        // Render the button caption in the user's display currency
        // (₦12,000 not "$12000") so the action matches the input pill.
        return "Supply \(TaliseFormat.local2(amountUsd)) to \(best.displayName)"
    }

    private func successBanner(_ digest: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(TaliseColor.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text("Supplied")
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
            comparison = try await APIClient.shared.get("/api/yield/comparison")
        } catch {
            self.error = error.localizedDescription
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
                let result = try await ZkLoginCoordinator.shared.signAndSubmit(
                    transactionKindB64: built.transactionKindB64,
                    intent: "Supply \(symbol)\(localAmount) to \(displayVenueName(venue))",
                    rewards: ZkLoginCoordinator.RewardsMeta(
                        kind: "invest",
                        amountUsd: usd,
                        venue: venue
                    )
                )
                success = result.digest
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
    /// Daily yield in USD at this APY × current position.
    private var dailyEarning: Double { supplied * apy / 365.0 }

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
        // Plain black background — the TopGlow belongs only on root
        // tab screens. A modal sheet inheriting that wash made the
        // sheet's content compete with the home page bleeding through
        // behind, and the green hue clashed with the WithdrawSheet's
        // own accent-green action button + position card.
        .background(TaliseColor.bg.ignoresSafeArea())
        // Large-only detent so the sheet opens with the position card,
        // withdraw-amount input, and both action buttons visible
        // without an extra drag. The `.medium` option made the sheet
        // land halfway up, cutting off the amount field — exactly the
        // case the user flagged.
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            MicroLabel(text: "Position", color: TaliseColor.fgDim).kerning(1.5)
            Text(venue.displayName)
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
        .background(TaliseColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20))
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
        Rectangle()
            .fill(Color.white.opacity(0.05))
            .frame(height: 1)
            .padding(.horizontal, 14)
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
                Button {
                    // Convert the on-chain supplied USDsui balance to
                    // the user's display currency so MAX fills the
                    // field in the units they're typing in.
                    let (localMax, _) = CurrencySettings.shared.convert(usd: supplied)
                    partial = String(format: "%.2f", localMax)
                } label: {
                    Text("MAX")
                        .font(TaliseFont.mono(10, weight: .light))
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(TaliseColor.accent.opacity(0.18))
                        .foregroundStyle(TaliseColor.accent)
                        .clipShape(Capsule())
                }
                Text(currency.code)
                    .font(TaliseFont.heading(13, weight: .medium))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
            .padding(14)
            .background(TaliseColor.usernameCard)
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
    }

    private var actionBar: some View {
        VStack(spacing: 10) {
            Button(action: { Task { await withdraw(all: false) } }) {
                HStack(spacing: 10) {
                    if withdrawing { ProgressView().tint(TaliseColor.bg) }
                    Text(withdrawing
                         ? "Working…"
                         : "Withdraw \(partial.isEmpty ? "" : "\(CurrencySettings.shared.current.symbol)\(partial)")")
                        .font(TaliseFont.heading(15, weight: .medium))
                }
                .foregroundStyle(TaliseColor.bg)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(canWithdrawPartial ? TaliseColor.fg : TaliseColor.fg.opacity(0.35))
                .clipShape(Capsule())
            }
            .disabled(!canWithdrawPartial)

            Button(action: { Task { await withdraw(all: true) } }) {
                Text("Withdraw all + rewards")
                    .font(TaliseFont.heading(14, weight: .medium))
                    .foregroundStyle(TaliseColor.accent)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .overlay(
                        Capsule().stroke(TaliseColor.accent.opacity(0.5), lineWidth: 1)
                    )
            }
            .disabled(withdrawing || supplied <= 0)
        }
        .padding(.horizontal, 24)
        .padding(.top, 12)
        .padding(.bottom, 32)
        .background(TaliseColor.bg)
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
        .background(TaliseColor.accent.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: 16))
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
            let result = try await ZkLoginCoordinator.shared.signAndSubmit(
                transactionKindB64: built.transactionKindB64,
                intent: all
                    ? "Withdraw all from \(venue.displayName)"
                    : "Withdraw \(symbol)\(partial) from \(venue.displayName)",
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
        } catch {
            self.error = error.localizedDescription
        }
    }
}
