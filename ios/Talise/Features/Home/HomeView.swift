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
    private let apyHeadline: Double = 0.11

    var body: some View {
        ZStack(alignment: .top) {
            TaliseColor.bg.ignoresSafeArea()
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    topBar
                        .padding(.horizontal, 30)
                        .padding(.top, 4)
                    balanceBlock
                        .padding(.horizontal, 30)
                        .padding(.top, 32)
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
        }
        .task { await loadAll(force: false) }
    }

    // MARK: - Top bar

    private var topBar: some View {
        HStack {
            TaliseLogoMark()
                .frame(width: 24, height: 22)
                .foregroundStyle(TaliseColor.fg)
            Spacer()
            Image(systemName: "person.2.fill")
                .symbolRenderingMode(.hierarchical)
                .font(.system(size: 18, weight: .regular))
                .foregroundStyle(TaliseColor.fg)
        }
        .frame(height: 28)
    }

    // MARK: - Balance + actions

    private var balanceBlock: some View {
        HStack(alignment: .bottom, spacing: 8) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Balance")
                    .font(TaliseFont.body(16, weight: .light))
                    .kerning(-0.64)
                    .foregroundStyle(TaliseColor.fg)
                Text(currency(balance?.totalUsd ?? 0))
                    .font(TaliseFont.display(28, weight: .medium))
                    .kerning(-1)
                    .foregroundStyle(TaliseColor.fg)
                    .contentTransition(.numericText())
                Text(String(format: "Earn up to %.0f%%", apyHeadline * 100))
                    .font(TaliseFont.mono(10, weight: .light))
                    .kerning(-0.4)
                    .foregroundStyle(TaliseColor.accent)
                    .padding(.top, 2)
            }
            Spacer()
            HStack(spacing: 8) {
                actionButton(systemName: "plus") {
                    // TODO: open /api/onramp/session in Safari
                }
                actionButton(systemName: "paperplane.fill", rotated: -30) {
                    // Send is now a sheet — see SendView. Bottom nav has
                    // 3 tabs so the easiest entry is the paperplane here.
                    NotificationCenter.default.post(
                        name: .taliseRequestSendSheet, object: nil
                    )
                }
            }
            .padding(.bottom, 6)
        }
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
                Text(handleLine)
                    .font(TaliseFont.heading(20, weight: .medium))
                    .kerning(-0.8)
                    .foregroundStyle(TaliseColor.fgSubtle)
                    .padding(.top, 27)
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

    private var handleLine: String {
        guard case .ready(let user) = session.phase else { return "you@talise" }
        if let h = user.businessHandle, !h.isEmpty { return "\(h)@talise" }
        let base = (user.name ?? user.email)
            .split(separator: "@").first ?? Substring("")
        let first = String(base).split(separator: " ").first.map(String.init) ?? "you"
        return "\(first.lowercased())@talise"
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
        let fmt = NumberFormatter()
        fmt.numberStyle = .currency
        fmt.currencyCode = "USD"
        fmt.maximumFractionDigits = 2
        return fmt.string(from: NSNumber(value: v)) ?? "$0.00"
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
