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
        .alert("Convert to USDsui", isPresented: $sweepAlertVisible) {
            Button("Cancel", role: .cancel) {}
            Button("Convert") { Task { await executeSweep() } }
        } message: {
            Text(sweepAlertMessage)
        }
    }

    // MARK: - Top bar

    private var topBar: some View {
        HStack {
            TaliseLogoMark()
                .frame(width: 24, height: 22)
                .foregroundStyle(TaliseColor.fg)
            Spacer()
            Button {
                contactsSheetVisible = true
            } label: {
                Image(systemName: "person.2.fill")
                    .symbolRenderingMode(.hierarchical)
                    .font(.system(size: 18, weight: .regular))
                    .foregroundStyle(TaliseColor.fg)
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

                // USDsui is the only unit Talise exposes — any other coin
                // gets auto-converted via the sweep banner below. So the
                // sub-line just nudges the user toward yield.
                Text(String(format: "Earn up to %.0f%%", apyHeadline * 100))
                    .font(TaliseFont.mono(10, weight: .light))
                    .kerning(-0.4)
                    .foregroundStyle(TaliseColor.accent)
                    .padding(.top, 2)
            }
            Spacer()
            HStack(spacing: 8) {
                actionButton(systemName: "plus") {
                    Task { await openOnramp() }
                }
                actionButton(systemName: "paperplane.fill", rotated: -30) {
                    NotificationCenter.default.post(
                        name: .taliseRequestSendSheet, object: nil
                    )
                }
            }
            .padding(.bottom, 6)
        }
    }

    /// Primary balance figure — USDsui (1:1 USD). Pulled from the
    /// /api/balances aggregate which itself calls
    /// `sui_getBalance({ owner, coinType: USDC_TYPE })` server-side, so
    /// this is the real on-chain balance of the user's wallet.
    private var usdsuiFormatted: String {
        TaliseFormat.usd2(balance?.usdsui ?? 0)
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
            RoundedRectangle(cornerRadius: 25)
                .fill(TaliseColor.usernameCard)
                .overlay(
                    RoundedRectangle(cornerRadius: 25)
                        .stroke(Color.white.opacity(0.05), lineWidth: 1)
                )
                .frame(height: 212)
            Image("sui-drop")
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .foregroundStyle(TaliseColor.fg)
                .frame(width: 18, height: 24)
                .padding(.top, 24)
                .padding(.trailing, 26)
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

    private var activityCard: some View {
        RoundedRectangle(cornerRadius: 25)
            .fill(TaliseColor.surface)
            .frame(height: 283)
            .overlay(alignment: .top) {
                if loadingActivity {
                    activityLoadingState
                } else if activity.isEmpty {
                    activityEmptyState
                } else {
                    VStack(spacing: 0) {
                        ForEach(activity.prefix(4)) { row in
                            activityRow(row)
                        }
                    }
                    .padding(.top, 18)
                    .padding(.horizontal, 24)
                }
            }
    }

    private var activityLoadingState: some View {
        VStack(spacing: 0) {
            ForEach(0..<3, id: \.self) { _ in
                HStack(spacing: 14) {
                    Circle().fill(TaliseColor.badgeNeutral).frame(width: 30, height: 30)
                    VStack(alignment: .leading, spacing: 4) {
                        Capsule().fill(TaliseColor.line).frame(width: 80, height: 10)
                        Capsule().fill(TaliseColor.line).frame(width: 50, height: 8)
                    }
                    Spacer()
                    Capsule().fill(TaliseColor.line).frame(width: 60, height: 10)
                }
                .frame(height: 56)
                .redacted(reason: .placeholder)
                .opacity(0.5)
            }
        }
        .padding(.top, 18)
        .padding(.horizontal, 24)
    }

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
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func activityRow(_ entry: ActivityEntryDTO) -> some View {
        let isReceived = entry.isReceived
        let icon = isReceived ? "arrow.down.left" : "arrow.up.right"
        let iconColor = isReceived
            ? Color(hex: 0x79D96C) : Color(hex: 0xE08D8A)
        let badge = isReceived ? TaliseColor.badgeReceived : TaliseColor.badgeSent
        let title = isReceived ? "Received" : "Sent"
        let amount = formatAmount(entry)
        return HStack(spacing: 14) {
            ZStack {
                Circle().fill(badge).frame(width: 30, height: 30)
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(iconColor)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(TaliseFont.body(12, weight: .light))
                    .kerning(-0.48)
                    .foregroundStyle(TaliseColor.fg)
                MicroLabel(text: relativeTime(entry.timestampMs))
                    .kerning(-0.32)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(amount)
                    .font(TaliseFont.body(14, weight: .light))
                    .kerning(-0.56)
                    .foregroundStyle(TaliseColor.fg)
                HStack(spacing: 2) {
                    MicroLabel(text: "Details")
                        .kerning(-0.32)
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 8, weight: .regular))
                        .foregroundStyle(TaliseColor.fg)
                }
            }
        }
        .frame(height: 56)
    }

    private func formatAmount(_ e: ActivityEntryDTO) -> String {
        if let usd = e.amountUsdsui {
            let abs = Swift.abs(usd)
            let prefix = e.isReceived ? "+" : "-"
            return prefix + currency(abs)
        }
        if let sui = e.amountSui {
            let abs = Swift.abs(sui)
            let prefix = e.isReceived ? "+" : "-"
            return String(format: "\(prefix)%.4f SUI", abs)
        }
        return e.isReceived ? "+—" : "-—"
    }

    private func relativeTime(_ ms: Double) -> String {
        let date = Date(timeIntervalSince1970: ms / 1000)
        let fmt = RelativeDateTimeFormatter()
        fmt.unitsStyle = .abbreviated
        return fmt.localizedString(for: date, relativeTo: Date())
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
            balance = nil
        }
    }

    private func loadActivity() async {
        loadingActivity = true
        defer { loadingActivity = false }
        do {
            let r: ActivityResponse = try await APIClient.shared.get("/api/activity?limit=20")
            activity = r.entries
        } catch {
            activity = []
        }
    }

    private func currency(_ v: Double) -> String {
        TaliseFormat.usd(v)
    }

    /// Open the onramp flow in Safari. Backend creates a hosted session
    /// (see /api/onramp/session) and redirects to the provider.
    private func openOnramp() async {
        let base = AppConfig.shared.apiBaseURL
        let url = URL(string: base + "/api/onramp/session?provider=hosted")!
        await UIApplication.shared.open(url)
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
            sweepPreview = nil
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
            Image(systemName: "person.2")
                .font(.system(size: 28, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
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
