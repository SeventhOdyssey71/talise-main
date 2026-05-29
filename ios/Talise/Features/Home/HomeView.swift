import SwiftUI

/// Figma node 42-1819 — Home, dark mode. Real data: balance from
/// /api/balances, activity from /api/activity. Empty state matches the
/// Figma "no rows" look (a single muted card).
struct HomeView: View {
    @Environment(AppSession.self) private var session
    @State private var balance: BalancesDTO?
    @State private var activity: [ActivityEntryDTO] = []
    @State private var loadingBalance = true
    @State private var loadingActivity = true
    /// True once `/api/activity` has returned at least one successful
    /// response in the current view lifetime. Used to suppress the
    /// loading skeleton on transient retries — we keep the prior rows
    /// on screen instead of flashing back to a skeleton.
    @State private var activityHasLoadedOnce = false
    /// Toast banner shown above the History card when an activity
    /// refresh fails (timeout, transport error). Auto-dismisses after
    /// 4s. Drives the small "Couldn't refresh activity" pill — we
    /// preserve the last successful entries underneath rather than
    /// blanking the card.
    @State private var activityRefreshFailed = false
    @State private var contactsSheetVisible = false
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
                activityCard
                    .padding(.horizontal, 32)
                    .padding(.top, 22)
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
            HistoryView()
                .presentationDetents([.large])
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
            Button {
                contactsSheetVisible = true
            } label: {
                // Custom contacts glyph from design (person + stacked
                // lines). Replaces the SF Symbol `person.2.fill`.
                Image("ContactsGlyph")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 22, height: 22)
                    .padding(6)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .frame(height: 28)
        .sheet(isPresented: $contactsSheetVisible) {
            ContactsSheet()
                .presentationDetents([.medium, .large])
                .presentationBackground(TaliseColor.bg)
        }
    }

    // MARK: - Balance + actions

    private var balanceBlock: some View {
        HStack(alignment: .bottom, spacing: 8) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Balance")
                    .font(TaliseFont.body(16, weight: .light))
                    .kerning(-0.64)
                    .foregroundStyle(TaliseColor.fg)

                // USDsui is the primary unit. We render it as `$X.XX`
                // since it's pegged 1:1 to USD on chain. SUI balance
                // gets its own sub-line so the user still sees gas
                // headroom without a "total USD" rollup that can drift
                // with SUI price.
                Text(usdsuiFormatted)
                    .font(TaliseFont.display(28, weight: .medium))
                    .kerning(-1)
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
                actionButton(systemName: "plus") {
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
                actionButton(systemName: "paperplane", rotated: 0) {
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
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
                .rotationEffect(.degrees(degrees))
                .frame(width: 40, height: 40)
                .taliseGlass(cornerRadius: 10)
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

    // MARK: - Activity card

    /// History section — no surrounding container, each row is its
    /// own glassmorphic pill with a directional tint (red/green/none).
    /// Capped at 4 rows here; "See all" opens HistoryView with the
    /// full feed + filters.
    private var activityCard: some View {
        VStack(spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text("History")
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
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await loadBalance() }
            group.addTask { await loadActivity() }
            group.addTask { await loadSweepPreview() }
            group.addTask { await loadWalletCoinBalances() }
            // Autoswap archived 2026-05-29 — the post-pull `VaultAPI.sweepNow()`
            // fire-and-forget is gone alongside the vault routes.
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
            balance = try await APIClient.shared.get("/api/balances")
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
            print("[activity] decoded \(r.entries.count) entries")
            #endif
            activity = r.entries
            activityHasLoadedOnce = true
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
            print("[activity] load failed: \(error)")
            #endif
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
        activity = [synthetic] + activity.filter { $0.digest != ev.digest }

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
