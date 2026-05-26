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
    @State private var contactsSheetVisible = false
    @State private var sweepPreview: SweepPreviewDTO?
    @State private var sweepAlertVisible = false
    @State private var sweepAlertMessage = ""
    @State private var sweeping = false
    @State private var receiptEntry: ActivityEntryDTO?
    @State private var historySheetVisible = false
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
                AutoSwapMigrationBanner()
                    .padding(.horizontal, 32)
                    .padding(.top, 14)
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
                actionButton(systemName: "plus") {
                    Task { await openOnramp() }
                }
                // SF Symbol `paperplane` (outlined, not `.fill`) ships at
                // the canonical ~45° upper-right angle that reads as
                // "send" in every messaging app since Telegram. The old
                // `.fill` + `rotated: -30` combo pushed the body nearly
                // vertical and lost the directional cue.
                actionButton(systemName: "paperplane", rotated: 0) {
                    NotificationCenter.default.post(
                        name: .taliseRequestSendSheet, object: nil
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
                .background(TaliseColor.surface2)
                .clipShape(RoundedRectangle(cornerRadius: 10))
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
        }
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
            if !isCancellation(error) {
                balance = nil
            }
        }
    }

    private func loadActivity() async {
        loadingActivity = true
        defer { loadingActivity = false }
        do {
            let r: ActivityResponse = try await APIClient.shared.get("/api/activity?limit=20")
            #if DEBUG
            print("[activity] decoded \(r.entries.count) entries")
            #endif
            activity = r.entries
        } catch {
            #if DEBUG
            print("[activity] load failed: \(error)")
            #endif
            if !isCancellation(error) {
                activity = []
            }
        }
    }

    /// True when the URLSession task was cancelled (typically because
    /// SwiftUI tore down the previous `.task` while a refresh kicked
    /// off a new one). Cancellations are NOT load failures — preserve
    /// any data we already have on screen.
    private func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        let ns = error as NSError
        return ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled
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

        // Reconcile against canonical chain state. 1.5s is empirically
        // enough for the fullnode's queryTransactionBlocks index to
        // catch up after Onara's broadcast-and-wait completes; if it
        // hasn't, the optimistic row simply stays on screen until the
        // next pull-to-refresh picks it up (it's the same digest, so
        // there's no dupe).
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            await loadAll(force: true)
        }
    }

    private func currency(_ v: Double) -> String {
        TaliseFormat.usd(v)
    }

    /// The "+" deposit button. Until the Stripe Onramp flow has a
    /// one-time bearer→cookie bridge wired (so Safari can carry the
    /// iOS auth across to /api/onramp/session), this button opens the
    /// Receive sheet — the user can copy their address / share the
    /// QR with anyone holding USDsui (another Talise user, an exchange,
    /// a hot wallet) and have funds delivered without leaving the app.
    private func openOnramp() async {
        NotificationCenter.default.post(
            name: .taliseRequestReceiveSheet, object: nil
        )
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
            .background(
                RoundedRectangle(cornerRadius: 18)
                    .fill(TaliseColor.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18)
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
            if !isCancellation(error) {
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
        .background(TaliseColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
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
                NotificationCenter.default.post(
                    name: .taliseRequestSendSheet, object: nil
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
            .background(TaliseColor.surface)
            .clipShape(RoundedRectangle(cornerRadius: 16))
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
    /// Posted by HomeView when the paperplane action is tapped. MainTabView
    /// observes this and presents the Send sheet over the active tab.
    static let taliseRequestSendSheet = Notification.Name("io.talise.requestSendSheet")

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
