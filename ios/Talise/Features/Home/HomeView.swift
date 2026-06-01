import SwiftUI

/// Figma node 42-1819 — Home, dark mode. Real data: balance from
/// /api/balances, activity from /api/activity. Empty state matches the
/// Figma "no rows" look (a single muted card).
struct HomeView: View {
    @Environment(AppSession.self) private var session
    @State private var balance: BalancesDTO?
    @State private var activity: [ActivityEntryDTO] = []
    /// False only when there is a cached snapshot to show immediately —
    /// in that case we skip the placeholder/skeleton on first render so
    /// the user sees real numbers instead of grey blobs.
    @State private var loadingBalance = true
    @State private var loadingActivity = true
    /// True once `/api/activity` has returned at least one successful
    /// response in the current view lifetime. Used to suppress the
    /// loading skeleton on transient retries — we keep the prior rows
    /// on screen instead of flashing back to a skeleton.
    @State private var activityHasLoadedOnce = false
    /// Optimistic-stub registry. Keyed on digest, value is the stub
    /// entry we prepended. Survives across `loadActivity*` calls so a
    /// late-arriving canonical row (or any background reload that
    /// wholesale-replaces `activity = r.entries`) can't wipe the
    /// user's freshly-tapped Send/Invest/Withdraw row from view. Each
    /// stub is auto-evicted from the registry the first time its
    /// digest shows up in the server response (server has caught up)
    /// OR after a 90s safety TTL (server never caught up → assume tx
    /// failed silently, stop showing the stub).
    @State private var pendingOptimisticStubs: [String: ActivityEntryDTO] = [:]
    @State private var pendingOptimisticAt: [String: Date] = [:]
    /// Toast banner shown above the History card when an activity
    /// refresh fails (timeout, transport error). Auto-dismisses after
    /// 4s. Drives the small "Couldn't refresh activity" pill — we
    /// preserve the last successful entries underneath rather than
    /// blanking the card.
    @State private var activityRefreshFailed = false
    @State private var scanToPaySheetVisible = false
    /// Drives the Request/Receive sheet opened from the quick-actions grid.
    @State private var receiveSheetVisible = false
    /// Live gold market (spot + 7d sparkline) for the "Grow your wealth"
    /// Gold card. Loaded in the background; nil until the first fetch.
    @State private var goldMarket: GoldMarketDTO?
    @State private var goldSheetVisible = false
    @State private var stocksSheetVisible = false
    @State private var sweepPreview: SweepPreviewDTO?
    @State private var sweepAlertVisible = false
    @State private var sweepAlertMessage = ""
    @State private var sweeping = false
    @State private var receiptEntry: ActivityEntryDTO?
    @State private var historySheetVisible = false
    /// True when the user's `TaliseVault` is holding non-zero balances —
    /// drives the "Move to wallet" pill next to the +/paperplane row.
    /// Read on appear via `/api/vault/state` so we don't paint the CTA
    /// when there's nothing to withdraw.
    @State private var vaultHasFunds: Bool = false
    @State private var vaultWithdrawSheetVisible = false
    /// Plain-wallet (non-vault) balances broken out per coin type.
    /// Drives the "Convert all to USDsui" action button — we only paint
    /// the CTA when there is at least one non-USDsui leg above the dust
    /// threshold to convert.
    @State private var walletCoinBalances: [WalletCoinBalance] = []
    @State private var walletSweepAlertVisible = false
    @State private var walletSweepAlertMessage = ""
    @State private var walletSweeping = false
    private let apyHeadline: Double = 0.11


    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                topBar
                    .padding(.horizontal, 30)
                    .padding(.top, 4)
                balanceBlock
                    .padding(.horizontal, 30)
                    .padding(.top, 32)
                if let preview = sweepPreview, preview.eligible {
                    sweepBanner(preview)
                        .padding(.horizontal, 32)
                        .padding(.top, 18)
                }
                // Autoswap archived 2026-05-29 — AutoSwapMigrationBanner moved to
                // web/_archive/autoswap-2026-05-29/ios/. The Home surface that
                // replaces it is the per-row "Swap to USDsui" CTA driven from
                // the activity feed (see HistoryRow). When the user receives a
                // non-USDsui coin (USDC, DEEP, etc.), the activity row now
                // shows the explicit swap affordance instead of relying on the
                // dormant auto-swap cron.
                usernameCard
                    .padding(.horizontal, 32)
                    .padding(.top, 24)
                // Recent/activity feed lives behind the navbar "History" icon
                // (2026-06-01). The space below the identity card is now the
                // "Grow your wealth" surface — Talise's wealth products (Gold
                // live, Stocks next) + the live Earn yield — so the home reads
                // like an investing app instead of a black void. `activity` is
                // still warmed in the background so History opens instantly.
                growSection
                    .padding(.horizontal, 32)
                    .padding(.top, 26)
                // Bottom inset so the last card row clears the floating nav pill.
                Color.clear.frame(height: 120)
            }
        }
        .refreshable { await loadAll(force: true) }
        .taliseScreenBackground()
        .task { await loadAll(force: false) }
        .onReceive(NotificationCenter.default.publisher(for: .taliseTxCompleted)) { note in
            guard let ev = note.object as? TaliseTxEvent else { return }
            applyOptimisticTx(ev)
        }
        .alert("Convert to USDsui", isPresented: $sweepAlertVisible) {
            Button("Cancel", role: .cancel) {}
            Button("Convert") { Task { await executeSweep() } }
        } message: {
            Text(sweepAlertMessage)
        }
        .alert("Convert all to USDsui", isPresented: $walletSweepAlertVisible) {
            Button("Cancel", role: .cancel) {}
            Button("Convert") { Task { await executeWalletSweep() } }
        } message: {
            Text(walletSweepAlertMessage)
        }
        .sheet(item: $receiptEntry) { entry in
            TxReceiptView(entry: entry)
                .presentationDetents([.medium, .large])
                .presentationBackground(TaliseColor.bg)
        }
        .sheet(isPresented: $historySheetVisible) {
            HistoryView(initialEntries: activity)
                .presentationDetents([.large])
                .presentationBackground(TaliseColor.bg)
        }
        .sheet(isPresented: $receiveSheetVisible) {
            ReceiveView()
                .presentationDetents([.large])
                .presentationBackground(TaliseColor.bg)
        }
        .sheet(isPresented: $goldSheetVisible) {
            GoldView(market: goldMarket)
                .presentationDetents([.large])
                .presentationBackground(TaliseColor.bg)
        }
        .sheet(isPresented: $stocksSheetVisible) {
            StocksView()
                .presentationDetents([.large, .medium])
                .presentationBackground(TaliseColor.bg)
        }
        // Autoswap archived 2026-05-29 — VaultWithdrawSheet moved to
        // web/_archive/autoswap-2026-05-29/ios/. `vaultWithdrawSheetVisible`
        // is preserved as a no-op so any latent setter doesn't break the
        // compile; the trigger sites have been removed.
    }

    // MARK: - Top bar

    private var topBar: some View {
        HStack {
            // Brand mark — the source PNG already ships at the right
            // tint, so we render as-is (rendering intent on the asset
            // catalog is "original"). 24×22 keeps the bounding box
            // identical to the prior Canvas-drawn `TaliseLogoMark`
            // so the rest of the navbar layout doesn't shift.
            Image("TaliseLogo")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 24, height: 22)
            Spacer()
            HStack(spacing: 2) {
                // History — moved off the Home surface into the navbar so the
                // home screen stays focused on balance + send/receive. Opens
                // the full activity sheet (HistoryView), seeded with any rows
                // already warmed in `activity` for an instant paint.
                Button {
                    historySheetVisible = true
                } label: {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.system(size: 21, weight: .regular))
                        .foregroundStyle(TaliseColor.fg)
                        .frame(width: 22, height: 22)
                        .padding(6)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("History")

                // Scan-to-Pay entry point. `qrcode.viewfinder` reads
                // immediately as "scan a QR" at the navbar icon size; the 6pt
                // padding keeps a comfortable hit target.
                Button {
                    scanToPaySheetVisible = true
                } label: {
                    Image(systemName: "qrcode.viewfinder")
                        .font(.system(size: 22, weight: .regular))
                        .foregroundStyle(TaliseColor.fg)
                        .frame(width: 22, height: 22)
                        .padding(6)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Scan to pay")
            }
        }
        .frame(height: 28)
        .sheet(isPresented: $scanToPaySheetVisible) {
            ScanToPayView()
                .presentationDetents([.large])
                .presentationBackground(.black)
        }
    }

    // MARK: - Balance + actions

    private var balanceBlock: some View {
        HStack(alignment: .bottom, spacing: 8) {
            VStack(alignment: .leading, spacing: 6) {
                // Quiet mono eyebrow — moves the "Balance" label into the
                // same micro-label register as the rest of the app so the
                // big figure underneath carries the weight on its own.
                Text("BALANCE")
                    .font(TaliseFont.mono(10, weight: .regular))
                    .tracking(2.0)
                    .foregroundStyle(TaliseColor.fgMuted)

                // USDsui is the primary unit. We render it as `$X.XX`
                // since it's pegged 1:1 to USD on chain. SUI balance
                // gets its own sub-line so the user still sees gas
                // headroom without a "total USD" rollup that can drift
                // with SUI price.
                Text(usdsuiFormatted)
                    .font(TaliseFont.display(34, weight: .medium))
                    .kerning(-1.2)
                    .foregroundStyle(TaliseColor.fg)
                    .contentTransition(.numericText())
                    .redacted(reason: loadingBalance ? .placeholder : [])

                // Two-part sub-line: the underlying USDsui amount so the
                // user can sanity-check the FX conversion, then the
                // green "earn" nudge.
                HStack(spacing: 8) {
                    Text(suiusdFormatted)
                        .font(TaliseFont.mono(10, weight: .light))
                        .kerning(-0.4)
                        .foregroundStyle(TaliseColor.fgMuted)
                    Text("·")
                        .font(TaliseFont.mono(10, weight: .light))
                        .foregroundStyle(TaliseColor.fgDim)
                    Text(String(format: "Earn up to %.0f%%", apyHeadline * 100))
                        .font(TaliseFont.mono(10, weight: .light))
                        .kerning(-0.4)
                        .foregroundStyle(TaliseColor.accent)
                }
                .padding(.top, 2)
            }
            Spacer()
            HStack(spacing: 8) {
                // "Convert all to USDsui" — one-tap sweep of every non-
                // USDsui coin in the plain wallet through Cetus. Only
                // painted when we have at least one swappable leg above
                // dust; otherwise it's hidden so the row doesn't show a
                // button that would no-op on tap.
                if walletSweepEligible {
                    actionButton(systemName: "arrow.left.arrow.right") {
                        walletSweepAlertMessage = walletSweepConfirmationMessage()
                        walletSweepAlertVisible = true
                    }
                }
                // Deposit (+) — the primary "add money" affordance. Given
                // a subtle mint tint so the entry point into the redesigned
                // Deposit flow reads as the hero action in the row without
                // shouting over the balance figure.
                actionButton(systemName: "plus", accented: true) {
                    NotificationCenter.default.post(
                        name: .taliseRequestDepositCover, object: nil
                    )
                }
                // "Move to wallet" — only painted when the user has
                // something to pull out of the vault. Auto-swap drops
                // USDsui into the vault; this pill is the way to spend
                // that money. Tray-arrow-up reads as "lift out of
                // container" in the SF Symbol library.
                if vaultHasFunds {
                    actionButton(systemName: "tray.and.arrow.up.fill") {
                        vaultWithdrawSheetVisible = true
                    }
                }
                // SF Symbol `paperplane` (outlined, not `.fill`) ships at
                // the canonical ~45° upper-right angle that reads as
                // "send" in every messaging app since Telegram. The old
                // `.fill` + `rotated: -30` combo pushed the body nearly
                // vertical and lost the directional cue.
                actionButton(systemName: "paperplane", accented: true) {
                    NotificationCenter.default.post(
                        name: .taliseRequestWithdrawCover, object: nil
                    )
                }
            }
            .padding(.bottom, 6)
        }
    }

    /// Primary balance figure — rendered in the user's chosen display
    /// currency (defaults to USD, configurable from Profile). On-chain
    /// the wallet still holds USDsui (1:1 USD); this just maps it
    /// through the FX rate.
    private var usdsuiFormatted: String {
        TaliseFormat.local2(balance?.usdsui ?? 0)
    }
    
    /// Secondary "0.05 USDsui" line beneath the localized balance.
    /// Always shows the on-chain unit so the user can sanity-check
    /// the FX conversion against the asset that's actually moving.
    private var suiusdFormatted: String {
        let v = balance?.usdsui ?? 0
        if v < 0.01 {
            return String(format: "%.4f USDsui", v)
        }
        return String(format: "%.2f USDsui", v)
    }
    
    private func actionButton(
        systemName: String,
        rotated degrees: Double = 0,
        accented: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(accented ? TaliseColor.greenMint : TaliseColor.fg)
                .rotationEffect(.degrees(degrees))
                .frame(width: 40, height: 40)
                .taliseGlass(cornerRadius: 10, tint: accented ? TaliseColor.greenMint : nil)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Username card

    private var usernameCard: some View {
        ZStack(alignment: .topLeading) {
            // Empty container the glass modifier attaches to. The
            // 212pt height matches the Figma spec; the glass
            // treatment (.ultraThinMaterial + dark tint + top
            // hairline + drop shadow) lives in TaliseGlassCard so
            // it stays in sync with the bottom nav pill.
            Color.clear
                .frame(height: 212)
                .taliseGlass(cornerRadius: 25)
            // Branded Sui coin mark in the card's top-right corner.
            // Source PNG is the full-color Sui mark, so we render as
            // original (no template tint). Box bumped 18×24 → 26×26
            // to give the round mark a proportional footprint vs the
            // narrower drop the old `sui-drop` SVG used.
            Image("SuiCoinMark")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 26, height: 26)
                .padding(.top, 22)
                .padding(.trailing, 24)
                .frame(maxWidth: .infinity, alignment: .topTrailing)
            VStack(alignment: .leading, spacing: 0) {
                if let handle = currentHandle {
                    Text(handle)
                        .font(TaliseFont.heading(20, weight: .medium))
                        .kerning(-0.8)
                        .foregroundStyle(TaliseColor.fgSubtle)
                        .padding(.top, 27)
                        .lineLimit(1)
                        .truncationMode(.middle)
                } else {
                    claimCTA
                        .padding(.top, 24)
                }
                Spacer(minLength: 0)
                HStack {
                    MicroLabel(text: "$0.00 FEE")
                        .kerning(-0.32)
                    Spacer()
                    MicroLabel(text: "YOUR MONEY LANDS HERE")
                        .kerning(-0.32)
                }
                .padding(.bottom, 22)
            }
            .padding(.horizontal, 32)
            .frame(height: 212)
        }
    }

    /// CTA shown on the username card when the user hasn't minted a
    /// `*.talise.sui` subname yet. Tap → MainTabView opens the
    /// ClaimHandleSheet (so the underlying tab blurs uniformly).
    private var claimCTA: some View {
        Button {
            NotificationCenter.default.post(
                name: .taliseRequestClaimSheet, object: nil
            )
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                Text("Claim your name")
                    .font(TaliseFont.heading(20, weight: .medium))
                    .kerning(-0.8)
                    .foregroundStyle(TaliseColor.fgSubtle)
                HStack(spacing: 6) {
                    Text("So friends can send you USDsui by name.")
                        .font(TaliseFont.body(12, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted)
                        .lineLimit(2)
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(TaliseColor.accent)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// Real on-chain handle if minted, the short address as a fallback
    /// when on Home we still want to identify the wallet. Returning nil
    /// triggers the Claim CTA.
    private var currentHandle: String? {
        guard case .ready(let user) = session.phase else { return nil }
        return user.displayHandle()
    }

    // MARK: - Grow your wealth

    /// The home's wealth surface — replaces the empty space under the
    /// identity card. A live Gold hero (real spot price + 7d sparkline) over
    /// a two-up row of Stocks (next) + Earn (live yield). Themed cards: warm
    /// gold for the metal, cool slate for equities, brand green for yield.
    private var growSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Eyebrow(text: "Grow your wealth")
                .padding(.leading, 4)
            goldHeroCard
            HStack(spacing: 12) {
                stocksCard
                earnCard
            }
        }
    }

    // — Gold ———————————————————————————————————————————————

    private var goldText: Color { Color(hex: 0xCBA875) }
    private var goldLine: Color { Color(hex: 0xE7C27A) }

    private var goldHeroCard: some View {
        Button { goldSheetVisible = true } label: {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
                    HStack(spacing: 11) {
                        goldCoin(size: 40)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Gold")
                                .font(TaliseFont.heading(17, weight: .medium))
                                .foregroundStyle(TaliseColor.fg)
                            Text("XAU · per gram")
                                .font(TaliseFont.mono(9, weight: .regular))
                                .kerning(0.4)
                                .foregroundStyle(goldText)
                        }
                    }
                    Spacer()
                    changePill(goldMarket?.change24hPct)
                }
                HStack(alignment: .bottom, spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(goldPerGramText)
                            .font(TaliseFont.display(27, weight: .medium))
                            .kerning(-0.8)
                            .foregroundStyle(TaliseColor.fg)
                            .contentTransition(.numericText())
                            .redacted(reason: goldMarket == nil ? .placeholder : [])
                        Text(hedgeTagline)
                            .font(TaliseFont.body(12, weight: .light))
                            .foregroundStyle(goldText)
                    }
                    Spacer()
                    Sparkline(
                        values: goldMarket?.spark ?? [],
                        lineColor: goldLine,
                        fill: true,
                        lineWidth: 2
                    )
                    .frame(width: 96, height: 46)
                    .opacity(goldMarket == nil ? 0 : 1)
                }
                HStack(spacing: 5) {
                    Spacer()
                    Text("Buy gold")
                        .font(TaliseFont.body(13, weight: .medium))
                        .foregroundStyle(goldLine)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(goldLine)
                }
            }
            .padding(20)
            .background(goldCardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(TaliseColor.warmGold.opacity(0.32), lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.45), radius: 16, x: 0, y: 8)
        }
        .buttonStyle(LiquidGlassPressStyle(cornerRadius: 24))
    }

    private var goldCardBackground: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [Color(hex: 0x37290F), Color(hex: 0x140E06)],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    )
                )
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(
                    RadialGradient(
                        colors: [TaliseColor.warmGold.opacity(0.34), .clear],
                        center: .topTrailing, startRadius: 6, endRadius: 230
                    )
                )
        }
    }

    /// Engraved "Au" gold coin — gradient disc + the periodic symbol. Reads
    /// as gold instantly without a (nonexistent) gold SF Symbol.
    private func goldCoin(size: CGFloat) -> some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: [Color(hex: 0xF4D58D), Color(hex: 0xC08A3E)],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    )
                )
            Text("Au")
                .font(.system(size: size * 0.40, weight: .bold, design: .serif))
                .foregroundStyle(Color(hex: 0x3A2A12))
        }
        .frame(width: size, height: size)
        .overlay(Circle().stroke(Color.white.opacity(0.28), lineWidth: 0.5))
    }

    private var goldPerGramText: String {
        guard let g = goldMarket else { return "0,000" }
        return TaliseFormat.local2(g.usdPerGram)
    }

    private var hedgeTagline: String {
        switch CurrencySettings.shared.current.code {
        case "NGN": return "A hedge against the naira"
        case "GHS": return "A hedge against the cedi"
        case "KES": return "A hedge against the shilling"
        case "ZAR": return "A hedge against the rand"
        case "GBP": return "A hedge against the pound"
        default:    return "A hedge against inflation"
        }
    }

    private func changePill(_ pct: Double?) -> some View {
        let value = pct ?? 0
        let up = value >= 0
        let color = up ? TaliseColor.accent : TaliseColor.danger
        return HStack(spacing: 3) {
            Image(systemName: up ? "arrow.up.right" : "arrow.down.right")
                .font(.system(size: 9, weight: .bold))
            Text(String(format: "%.2f%%", abs(value)))
                .font(TaliseFont.mono(10, weight: .regular))
        }
        .foregroundStyle(color)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Capsule().fill(color.opacity(0.16)))
        .opacity(pct == nil ? 0 : 1)
    }

    // — Stocks + Earn (two-up) —————————————————————————————

    private var stocksCard: some View {
        Button { stocksSheetVisible = true } label: {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(
                                LinearGradient(
                                    colors: [Color(hex: 0x3C4A63), Color(hex: 0x222C3D)],
                                    startPoint: .topLeading, endPoint: .bottomTrailing
                                )
                            )
                            .frame(width: 42, height: 42)
                        Image(systemName: "chart.line.uptrend.xyaxis")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(Color(hex: 0xAFC4E8))
                    }
                    Spacer()
                    soonBadge
                }
                Spacer(minLength: 16)
                Text("Stocks")
                    .font(TaliseFont.heading(16, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                Text("AAPL · TSLA · NVDA")
                    .font(TaliseFont.mono(10, weight: .regular))
                    .kerning(0.2)
                    .foregroundStyle(TaliseColor.fgMuted)
                    .lineLimit(1)
                    .padding(.top, 3)
            }
            .padding(18)
            .frame(maxWidth: .infinity, minHeight: 132, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [Color(hex: 0x1A2230), Color(hex: 0x0C1018)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        )
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(Color(hex: 0x3C4A63).opacity(0.5), lineWidth: 1)
            )
        }
        .buttonStyle(LiquidGlassPressStyle(cornerRadius: 22))
    }

    private var soonBadge: some View {
        Text("SOON")
            .font(TaliseFont.mono(8, weight: .regular))
            .kerning(1.0)
            .foregroundStyle(Color(hex: 0xAFC4E8))
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Capsule().fill(Color(hex: 0xAFC4E8).opacity(0.16)))
    }

    private var earnCard: some View {
        Button {
            NotificationCenter.default.post(
                name: .taliseSelectTab, object: MainTabView.Tab.invest
            )
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(TaliseColor.greenDeep)
                        .frame(width: 42, height: 42)
                    Image(systemName: "leaf.fill")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(TaliseColor.greenMint)
                }
                Spacer(minLength: 16)
                Text("Earn")
                    .font(TaliseFont.heading(16, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                Text(String(format: "%.0f%% APY · USDsui", apyHeadline * 100))
                    .font(TaliseFont.mono(10, weight: .regular))
                    .kerning(0.2)
                    .foregroundStyle(TaliseColor.accent)
                    .lineLimit(1)
                    .padding(.top, 3)
            }
            .padding(18)
            .frame(maxWidth: .infinity, minHeight: 132, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [Color(hex: 0x132619), Color(hex: 0x0A130D)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        )
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(TaliseColor.greenDeep.opacity(0.55), lineWidth: 1)
            )
        }
        .buttonStyle(LiquidGlassPressStyle(cornerRadius: 22))
    }

    private func loadGold() async {
        do {
            let g: GoldMarketDTO = try await APIClient.shared.get("/api/markets/gold")
            withAnimation(.easeOut(duration: 0.3)) { goldMarket = g }
        } catch {
            // Silent — the Gold card just stays in its idle/skeleton look if
            // the market read fails; never disrupts the home screen.
        }
    }

    // MARK: - Activity card

    /// History section — TODAY's activity only, no surrounding container.
    /// Each row is its own glassmorphic pill with a directional tint
    /// (red/green/none). Capped at 4 rows; "See all" opens HistoryView
    /// with the full feed + filters. Older entries stay reachable via
    /// "See all" even when today's section is empty.
    private var activityCard: some View {
        VStack(spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text("Recent")
                    .font(TaliseFont.heading(17, weight: .medium))
                    .kerning(-0.4)
                    .foregroundStyle(TaliseColor.fg)
                Spacer()
                if !activity.isEmpty {
                    Button {
                        historySheetVisible = true
                    } label: {
                        HStack(spacing: 4) {
                            Text("See all")
                                .font(TaliseFont.body(12, weight: .light))
                                .foregroundStyle(TaliseColor.fgMuted)
                            Image(systemName: "arrow.up.right")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(TaliseColor.fgMuted)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }

            // Soft inline notice when /api/activity refresh fails. We
            // keep the prior rows visible underneath; this pill is the
            // only hint the user gets that the most recent refresh
            // didn't make it. Auto-dismisses after 4s via the timer
            // started in `loadActivity(isRetry:)`.
            if activityRefreshFailed {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.circle")
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(TaliseColor.fgMuted)
                    Text("Couldn't refresh activity")
                        .font(TaliseFont.body(11, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted)
                    Spacer()
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(
                    Capsule().fill(TaliseColor.surfaceGlass)
                )
                .transition(.opacity)
            }

            if loadingActivity {
                VStack(spacing: 10) {
                    ForEach(0..<3, id: \.self) { _ in activityRowSkeleton }
                }
            } else if activity.isEmpty {
                activityEmptyState
                    .padding(.vertical, 24)
            } else {
                // Top 4 most-recent activity rows (any date). "See all"
                // opens the full filterable history.
                VStack(spacing: 10) {
                    ForEach(activity.prefix(4)) { row in
                        HistoryRow(entry: row) { receiptEntry = row }
                    }
                }
            }
        }
    }

    /// Single-row placeholder matching the glassy HistoryRow look.
    private var activityRowSkeleton: some View {
        HStack(spacing: 14) {
            Circle().fill(TaliseColor.badgeNeutral).frame(width: 32, height: 32)
            VStack(alignment: .leading, spacing: 4) {
                Capsule().fill(TaliseColor.line).frame(width: 80, height: 10)
                Capsule().fill(TaliseColor.line).frame(width: 50, height: 8)
            }
            Spacer()
            Capsule().fill(TaliseColor.line).frame(width: 60, height: 12)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
        .redacted(reason: .placeholder)
        .opacity(0.6)
    }

    /// Empty state for the History section. Rendered inline (no
    /// surrounding container) since the section itself no longer
    /// uses a card frame.
    private var activityEmptyState: some View {
        VStack(spacing: 6) {
            Text("Nothing yet")
                .font(TaliseFont.body(14, weight: .light))
                .foregroundStyle(TaliseColor.fg)
            Text("Your sends and receives will land here.")
                .font(TaliseFont.mono(10, weight: .light))
                .kerning(-0.32)
                .foregroundStyle(TaliseColor.fgDim)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Data

    private func loadAll(force: Bool) async {
        // Stale-while-revalidate: seed the UI from the on-disk snapshot
        // before the network round-trips complete so the user sees real
        // numbers on the very first frame. Only applied on the initial
        // load (not on force-refreshes) so a pull-to-refresh doesn't
        // temporarily flash old data over a live result.
        if !force, let uid = session.currentUser?.id {
            // Balance: a single number the live read corrects within ~1s, so a
            // recent cache is safe to flash. 1h window covers normal re-opens.
            if balance == nil,
               let cached = LocalSnapshotStore.loadBalancesIfFresh(userId: uid, maxAgeSec: 60 * 60) {
                balance = cached
                loadingBalance = false   // real number visible; no placeholder
            }
            // Activity: "Recent" must be genuinely recent. Only instant-paint
            // the cached feed if it's <2min old (a close-and-reopen); anything
            // older loads fresh from the snapshot-backed /api/activity so we
            // never show a days-old feed as Recent. (Bug: stale cache was
            // shown and the cold-launch revalidate didn't replace it.)
            if activity.isEmpty,
               let cached = LocalSnapshotStore.loadActivityIfFresh(userId: uid, maxAgeSec: 2 * 60),
               !cached.isEmpty {
                activity = cached
                activityHasLoadedOnce = true  // suppress skeleton; show cached rows
                loadingActivity = false
            }
        }

        await withTaskGroup(of: Void.self) { group in
            group.addTask { await loadBalance() }
            group.addTask { await loadActivity() }
            group.addTask { await loadGold() }
            // loadSweepPreview() removed: /api/sweep/prepare no longer
            // exists on the backend (404s on every open). The banner +
            // execute path are left intact for the SUI→USDsui sweep flow
            // triggered from walletCoinBalances (a different endpoint).
            group.addTask { await loadWalletCoinBalances() }
            _ = force
        }
    }

    /// Vault presence check archived 2026-05-29. Stays as a no-op so the
    /// `vaultHasFunds` state cell (still read in a few UI gates lower in
    /// this file) stays trivially `false`.
    private func loadVaultPresence() async {
        vaultHasFunds = false
    }

    private func loadBalance() async {
        loadingBalance = true
        defer { loadingBalance = false }
        do {
            let fetched: BalancesDTO = try await APIClient.shared.get("/api/balances")
            balance = fetched
            // Persist for the next cold launch so the stale-while-
            // revalidate path can paint real numbers immediately.
            if let uid = session.currentUser?.id {
                LocalSnapshotStore.saveBalances(fetched, userId: uid)
            }
        } catch {
            // A pull-to-refresh that lands while a prior .task load is
            // still in flight cancels the older request (-999). Wiping
            // `balance` on a cancellation would clobber the working
            // value we already had on screen — the user sees ₦0.00
            // flash in. Preserve last-known state on cancel; only nil
            // out for genuine load failures.
            if !APIError.isCancellation(error) {
                balance = nil
            }
        }
    }

    private func loadActivity() async {
        await loadActivity(isRetry: false, freshBypass: false)
    }

    /// Cache-bypassing variant used by `applyOptimisticTx`. Appends
    /// `?fresh=1` so the server skips its 5s memoTtl on this one call
    /// — without it, the post-send reconcile can hit a cache slice
    /// computed pre-tx, wiping the optimistic row off screen until the
    /// next pull-to-refresh. See /api/activity/route.ts.
    private func loadActivityFresh() async {
        await loadActivity(isRetry: false, freshBypass: true)
    }

    /// Activity load with tolerance for transient failures.
    ///
    /// Behavior on error (non-cancellation):
    ///   • Preserve the prior `activity` rows — do NOT zero them out.
    ///     A stale row beats an empty card every time, and prevents
    ///     the "20 entries → 0 entries" flicker we saw in the iOS log
    ///     forwarded 2026-05-29.
    ///   • If this is the FIRST attempt, surface a 4s auto-dismissing
    ///     toast ("Couldn't refresh activity") and schedule one
    ///     background retry 5s later. If the retry succeeds, it
    ///     silently replaces the rows; if it fails too, we give up
    ///     until the next foreground / pull-to-refresh.
    ///   • If this is already the retry attempt, do not schedule
    ///     another one — avoid a recursive retry loop on a wedged
    ///     route.
    ///
    /// We skip the skeleton on retry (`activityHasLoadedOnce`) so the
    /// user doesn't see a placeholder flash over their last-good rows.
    private func loadActivity(isRetry: Bool, freshBypass: Bool = false) async {
        if !activityHasLoadedOnce {
            loadingActivity = true
        }
        defer { loadingActivity = false }
        do {
            // `fresh=1` skips the server's 5s memoTtl — used by the
            // post-tx reconcile so a freshly-landed digest isn't masked
            // by a cached pre-tx slice.
            let path = freshBypass
                ? "/api/activity?limit=20&fresh=1"
                : "/api/activity?limit=20"
            let r: ActivityResponse = try await APIClient.shared.get(path)
            #if DEBUG
            if AppConfig.shared.verboseConsoleLogging {
                print("[activity] decoded \(r.entries.count) entries")
            }
            #endif
            // On-chain history is immutable — never let a transient empty or
            // short response downgrade what's already on screen. Accept the
            // new feed only when it has rows (or when we have nothing yet);
            // otherwise keep the prior rows.
            let merged = mergePendingStubs(into: r.entries)
            if !merged.isEmpty || activity.isEmpty {
                activity = merged
            }
            activityHasLoadedOnce = true
            // Persist for the next cold launch (stale-while-revalidate). Only
            // cache the raw server entries (not the merged stubs) so we don't
            // persist optimistic rows that may never confirm — AND only when
            // non-empty, so an empty response never poisons the good cache.
            if let uid = session.currentUser?.id, !r.entries.isEmpty {
                LocalSnapshotStore.saveActivity(r.entries, userId: uid)
            }
            // Silently dismiss the toast if the retry succeeded.
            activityRefreshFailed = false
        } catch {
            // Don't log cancellations — they're the dominant signal in
            // dev because SwiftUI's `.task` cancels its prior body
            // every time the view re-evaluates. Logging them used to
            // turn the dev console into unreadable `[activity] load
            // failed: …NSURLErrorDomain Code=-999 "cancelled"…` spam.
            if APIError.isCancellation(error) { return }
            #if DEBUG
            if AppConfig.shared.verboseConsoleLogging {
                print("[activity] load failed: \(error)")
            }
            #endif
            // Last resort: if we have NOTHING on screen and the live read
            // failed, fall back to the un-gated local snapshot. Immutable
            // history (even slightly stale) beats a blank "Recent" card.
            if activity.isEmpty, let uid = session.currentUser?.id,
               let cached = LocalSnapshotStore.loadActivity(userId: uid),
               !cached.isEmpty {
                activity = mergePendingStubs(into: cached)
                activityHasLoadedOnce = true
            }
            // Keep the last-known rows on screen. Only mark refresh
            // failure if we have nothing to show — otherwise the user
            // sees their prior history and a small "couldn't refresh"
            // hint above it.
            activityRefreshFailed = true
            // Auto-dismiss the toast after 4s.
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 4 * NSEC_PER_SEC)
                activityRefreshFailed = false
            }
            // Single background retry on first failure. Don't recurse
            // further — a second failure means the route is wedged
            // and we should wait for an explicit user refresh.
            if !isRetry {
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 5 * NSEC_PER_SEC)
                    await loadActivity(isRetry: true)
                }
            }
        }
    }

    /// Sui fullnode `suix_queryTransactionBlocks` and `suix_getBalance`
    /// can lag the actual chain state by 1-3 seconds after a tx lands,
    /// even though Onara's gRPC `executeTransaction` already confirmed
    /// the digest. Refreshing immediately therefore returns pre-send
    /// state and the user sees their balance unchanged + their tx
    /// missing from History.
    ///
    /// To avoid that flash of stale data, we apply an optimistic patch
    /// the moment the sender hands us the digest:
    ///   • prepend a synthetic ActivityEntryDTO so the row appears
    ///     immediately (with the same shape /api/activity will emit
    ///     a second later)
    ///   • adjust the on-screen USDsui balance by the moved amount
    /// Then we schedule a real reload 1.5s out to reconcile against
    /// the canonical chain query — whichever side of the optimistic
    /// patch ends up wrong is fixed silently on that pass.
    /// Merge any still-pending optimistic stubs into a server response
    /// before assigning to `activity`. A stub is re-prepended if its
    /// digest ISN'T in the server response (server hasn't indexed it
    /// yet). When the server response DOES contain the digest, the
    /// stub is evicted from the pending registry (server caught up;
    /// canonical row is authoritative going forward). 90s TTL on
    /// pending entries so a tx that genuinely failed silently doesn't
    /// haunt the History list forever.
    private func mergePendingStubs(into serverEntries: [ActivityEntryDTO]) -> [ActivityEntryDTO] {
        let serverDigests = Set(serverEntries.map(\.digest))
        let now = Date()
        let ttl: TimeInterval = 90
        // Evict: server-acked (canonical row landed) OR past TTL.
        let serverDigestsCopy = serverDigests
        let pendingAtCopy = pendingOptimisticAt
        pendingOptimisticStubs = pendingOptimisticStubs.filter { (digest, _) in
            if serverDigestsCopy.contains(digest) { return false }
            if let at = pendingAtCopy[digest], now.timeIntervalSince(at) > ttl { return false }
            return true
        }
        pendingOptimisticAt = pendingOptimisticAt.filter { (digest, _) in
            pendingOptimisticStubs[digest] != nil
        }
        // Prepend surviving stubs (most-recent-first) over the server list.
        let stubs = pendingOptimisticStubs.values.sorted { $0.timestampMs > $1.timestampMs }
        return stubs + serverEntries.filter { !pendingOptimisticStubs.keys.contains($0.digest) }
    }

    private func applyOptimisticTx(_ ev: TaliseTxEvent) {
        // Drop any prior optimistic entry for the same digest (e.g.
        // the user sent twice quickly and we already showed the first).
        let synthetic = ActivityEntryDTO(
            digest: ev.digest,
            timestampMs: Date().timeIntervalSince1970 * 1000,
            direction: ev.direction,
            amountUsdsui: ev.amountUsdsui,
            amountSui: nil,
            counterparty: ev.counterparty,
            counterpartyName: ev.counterpartyName,
            venue: ev.venue,
            // Optimistic stub for sent / invest / withdraw / send-leg
            // of a compound tx — none of those move non-USDsui coins,
            // so `otherCoin` is always nil here. The real entry from
            // /api/activity will replace this stub on next refresh.
            otherCoin: nil
        )
        // Register the stub in the pending dict so subsequent
        // loadActivity calls (which all set `activity = r.entries`)
        // can't wipe it. mergePendingStubs() in those load paths
        // re-prepends until either the canonical row lands or the
        // 90s TTL evicts the stub.
        pendingOptimisticStubs[ev.digest] = synthetic
        pendingOptimisticAt[ev.digest] = Date()
        activity = [synthetic] + activity.filter { $0.digest != ev.digest }

        // Tell the server to emit a `digest` SSE event when this
        // specific tx lands on chain. Fire-and-forget — if the
        // /watch call fails, the 90s stub TTL still evicts the row,
        // and the post-tx reconcile schedule (1.5s + 2.5s) below
        // still pulls /api/activity. Belt-and-suspenders by design.
        Task {
            struct WatchBody: Encodable { let digest: String }
            struct WatchResponse: Decodable { let ok: Bool? }
            do {
                let _: WatchResponse = try await APIClient.shared.post(
                    "/api/stream/watch",
                    body: WatchBody(digest: ev.digest)
                )
            } catch {
                // Silent — see comment above.
            }
        }

        // Balance: sent + invest leave the wallet (decrement);
        // withdraw returns to the wallet (increment).
        if let b = balance {
            let delta: Double
            switch ev.direction {
            case "sent", "invest":   delta = -ev.amountUsdsui
            case "withdraw":         delta =  ev.amountUsdsui
            default:                 delta = 0
            }
            let nextUsdsui = max(0, b.usdsui + delta)
            // totalUsd: USDsui counts 1:1; SUI side stays as-is. We
            // keep this consistent with the server's calc so the
            // reconciled refresh doesn't visibly jump.
            let nextTotal = max(0, b.totalUsd + delta)
            balance = BalancesDTO(
                address: b.address,
                usdsui: nextUsdsui,
                sui: b.sui,
                suiPriceUsd: b.suiPriceUsd,
                totalUsd: nextTotal
            )
        }

        // Reconcile against canonical chain state. We use the
        // cache-bypass `fresh=1` path so the server's 5s memoTtl can't
        // serve a stale pre-tx slice that would wipe the synthetic row
        // we just prepended. Then we re-attempt at 4s for a second
        // chance — the fullnode's queryTransactionBlocks index
        // sometimes needs the extra beat. If both passes miss the
        // digest, the optimistic row simply stays on screen (the
        // dedupe filter prevents duplicates).
        let pendingDigest = ev.digest
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            await loadBalance()
            await loadActivityFresh()
            // If the server response doesn't yet contain the new tx,
            // re-prepend the optimistic stub so the user keeps seeing
            // their action at the top of History.
            if !activity.contains(where: { $0.digest == pendingDigest }) {
                let stub = ActivityEntryDTO(
                    digest: ev.digest,
                    timestampMs: Date().timeIntervalSince1970 * 1000,
                    direction: ev.direction,
                    amountUsdsui: ev.amountUsdsui,
                    amountSui: nil,
                    counterparty: ev.counterparty,
                    counterpartyName: ev.counterpartyName,
                    venue: ev.venue,
                    otherCoin: nil
                )
                activity = [stub] + activity.filter { $0.digest != ev.digest }
                // Second reconcile pass — the fullnode index usually
                // catches up within another 2-3s. After this we stop
                // retrying so a wedged route can't loop forever.
                try? await Task.sleep(nanoseconds: 2_500_000_000)
                await loadActivityFresh()
                if !activity.contains(where: { $0.digest == pendingDigest }) {
                    activity = [stub] + activity.filter { $0.digest != ev.digest }
                }
            }
        }
    }

    private func currency(_ v: Double) -> String {
        TaliseFormat.usd(v)
    }

// MARK: - Sweep to USDsui (Onara-sponsored, Cetus route)

    /// Renders when the wallet holds non-USDsui coins worth more than
    /// dust. Tap → confirmation alert → POST /api/sweep/prepare with
    /// action=execute → sponsored swap via Onara.
    private func sweepBanner(_ p: SweepPreviewDTO) -> some View {
        Button {
            sweepAlertMessage = sweepConfirmationMessage(p)
            sweepAlertVisible = true
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(TaliseColor.accent.opacity(0.18))
                        .frame(width: 36, height: 36)
                    Image(systemName: "arrow.left.arrow.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(TaliseColor.accent)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(sweepHeadline(p))
                        .font(TaliseFont.body(13, weight: .light))
                        .foregroundStyle(TaliseColor.fg)
                    MicroLabel(
                        text: "Onara-sponsored · No fee",
                        color: TaliseColor.fgDim
                    ).kerning(0.8)
                }
                Spacer()
                if sweeping {
                    ProgressView().controlSize(.small).tint(TaliseColor.fg)
                } else {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(TaliseColor.fgDim)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .taliseGlass(cornerRadius: 18)
            // Keep the soft accent ring so the sweep CTA still reads as
            // a green-tinted nudge against the neutral-glass siblings.
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(TaliseColor.accent.opacity(0.18), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(sweeping)
    }

    private func sweepHeadline(_ p: SweepPreviewDTO) -> String {
        let fromAmt = p.from.amount ?? 0
        let toUsd = p.to.estimateUsd ?? 0
        let fromStr = fromAmt < 1
            ? String(format: "%.4f", fromAmt)
            : String(format: "%.2f", fromAmt)
        return "Convert \(fromStr) \(p.from.coin) → \(TaliseFormat.usd2(toUsd)) USDsui"
    }

    private func sweepConfirmationMessage(_ p: SweepPreviewDTO) -> String {
        let toUsd = p.to.estimateUsd ?? 0
        return "Swap your SUI to USDsui via Cetus. Onara pays the gas — you pay $0 in fees. Estimated: \(TaliseFormat.usd2(toUsd))."
    }

    private func loadSweepPreview() async {
        struct Body: Encodable { let action: String }
        do {
            sweepPreview = try await APIClient.shared.post(
                "/api/sweep/prepare",
                body: Body(action: "preview")
            )
        } catch {
            // Same cancellation-vs-failure split as loadBalance — don't
            // clobber the banner state on a refresh-triggered cancel.
            if !APIError.isCancellation(error) {
                sweepPreview = nil
            }
        }
    }

    private func executeSweep() async {
        sweeping = true
        defer { sweeping = false }
        struct Body: Encodable { let action: String }
        do {
            // 1. Backend builds the Cetus router-swap PTB (transactionKindB64).
            let built: SweepExecuteDTO = try await APIClient.shared.post(
                "/api/sweep/prepare",
                body: Body(action: "execute")
            )
            // 2. Hand to the same Onara-sponsored sign+submit pipeline
            //    Send/Earn use. The user signs the intent once with the
            //    ephemeral Curve25519 key; Onara pays gas.
            let amt = built.from.amount ?? 0
            let intent = String(format: "Convert %.4f SUI to USDsui", amt)
            let result = try await ZkLoginCoordinator.shared.signAndSubmit(
                transactionKindB64: built.transactionKindB64,
                intent: intent
            )
            sweepAlertMessage = "Converted to USDsui · digest \(result.digest.prefix(10))…"
            sweepAlertVisible = true
            await loadAll(force: true)
        } catch APIError.status(_, let msg) {
            sweepAlertMessage = msg ?? "Conversion couldn't be built right now."
            sweepAlertVisible = true
        } catch {
            sweepAlertMessage = error.localizedDescription
            sweepAlertVisible = true
        }
    }

    // MARK: - Wallet sweep (multi-coin "Convert all to USDsui")

    /// Dust threshold per leg, in raw u64 native units. Coins with less
    /// than this in their native decimals get filtered out so the sweep
    /// doesn't try to swap 0.0001 USDC ($0.0001) and bloat the PTB. The
    /// figure here approximates "$0.01-ish in any common decimals layout
    /// (6 / 9 / 9)" — server-side validation is the final arbiter; this
    /// is just a UX gate.
    private static let walletSweepDust: Double = 10_000

    /// Legs that will actually go into the sweep — everything non-USDsui
    /// with above-dust raw balance. Stable order so the confirmation
    /// message reads the same on repeat opens.
    private var walletSweepLegs: [WalletCoinBalance] {
        walletCoinBalances
            .filter { !$0.isUsdsui && $0.amountDouble > Self.walletSweepDust }
            .sorted(by: { $0.coinType < $1.coinType })
    }

    private var walletSweepEligible: Bool {
        !walletSweepLegs.isEmpty && !walletSweeping
    }

    /// Short symbol shown in the confirmation alert — we don't have a
    /// metadata service wired into Home yet, so we derive a best-effort
    /// label from the type tag's final `::Name` segment (e.g. `SUI`,
    /// `WAL`, `USDC`). Falls back to a truncated package id otherwise.
    private func walletSweepLegSymbol(_ b: WalletCoinBalance) -> String {
        let parts = b.coinType.split(separator: ":").map(String.init)
        // "0x...::module::Name" → "Name"
        if let last = parts.last, !last.isEmpty {
            return last.uppercased()
        }
        return String(b.coinType.suffix(6))
    }

    private func walletSweepConfirmationMessage() -> String {
        let legs = walletSweepLegs
        if legs.isEmpty {
            return "Nothing eligible to convert right now."
        }
        let pretty = legs.prefix(4).map(walletSweepLegSymbol).joined(separator: " + ")
        let more = legs.count > 4 ? " (+\(legs.count - 4) more)" : ""
        return "Will convert: \(pretty)\(more) → USDsui via Cetus. Onara pays the gas."
    }

    private func loadWalletCoinBalances() async {
        do {
            let resp = try await WalletAPI.balances()
            walletCoinBalances = resp.balances
        } catch {
            // Silent fallback — losing the enumeration only hides the
            // sweep CTA, doesn't break the home screen.
            if !APIError.isCancellation(error) {
                walletCoinBalances = []
            }
        }
    }

    private func executeWalletSweep() async {
        let legs = walletSweepLegs
        guard !legs.isEmpty else { return }
        walletSweeping = true
        defer { walletSweeping = false }

        do {
            // 1. Build the sweep payload from the legs we already
            //    enumerated — server is the final arbiter on validity
            //    (Cetus route existence, etc.), but pre-filtering here
            //    keeps the request small.
            let coins = legs.map {
                WalletSweepCoin(coinType: $0.coinType, amount: $0.amount)
            }
            let built = try await WalletAPI.sweep(coins: coins)

            // 2. Same sign+sponsor pipeline as every other PTB. Onara
            //    wraps these transaction-kind bytes into sponsored
            //    TransactionData, the ephemeral key signs the intent,
            //    /api/zk/sponsor-execute broadcasts.
            let intent = "Convert wallet to USDsui (\(legs.count) coin\(legs.count == 1 ? "" : "s"))"
            let result = try await ZkLoginCoordinator.shared.signAndSubmit(
                transactionKindB64: built.bytesB64,
                intent: intent
            )
            walletSweepAlertMessage = "Converted to USDsui · digest \(result.digest.prefix(10))…"
            walletSweepAlertVisible = true
            await loadAll(force: true)
        } catch APIError.status(_, let msg) {
            walletSweepAlertMessage = msg ?? "Conversion couldn't be built right now."
            walletSweepAlertVisible = true
        } catch {
            walletSweepAlertMessage = error.localizedDescription
            walletSweepAlertVisible = true
        }
    }
}

/// Contacts sheet — pulls /api/contacts (counterparties from recent
/// on-chain activity). Tap a row to open Send with the recipient prefilled.
struct ContactsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var contacts: [ContactDTO] = []
    @State private var loading = true

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                MicroLabel(text: "Contacts", color: TaliseColor.fgDim).kerning(1.5)
                Text("People you've paid")
                    .font(TaliseFont.heading(22, weight: .medium))
                    .kerning(-0.8)
                    .foregroundStyle(TaliseColor.fg)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 24)
            .padding(.top, 18)

            ScrollView {
                LazyVStack(spacing: 8) {
                    if loading {
                        ForEach(0..<4, id: \.self) { _ in placeholderRow }
                    } else if contacts.isEmpty {
                        emptyState
                    } else {
                        ForEach(contacts) { contact in
                            contactRow(contact)
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 32)
            }
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .presentationDragIndicator(.visible)
        .task { await load() }
    }

    private var placeholderRow: some View {
        HStack(spacing: 12) {
            Circle().fill(TaliseColor.badgeNeutral).frame(width: 36, height: 36)
            VStack(alignment: .leading, spacing: 4) {
                Capsule().fill(TaliseColor.line).frame(width: 120, height: 10)
                Capsule().fill(TaliseColor.line).frame(width: 80, height: 8)
            }
            Spacer()
        }
        .padding(14)
        .taliseGlass(cornerRadius: 16)
        .redacted(reason: .placeholder)
        .opacity(0.5)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            // Same brand contacts glyph as the navbar — at 36pt so it
            // reads as the empty-state hero. Faded via opacity since
            // the source PNG isn't a template asset (rendering intent
            // "original" preserves the design's tint).
            Image("ContactsGlyph")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 36, height: 36)
                .opacity(0.5)
                .padding(.top, 28)
            Text("No contacts yet")
                .font(TaliseFont.body(14, weight: .light))
                .foregroundStyle(TaliseColor.fg)
            Text("Anyone you send money to will appear here.")
                .font(TaliseFont.mono(10, weight: .light))
                .multilineTextAlignment(.center)
                .foregroundStyle(TaliseColor.fgDim)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity)
    }

    private func contactRow(_ c: ContactDTO) -> some View {
        Button {
            // Hand the address off to Send via UserDefaults bridge.
            UserDefaults.standard.set(c.address, forKey: "io.talise.send.prefillRecipient")
            dismiss()
            // Tiny delay so the sheet dismiss completes before the next
            // sheet presentation request fires.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                // Surface the Withdraw flow; the user can then tap
                // "Onchain Send" which inherits the prefilled
                // recipient via the UserDefaults bridge set above.
                NotificationCenter.default.post(
                    name: .taliseRequestWithdrawCover, object: nil
                )
            }
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(TaliseColor.badgeNeutral).frame(width: 36, height: 36)
                    Text(initials(c))
                        .font(TaliseFont.heading(13, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(c.display)
                        .font(TaliseFont.body(14, weight: .light))
                        .foregroundStyle(TaliseColor.fg)
                        .lineLimit(1)
                    MicroLabel(text: "\(c.sentCount) sent · \(c.receivedCount) received", color: TaliseColor.fgDim)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(TaliseColor.fgDim)
            }
            .padding(14)
            .taliseGlass(cornerRadius: 16)
        }
        .buttonStyle(.plain)
    }

    private func initials(_ c: ContactDTO) -> String {
        if let name = c.name, !name.isEmpty {
            return String(name.first!).uppercased()
        }
        // 0x address — show the first hex char after 0x.
        let idx = c.address.index(c.address.startIndex, offsetBy: min(2, c.address.count))
        return String(c.address[idx...].first.map(String.init) ?? "·").uppercased()
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let r: ContactsResponse = try await APIClient.shared.get("/api/contacts")
            contacts = r.contacts
        } catch {
            contacts = []
        }
    }
}

extension Notification.Name {
    // Note: taliseRequestDepositCover + taliseRequestWithdrawCover are
    // declared in AppRoot.swift (mounted from MainTabView). The +/
    // paperplane buttons post those — no name lives here anymore.

    /// Posted by SendView / EarnView once a sponsored tx returns a
    /// digest. HomeView listens, prepends an optimistic row, and
    /// kicks off a delayed real refresh so the UI stays accurate even
    /// while the Sui fullnode propagation lags by a second or two.
    static let taliseTxCompleted = Notification.Name("io.talise.txCompleted")
}

/// Payload for `.taliseTxCompleted`. Built from the data the sender
/// already has on hand — no extra chain round-trip needed to populate
/// the optimistic row.
struct TaliseTxEvent {
    let digest: String
    /// "sent" | "invest" | "withdraw" — matches ActivityEntryDTO.direction.
    let direction: String
    /// Positive USDsui units the user moved. Always positive — the
    /// direction field determines the sign in the UI.
    let amountUsdsui: Double
    /// For sends: recipient address. For invest/withdraw: nil (the
    /// counterparty is a pool, no address to show).
    let counterparty: String?
    let counterpartyName: String?
    /// "deepbook" | "navi" — only set for invest/withdraw.
    let venue: String?
}

private struct TaliseLogoMark: View {
    var body: some View {
        Canvas { ctx, size in
            let cx = size.width / 2
            let cy = size.height / 2
            let r: CGFloat = size.width * 0.22
            for i in 0..<4 {
                let angle = CGFloat(i) * .pi / 2
                var transform = CGAffineTransform(translationX: cx, y: cy)
                transform = transform.rotated(by: angle)
                transform = transform.translatedBy(x: 0, y: -size.height * 0.28)
                let rect = CGRect(
                    x: -r * 0.45, y: -r * 0.55,
                    width: r * 0.9, height: r * 1.15
                ).applying(transform)
                let path = Path(ellipseIn: rect)
                ctx.fill(path, with: .color(.white))
            }
        }
    }
}

// MARK: - Sparkline

/// Lightweight line-chart for price history. Normalises the series to its own
/// min/max so even a tight range reads as a clear trend, draws a rounded
/// stroke + an optional soft gradient fill. Decorative — no axes/interaction.
struct Sparkline: View {
    let values: [Double]
    var lineColor: Color = TaliseColor.accent
    var fill: Bool = true
    var lineWidth: CGFloat = 2

    var body: some View {
        GeometryReader { geo in
            let pts = points(in: geo.size)
            ZStack {
                if fill, pts.count > 1 {
                    areaPath(pts, height: geo.size.height)
                        .fill(
                            LinearGradient(
                                colors: [lineColor.opacity(0.28), lineColor.opacity(0.0)],
                                startPoint: .top, endPoint: .bottom
                            )
                        )
                }
                linePath(pts)
                    .stroke(
                        lineColor,
                        style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round)
                    )
            }
        }
    }

    private func points(in size: CGSize) -> [CGPoint] {
        guard values.count > 1, let lo = values.min(), let hi = values.max() else { return [] }
        let range = max(hi - lo, 0.000001)
        let pad: CGFloat = lineWidth
        let h = max(size.height - pad * 2, 1)
        let stepX = size.width / CGFloat(values.count - 1)
        return values.enumerated().map { i, v in
            CGPoint(
                x: CGFloat(i) * stepX,
                y: pad + (h - CGFloat((v - lo) / range) * h)
            )
        }
    }

    private func linePath(_ pts: [CGPoint]) -> Path {
        var p = Path()
        guard let first = pts.first else { return p }
        p.move(to: first)
        for pt in pts.dropFirst() { p.addLine(to: pt) }
        return p
    }

    private func areaPath(_ pts: [CGPoint], height: CGFloat) -> Path {
        var p = linePath(pts)
        if let last = pts.last, let first = pts.first {
            p.addLine(to: CGPoint(x: last.x, y: height))
            p.addLine(to: CGPoint(x: first.x, y: height))
            p.closeSubpath()
        }
        return p
    }
}

// MARK: - Gold product

/// Gold detail — live spot (CoinGecko PAX-Gold), a 7-day trend, a "how much
/// gold" calculator (fully live math), the inflation-hedge pitch, and an
/// early-access CTA. Prices + calc are live today; on-chain settlement is
/// rolling out, so the CTA reserves a spot rather than over-promising a buy.
struct GoldView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var market: GoldMarketDTO?
    @State private var amount = ""
    @State private var reserved = false
    @FocusState private var amountFocused: Bool

    init(market: GoldMarketDTO?) {
        _market = State(initialValue: market)
    }

    private let goldText = Color(hex: 0xCBA875)
    private let goldLine = Color(hex: 0xE7C27A)

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 26) {
                header
                hero
                if let m = market, m.spark.count > 1 { chart(m) }
                calculator
                whyGold
            }
            .padding(.horizontal, 28)
            .padding(.top, 20)
            .padding(.bottom, 140)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .overlay(alignment: .bottom) { buyBar }
        .presentationDragIndicator(.visible)
        .task { await load() }
        .onTapGesture { amountFocused = false }
    }

    private var header: some View {
        HStack(spacing: 12) {
            goldCoin(46)
            VStack(alignment: .leading, spacing: 2) {
                Text("Gold")
                    .font(TaliseFont.heading(22, weight: .medium))
                    .kerning(-0.6)
                    .foregroundStyle(TaliseColor.fg)
                Text("XAU · live spot")
                    .font(TaliseFont.mono(10, weight: .regular))
                    .foregroundStyle(goldText)
            }
            Spacer()
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow(text: "Per gram")
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(perGram)
                    .font(TaliseFont.display(40, weight: .medium))
                    .kerning(-1.6)
                    .foregroundStyle(TaliseColor.fg)
                    .redacted(reason: market == nil ? .placeholder : [])
                changePill
            }
            Text(perOzLine)
                .font(TaliseFont.mono(11, weight: .regular))
                .foregroundStyle(TaliseColor.fgDim)
        }
    }

    private func chart(_ m: GoldMarketDTO) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Sparkline(values: m.spark, lineColor: goldLine, fill: true, lineWidth: 2.5)
                .frame(height: 116)
            Text("LAST 7 DAYS")
                .font(TaliseFont.mono(9, weight: .regular))
                .tracking(2.0)
                .foregroundStyle(TaliseColor.fgDim)
        }
        .padding(18)
        .taliseGlass(cornerRadius: 22)
    }

    private var calculator: some View {
        VStack(alignment: .leading, spacing: 12) {
            Eyebrow(text: "How much gold?")
            HStack(spacing: 8) {
                Text(CurrencySettings.shared.current.symbol)
                    .font(TaliseFont.heading(20, weight: .medium))
                    .foregroundStyle(TaliseColor.fgMuted)
                TextField("0", text: $amount)
                    .keyboardType(.decimalPad)
                    .focused($amountFocused)
                    .font(TaliseFont.display(24, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .taliseGlass(cornerRadius: 16)
            Text(gramsLine)
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(goldText)
                .padding(.leading, 4)
        }
    }

    private var whyGold: some View {
        VStack(alignment: .leading, spacing: 14) {
            Eyebrow(text: "Why gold")
            whyRow("shield.lefthalf.filled", "Holds its value",
                   "Gold has outrun the naira's slide for decades — a store of value while cash quietly erodes.")
            whyRow("scalemass", "Own it by the gram",
                   "Start from pocket change. No vault, no broker — your gold lives in your Talise wallet.")
            whyRow("lock.fill", "Backed 1:1",
                   "Every gram is allocated, redeemable gold — not an IOU.")
        }
    }

    private func whyRow(_ icon: String, _ title: String, _ body: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(goldLine)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(TaliseFont.heading(14, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                Text(body)
                    .font(TaliseFont.body(12, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var buyBar: some View {
        VStack(spacing: 8) {
            Button {
                amountFocused = false
                withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { reserved = true }
            } label: {
                Text(reserved ? "You're on the early-access list ✓" : "Get early access")
                    .font(TaliseFont.heading(16, weight: .medium))
                    .foregroundStyle(reserved ? TaliseColor.greenMint : Color(hex: 0x2A1E0C))
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
                    .background(Capsule().fill(reserved ? TaliseColor.surfaceGlass : goldLine))
            }
            .buttonStyle(.plain)
            .disabled(reserved)
            Text(reserved
                 ? "We'll notify you the moment buying opens."
                 : "Live prices now · buying rolls out soon")
                .font(TaliseFont.mono(9, weight: .regular))
                .foregroundStyle(TaliseColor.fgDim)
        }
        .padding(.horizontal, 28)
        .padding(.top, 14)
        .padding(.bottom, 26)
        .background(
            LinearGradient(
                colors: [TaliseColor.bg.opacity(0), TaliseColor.bg, TaliseColor.bg],
                startPoint: .top, endPoint: .bottom
            )
            .ignoresSafeArea()
        )
    }

    private func goldCoin(_ size: CGFloat) -> some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: [Color(hex: 0xF4D58D), Color(hex: 0xC08A3E)],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    )
                )
            Text("Au")
                .font(.system(size: size * 0.40, weight: .bold, design: .serif))
                .foregroundStyle(Color(hex: 0x3A2A12))
        }
        .frame(width: size, height: size)
        .overlay(Circle().stroke(Color.white.opacity(0.28), lineWidth: 0.5))
    }

    private var perGram: String {
        guard let m = market else { return "0,000" }
        return TaliseFormat.local2(m.usdPerGram)
    }

    private var perOzLine: String {
        guard let m = market else { return " " }
        let usd = "$" + Int(m.usdPerOz.rounded()).formatted()
        return "\(TaliseFormat.local2(m.usdPerOz)) / oz · \(usd) spot"
    }

    private var changePill: some View {
        let value = market?.change24hPct ?? 0
        let up = value >= 0
        let color = up ? TaliseColor.accent : TaliseColor.danger
        return HStack(spacing: 3) {
            Image(systemName: up ? "arrow.up.right" : "arrow.down.right")
                .font(.system(size: 10, weight: .bold))
            Text(String(format: "%.2f%% today", abs(value)))
                .font(TaliseFont.mono(11, weight: .regular))
        }
        .foregroundStyle(color)
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(Capsule().fill(color.opacity(0.16)))
        .opacity(market == nil ? 0 : 1)
    }

    private var gramsLine: String {
        guard let m = market else {
            return "Enter an amount to see how much gold you'd get."
        }
        let local = Double(amount.replacingOccurrences(of: ",", with: "")) ?? 0
        guard local > 0 else {
            return "Enter an amount to see how much gold you'd get."
        }
        let usd = CurrencySettings.shared.convertToUsd(local: local)
        guard m.usdPerGram > 0 else { return " " }
        let grams = usd / m.usdPerGram
        return String(format: "≈ %.3f g of gold", grams)
    }

    private func load() async {
        do {
            market = try await APIClient.shared.get("/api/markets/gold")
        } catch {
            // Keep whatever the home handed us (or the skeleton) on failure.
        }
    }
}

// MARK: - Stocks teaser

/// Stocks is the next wealth product (Talise's vision). This is an honest
/// coming-soon teaser — the pitch, a ticker strip, and a waitlist CTA — so
/// the home card has a real destination instead of a dead tap.
struct StocksView: View {
    @State private var joined = false
    private let tickers = ["AAPL", "TSLA", "NVDA", "AMZN", "GOOGL", "MSFT", "META"]
    private let slate = Color(hex: 0xAFC4E8)

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 22) {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(
                                LinearGradient(
                                    colors: [Color(hex: 0x3C4A63), Color(hex: 0x222C3D)],
                                    startPoint: .topLeading, endPoint: .bottomTrailing
                                )
                            )
                            .frame(width: 46, height: 46)
                        Image(systemName: "chart.line.uptrend.xyaxis")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(slate)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Stocks")
                            .font(TaliseFont.heading(22, weight: .medium))
                            .kerning(-0.6)
                            .foregroundStyle(TaliseColor.fg)
                        Text("Coming soon")
                            .font(TaliseFont.mono(10, weight: .regular))
                            .foregroundStyle(slate)
                    }
                    Spacer()
                }

                Text("Own a slice of the world's biggest companies — in naira, from your phone.")
                    .font(TaliseFont.heading(20, weight: .medium))
                    .kerning(-0.5)
                    .foregroundStyle(TaliseColor.fg)
                    .fixedSize(horizontal: false, vertical: true)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(tickers, id: \.self) { t in
                            HStack(spacing: 5) {
                                Text(t)
                                    .font(TaliseFont.mono(11, weight: .regular))
                                    .foregroundStyle(TaliseColor.fg)
                                Image(systemName: "arrow.up.right")
                                    .font(.system(size: 8, weight: .bold))
                                    .foregroundStyle(TaliseColor.accent)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(Capsule().fill(TaliseColor.surfaceGlass))
                        }
                    }
                    .padding(.horizontal, 2)
                }

                VStack(alignment: .leading, spacing: 14) {
                    stockRow("dollarsign.circle", "Fractional shares",
                             "Buy $5 of Apple. No need for the whole share price.")
                    stockRow("globe", "Settled in stablecoin",
                             "Hold US equities exposure without a US bank account.")
                    stockRow("bolt.fill", "Same wallet",
                             "Stocks, gold, and cash all live in one Talise balance.")
                }
                .padding(.top, 4)

                Spacer(minLength: 8)

                Button {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { joined = true }
                } label: {
                    Text(joined ? "You're on the waitlist ✓" : "Join the waitlist")
                        .font(TaliseFont.heading(16, weight: .medium))
                        .foregroundStyle(joined ? TaliseColor.greenMint : Color(hex: 0x0C1018))
                        .frame(maxWidth: .infinity)
                        .frame(height: 54)
                        .background(Capsule().fill(joined ? TaliseColor.surfaceGlass : slate))
                }
                .buttonStyle(.plain)
                .disabled(joined)
            }
            .padding(.horizontal, 28)
            .padding(.top, 22)
            .padding(.bottom, 32)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .presentationDragIndicator(.visible)
    }

    private func stockRow(_ icon: String, _ title: String, _ body: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(slate)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(TaliseFont.heading(14, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                Text(body)
                    .font(TaliseFont.body(12, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
