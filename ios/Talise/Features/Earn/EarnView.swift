import SwiftUI

/// Live yield comparison + sponsored supply into the best venue.
/// Reads /api/yield/comparison, supplies USDsui via /api/earn/supply/build
/// → ZkLoginCoordinator (Onara sponsored).
struct EarnView: View {
    @State private var comparison: YieldComparison?
    @State private var loading = true
    @State private var error: String?
    /// The venue the user tapped — drives the combined Add money / Withdraw
    /// sheet (`EarnManageSheet`). Both the deposit and withdraw flows live in
    /// that sheet now, so the main screen stays compact. Reset to nil to dismiss.
    @State private var manageTarget: YieldVenue?
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
            VStack(alignment: .leading, spacing: 28) {
                venueSection
                // Money-management sections. Each owns its own data fetch
                // via .task internally; RoundupCard needs `summary` so we
                // fetch it here. (The big rate hero, the on-screen deposit
                // bar, and the monthly-analytics section were removed — the
                // venue row already shows the rate, and deposit + withdraw
                // both live inside the venue sheet now.)
                RoundupCard(summary: rewardsSummary, onChange: { Task { await loadRewards() } })
                GoalsSection()
                if let error {
                    Text(error)
                        .font(TaliseFont.body(12, weight: .light))
                        .foregroundStyle(TaliseColor.danger)
                }
                Spacer(minLength: 120)
            }
            .padding(.horizontal, 22)
            .padding(.top, 24)
        }
        .refreshable { await load(); await loadRewards() }
        .taliseScreenBackground()
        .task { await load() }
        .task { await loadRewards() }
        // Tapping any venue opens the combined Add money / Withdraw sheet.
        // Deposit + withdraw + the one-time disclosure gate + their success
        // states all live inside that sheet (it mounts its own PIN host),
        // so the main screen stays clean.
        .sheet(item: $manageTarget) { v in
            EarnManageSheet(venue: v, bestApy: comparison?.best?.apy ?? 0) {
                // After a successful deposit or withdraw, refresh the venue
                // cards so the supplied amount updates.
                Task { await load() }
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

    /// Venues sorted best-first so the highest-yield option leads the list
    /// (and gets the BEST tag). The `best` venue from the comparison floats
    /// to the top; the rest keep their server order.
    private func orderedVenues(_ cmp: YieldComparison) -> [YieldVenue] {
        let visible = visibleVenues(cmp.venues)
        guard let best = cmp.best?.venue else { return visible }
        return visible.sorted { a, _ in a.venue == best }
    }

    private var venueSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Where your money earns")
            venueListCard
        }
    }

    @ViewBuilder
    private var venueListCard: some View {
        VStack(spacing: 0) {
            if loading {
                venueSkeletonRow
                RowDivider()
                venueSkeletonRow
            } else if let cmp = comparison, !cmp.venues.isEmpty {
                let venues = orderedVenues(cmp)
                ForEach(Array(venues.enumerated()), id: \.element.id) { idx, v in
                    venueRow(v, best: v.venue == cmp.best?.venue)
                    if idx < venues.count - 1 { RowDivider() }
                }
            } else {
                emptyState
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 4)
        .taliseGlass(cornerRadius: 20)
    }

    private var venueSkeletonRow: some View {
        HStack(spacing: 14) {
            Circle().fill(TaliseColor.surface2).frame(width: 36, height: 36)
            VStack(alignment: .leading, spacing: 6) {
                Capsule().fill(TaliseColor.line).frame(width: 80, height: 10)
                Capsule().fill(TaliseColor.line).frame(width: 50, height: 8)
            }
            Spacer()
        }
        .frame(minHeight: 60)
        .padding(.vertical, 4)
        .redacted(reason: .placeholder)
        .opacity(0.6)
    }

    private var emptyState: some View {
        VStack(spacing: 4) {
            Text("No live venues right now.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
            Text("Pull to refresh.")
                .font(TaliseFont.mono(10, weight: .regular))
                .foregroundStyle(TaliseColor.fgDim)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
        .padding(.vertical, 22)
    }

    @ViewBuilder
    private func venueRow(_ v: YieldVenue, best: Bool) -> some View {
        let hasPosition = (v.supplied ?? 0) > 0
        // APY < 1bp reads as "—" instead of "0.00%". DeepBook's USDsui
        // margin pool currently has near-zero borrow utilization
        // (suppliers earn util × borrowRate × 0.8); calling that "0.00%
        // APY" misleads — it's "no demand for loans right now" not
        // "guaranteed to pay 0".
        let live = v.apy >= 0.0001
        let apyText = live ? String(format: "%.2f%%", v.apy * 100) : "—"
        // Localized subtitle — Nigerian user sees ₦, US user sees $, UK
        // sees £, etc. Routes through TaliseFormat / CurrencySettings.
        let subtitle = hasPosition ? "Supplied \(TaliseFormat.local2(v.supplied ?? 0))" : "Tap to add money"

        Button {
            // Always opens the combined Add money / Withdraw sheet — idle
            // rows open straight to "Add money" (there's no on-screen deposit
            // bar anymore); rows with a position can switch to Withdraw.
            manageTarget = v
        } label: {
            PremiumListRow(
                icon: "leaf.fill",
                kind: hasPosition ? .earn : .neutral,
                title: v.displayName,
                subtitle: subtitle,
                showsChevron: true
            ) {
                HStack(spacing: 8) {
                    if best {
                        Text("BEST")
                            .font(TaliseFont.mono(9, weight: .regular))
                            .tracking(1)
                            .foregroundStyle(TaliseColor.accent)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(
                                Capsule().fill(TaliseColor.accent.opacity(0.15))
                            )
                    }
                    Text(apyText)
                        .font(TaliseFont.heading(22, weight: .medium))
                        .kerning(-0.8)
                        .foregroundStyle(live ? TaliseColor.accent : TaliseColor.fgDim)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

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
}

// MARK: - Earn manage sheet (Add money / Withdraw)

/// The single entry point for both deposit and withdraw — opens when the
/// user taps any venue row. A segmented control switches between:
///   • Add money — amount field + a one-year earnings projection, gated
///     behind the one-time opt-in disclosure on the FIRST supply.
///   • Withdraw  — partial amount, "Withdraw all", and "Withdraw earned".
/// Folding both flows in here keeps the main Invest screen compact (no
/// on-screen deposit bar). Deposit POSTs /api/earn/supply/prepare; withdraw
/// POSTs /api/earn/withdraw/prepare — both → ZkLoginCoordinator. The sheet
/// mounts its own PIN host so confirmations surface inside it.
private struct EarnManageSheet: View {
    let venue: YieldVenue
    let bestApy: Double
    let onClose: () -> Void

    private enum Mode: Equatable { case add, withdraw }

    @Environment(\.dismiss) private var dismiss
    @State private var mode: Mode = .add
    @State private var depositText = ""
    @State private var depositing = false
    @State private var showDisclosure = false
    @State private var partial = ""
    @State private var withdrawing = false
    @State private var error: String?
    @State private var success: String?

    /// Plural "money word" for the user's display currency, for the
    /// disclosure copy ("earn on your naira"). Falls back to "money".
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

    // MARK: Deposit (Add money)

    /// Typed deposit amount converted from display currency to USD (USDsui
    /// is 1:1 USD). 0 when empty/malformed. Single source of truth for the
    /// projection, the button label, and the /supply/prepare body.
    private var depositUsd: Double {
        guard let local = Double(depositText), local > 0 else { return 0 }
        return CurrencySettings.shared.convertToUsd(local: local)
    }

    private var canDeposit: Bool { depositUsd > 0 && !depositing }

    private var depositLabel: String {
        guard depositUsd > 0 else { return "Start earning" }
        return "Add \(TaliseFormat.local2(depositUsd))"
    }

    /// Projected yearly earnings (USD) for the typed amount at this venue's
    /// APY. Nil when no amount / zero APY.
    private var depositAnnual: Double? {
        let usd = depositUsd
        guard usd > 0, apy > 0 else { return nil }
        return usd * apy
    }

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
                VStack(alignment: .leading, spacing: 28) {
                    header
                    // Segmented Add / Withdraw — only when there's a position
                    // to withdraw. Idle venues open straight into Add money,
                    // so a brand-new user isn't shown a withdraw tab they
                    // can't use.
                    if supplied > 0 {
                        modePicker
                        positionCard
                    }
                    if mode == .add || supplied <= 0 {
                        addField
                    } else {
                        partialField
                    }
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
                .padding(.horizontal, 22)
                .padding(.top, 24)
            }
            actionBar
        }
        // Liquid Glass sheet treatment — the material backdrop +
        // accent top wash mirrors what the rest of the app does for
        // modals (see Profile, Send). Replaces the plain-black
        // ignore-safe-area background that read as a flat plate.
        .liquidGlassSheet(accent: TaliseColor.accent)
        // Large-only detent so the sheet opens with everything visible
        // without an extra drag.
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        // Host the PIN sheet inside this sheet's own presentation context so
        // deposit + withdraw confirmations surface from here.
        .pinGateHost()
        // One-time opt-in disclosure before the FIRST deposit — presented
        // from inside this sheet so, on accept, the supply continues in
        // context. The supply NEVER runs without this explicit acceptance.
        .sheet(isPresented: $showDisclosure) {
            EarnDisclosureSheet(
                apy: bestApy,
                moneyWord: moneyWord,
                onAccept: {
                    EarnView.markEarnDisclosureAccepted()
                    showDisclosure = false
                    Task { await deposit() }
                },
                onCancel: { showDisclosure = false }
            )
        }
    }

    /// Segmented Add money / Withdraw control — a branded two-segment pill
    /// (selected = solid accent + dark ink, the rest quiet).
    private var modePicker: some View {
        HStack(spacing: 4) {
            segmentButton("Add money", .add)
            segmentButton("Withdraw", .withdraw)
        }
        .padding(4)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(TaliseColor.surface2)
        )
    }

    private func segmentButton(_ title: String, _ m: Mode) -> some View {
        Button {
            withAnimation(.easeOut(duration: 0.15)) { mode = m }
        } label: {
            Text(title)
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(mode == m ? TaliseColor.bg : TaliseColor.fgMuted)
                .frame(maxWidth: .infinity)
                .frame(height: 38)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(mode == m ? TaliseColor.accent : Color.clear)
                )
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var header: some View {
        if mode == .add && supplied <= 0 {
            // First deposit: lead with the rate you'll earn. (Not a
            // duplicate of the main-screen venue row — that's out of view
            // behind this sheet.)
            HeroAmount(
                eyebrow: "Earn rate",
                value: String(format: "%.2f%%", apy * 100),
                caption: "On your \(moneyWord) · withdraw anytime"
            )
        } else {
            // Existing position: show what they hold / have earned. Symbol
            // rides the figure; the localized formatter is applied to the
            // pre-symbol value via a stripped local2.
            let symbol = CurrencySettings.shared.current.symbol
            let heroUsd = earnedSoFar ?? supplied
            HeroAmount(
                eyebrow: earnedSoFar != nil ? "Your earnings" : "Your position",
                value: localAmount(heroUsd),
                symbol: symbol,
                caption: earnedSoFar != nil
                    ? "Interest accrued on \(TaliseFormat.local2(supplied))"
                    : "Supplied and earning"
            )
        }
    }

    /// Add-money amount field + a one-year earnings projection. Mirrors the
    /// withdraw field's styling so the two modes feel identical.
    private var addField: some View {
        let currency = CurrencySettings.shared.current
        return VStack(alignment: .leading, spacing: 14) {
            SectionHeader("Add to earnings")
            HStack(spacing: 6) {
                Text(currency.symbol)
                    .font(TaliseFont.heading(22, weight: .medium))
                    .foregroundStyle(TaliseColor.fgDim)
                TextField("0.00", text: $depositText)
                    .keyboardType(.decimalPad)
                    .font(TaliseFont.heading(22, weight: .medium))
                    .kerning(-0.6)
                    .foregroundStyle(TaliseColor.fg)
                    .tint(TaliseColor.accent)
                Spacer()
                Text(currency.code)
                    .font(TaliseFont.mono(11, weight: .regular))
                    .foregroundStyle(TaliseColor.fgDim)
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(TaliseColor.surface2)
            )
            if let annual = depositAnnual {
                projectionBand(annual)
            }
        }
    }

    /// "You'll earn a year" band — year is the hero, day/month sit beneath.
    private func projectionBand(_ annual: Double) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("YOU'LL EARN A YEAR")
                .font(TaliseFont.mono(10, weight: .regular)).tracking(2.0)
                .foregroundStyle(TaliseColor.fgMuted)
            Text(TaliseFormat.local(annual))
                .font(TaliseFont.heading(18, weight: .medium))
                .kerning(-0.6)
                .foregroundStyle(TaliseColor.accent)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            HStack(spacing: 6) {
                Text("\(TaliseFormat.local(annual / 365.0)) a day")
                Text("·")
                Text("\(TaliseFormat.local(annual / 12.0)) a month")
            }
            .font(TaliseFont.mono(11, weight: .regular))
            .kerning(-0.32)
            .foregroundStyle(TaliseColor.fgDim)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(TaliseColor.surface2)
        )
        .transition(.opacity.combined(with: .move(edge: .top)))
        .animation(.easeInOut(duration: 0.18), value: depositText)
    }

    /// Local-currency figure WITHOUT the symbol — `HeroAmount` rides the
    /// symbol separately. `TaliseFormat.local2` prefixes the symbol, so we
    /// strip it here for the hero's symbol slot.
    private func localAmount(_ usd: Double) -> String {
        let formatted = TaliseFormat.local2(usd)
        let symbol = CurrencySettings.shared.current.symbol
        if formatted.hasPrefix(symbol) {
            return String(formatted.dropFirst(symbol.count))
        }
        return formatted
    }

    private var positionCard: some View {
        // Localized — Nigerian user sees ₦, US user sees $, GB sees £,
        // etc. The on-chain values are still USDsui (1:1 USD); the
        // local formatter applies CurrencySettings.shared.current.
        VStack(spacing: 0) {
            row(label: "Supplied", value: TaliseFormat.local2(supplied))
            RowDivider(inset: 18)
            row(
                label: "APY",
                value: String(format: "%.2f%%", apy * 100),
                accent: true
            )
            // "Earned so far" — server-computed cumulative yield since
            // the user's first supply. Only shown when the venue
            // exposes the breakdown (Navi today). Green accent so the
            // user reads it as the earnings number.
            if let earned = earnedSoFar {
                RowDivider(inset: 18)
                row(
                    label: "Earned so far",
                    value: TaliseFormat.local2(earned),
                    accent: true
                )
            }
            RowDivider(inset: 18)
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
        .padding(.horizontal, 20)
        .padding(.vertical, 4)
        .taliseGlass(cornerRadius: 20)
    }

    private func row(label: String, value: String, accent: Bool = false) -> some View {
        HStack {
            Text(label)
                .font(TaliseFont.body(14, weight: .light))
                .kerning(-0.48)
                .foregroundStyle(TaliseColor.fgMuted)
            Spacer()
            Text(value)
                .font(TaliseFont.body(14, weight: .light))
                .kerning(-0.56)
                .foregroundStyle(accent ? TaliseColor.accent : TaliseColor.fg)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(minHeight: 52)
    }

    private var partialField: some View {
        let currency = CurrencySettings.shared.current
        return VStack(alignment: .leading, spacing: 10) {
            SectionHeader("Withdraw amount")
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    // Symbol prefix so the value reads naturally for the
                    // user's locale. Input + display + the MAX shortcut
                    // all stay in their selected currency; conversion to
                    // USDsui happens once at submit via partialUsd.
                    Text(currency.symbol)
                        .font(TaliseFont.heading(22, weight: .medium))
                        .foregroundStyle(TaliseColor.fgDim)
                    TextField("0.00", text: $partial)
                        .keyboardType(.decimalPad)
                        .font(TaliseFont.heading(22, weight: .medium))
                        .kerning(-0.6)
                        .foregroundStyle(TaliseColor.fg)
                        .tint(TaliseColor.accent)
                    Spacer()
                    Text(currency.code)
                        .font(TaliseFont.mono(11, weight: .regular))
                        .foregroundStyle(TaliseColor.fgDim)
                }
                HStack {
                    MicroLabel(
                        text: "Available \(TaliseFormat.local2(supplied))",
                        color: TaliseColor.fgDim
                    )
                    Spacer()
                    LiquidGlassPill(title: "MAX", tint: TaliseColor.accent, compact: true) {
                        // Convert the on-chain supplied USDsui balance to
                        // the user's display currency so MAX fills the
                        // field in the units they're typing in.
                        let (localMax, _) = CurrencySettings.shared.convert(usd: supplied)
                        partial = String(format: "%.2f", localMax)
                    }
                }
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(TaliseColor.surface2)
            )
        }
    }

    /// The pinned bottom action bar — the deposit CTA in Add mode, the
    /// withdraw CTAs in Withdraw mode.
    @ViewBuilder
    private var actionBar: some View {
        if mode == .add || supplied <= 0 {
            depositActionBar
        } else {
            withdrawActionBar
        }
    }

    private var depositActionBar: some View {
        VStack(spacing: 12) {
            LiquidGlassButton(
                title: depositing ? "Adding…" : depositLabel,
                tint: TaliseColor.accent,
                size: .lg,
                loading: depositing
            ) {
                depositTapped()
            }
            .disabled(!canDeposit)
        }
        .padding(.horizontal, 22)
        .padding(.top, 12)
        .padding(.bottom, 32)
    }

    private var withdrawActionBar: some View {
        // ONE primary CTA (the partial withdraw) — the "earned" and
        // "all" shortcuts sit beneath as quiet pills so nothing competes
        // with the primary. All three actions are preserved.
        VStack(spacing: 12) {
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

            HStack(spacing: 10) {
                // "Withdraw earned" — server computes the exact USDsui
                // earned amount at request time so the value on the
                // label can lag chain truth by a few seconds without a
                // misclick burning the user's principal. Only shown when
                // there's enough accrued yield to be worth the gas (see
                // WITHDRAW_EARNED_DUST_USD).
                if let earned = earnedSoFar, canWithdrawEarned {
                    let (local, _) = CurrencySettings.shared.convert(usd: earned)
                    let label = "Earned \(CurrencySettings.shared.current.symbol)\(String(format: "%.2f", local))"
                    LiquidGlassPill(title: label, tint: TaliseColor.accent) {
                        Task { await withdrawEarned() }
                    }
                    .disabled(withdrawing)
                }
                LiquidGlassPill(title: "Withdraw all + rewards") {
                    Task { await withdraw(all: true) }
                }
                .disabled(withdrawing || supplied <= 0)
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, 22)
        .padding(.top, 12)
        .padding(.bottom, 32)
    }

    private func successBanner(_ digest: String) -> some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().fill(TaliseColor.accent.opacity(0.18)).frame(width: 36, height: 36)
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(TaliseColor.accent)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(mode == .add ? "Added to earnings" : "Withdrawn")
                    .font(TaliseFont.body(14, weight: .light)).kerning(-0.48)
                    .foregroundStyle(TaliseColor.fg)
                Text(digest.prefix(20) + "…")
                    .font(TaliseFont.mono(11)).kerning(-0.32)
                    .foregroundStyle(TaliseColor.fgDim)
            }
            Spacer(minLength: 8)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .taliseGlass(cornerRadius: 20, tint: TaliseColor.accent)
    }

    // MARK: Deposit action

    /// Deposit entry point. On the user's FIRST supply we present the opt-in
    /// disclosure (which, on accept, runs `deposit()`); once accepted we go
    /// straight to it. We NEVER auto-supply — the user always taps through.
    private func depositTapped() {
        guard canDeposit else { return }
        if EarnView.hasAcceptedEarnDisclosure() {
            Task { await deposit() }
        } else {
            showDisclosure = true
        }
    }

    /// Supply into THIS venue. Mirrors the withdraw flow: prepare → PIN →
    /// sign + submit → optimistic activity row → brief success → dismiss.
    /// `depositUsd` converts the local-currency input to USDsui (1:1 USD)
    /// once, at the wire boundary.
    private func deposit() async {
        let usd = depositUsd
        guard usd > 0 else { return }
        depositing = true
        error = nil
        success = nil
        defer { depositing = false }
        do {
            struct Body: Encodable { let venue: String; let amount: Double }
            let built: BuildKindResponse = try await APIClient.shared.post(
                "/api/earn/supply/prepare",
                body: Body(venue: venue.venue, amount: usd)
            )
            let symbol = CurrencySettings.shared.current.symbol
            let amountForPrompt = String(format: "$%.2f", usd)
            try await PinGate.shared.requireUserPresence(
                reason: "Start earning on \(amountForPrompt)"
            )
            let result = try await ZkLoginCoordinator.shared.signAndSubmit(
                transactionKindB64: built.transactionKindB64,
                intent: "Earn \(symbol)\(depositText)",
                rewards: ZkLoginCoordinator.RewardsMeta(
                    kind: "invest",
                    amountUsd: usd,
                    venue: venue.venue
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
                    venue: venue.venue
                )
            )
            depositText = ""
            onClose()
            // Brief beat to read the success state, then close.
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
                VStack(alignment: .leading, spacing: 28) {
                    header
                    pointsCard
                    Text("By continuing you’re choosing to use this optional service. You can withdraw your money at any time. This is not financial advice.")
                        .font(TaliseFont.body(12, weight: .light))
                        .foregroundStyle(TaliseColor.fgDim)
                        .padding(.horizontal, 4)
                    Spacer(minLength: 8)
                }
                .padding(.horizontal, 22)
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
            Text("BEFORE YOU START")
                .font(TaliseFont.mono(10, weight: .regular)).tracking(2.0)
                .foregroundStyle(TaliseColor.fgMuted)
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
        VStack(spacing: 0) {
            point(
                icon: "building.columns",
                title: "A separate lending service",
                body: "Earn is optional and runs through a third-party lending protocol. It’s not a banking or savings product offered by Talise."
            )
            RowDivider()
            point(
                icon: "wallet.pass",
                title: "Not part of your balance",
                body: "Money you put into Earn is moved into the lending service, separate from your spendable balance. You choose what to add — nothing moves automatically."
            )
            RowDivider()
            point(
                icon: "chart.line.uptrend.xyaxis",
                title: "Returns aren’t guaranteed",
                body: "Rates vary and can change. Earnings are not guaranteed, and your money is not insured or protected against loss."
            )
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 4)
        .taliseGlass(cornerRadius: 20)
    }

    private func point(icon: String, title: String, body: String) -> some View {
        // Mirrors the `PremiumListRow` badge (36×36 earn disc + accent
        // glyph) so the disclosure reads as part of the same kit, but
        // carries a wrapping body paragraph the universal row can't — the
        // explainer text here is regulatory and must render in full.
        HStack(alignment: .top, spacing: 14) {
            ZStack {
                Circle().fill(TaliseColor.accent.opacity(0.18)).frame(width: 36, height: 36)
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(TaliseColor.accent)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(TaliseFont.body(14, weight: .light)).kerning(-0.48)
                    .foregroundStyle(TaliseColor.fg)
                Text(body)
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 16)
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
            Button {
                onCancel()
                dismiss()
            } label: {
                Text("Not now")
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .frame(maxWidth: .infinity)
                    .frame(height: 36)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 22)
        .padding(.top, 12)
        .padding(.bottom, 32)
    }
}
