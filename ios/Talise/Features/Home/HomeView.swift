import SwiftUI

/// Implements Figma node 42-1819 (Home, dark mode). Pixel positions in
/// the design are based on a 402-pt reference frame; we adapt them to
/// fluid SwiftUI layout using the same proportions / paddings.
struct HomeView: View {
    @Environment(AppSession.self) private var session
    @State private var balance: Double = 0
    @State private var apyHeadline: Double = 0.11
    @State private var activity: [ActivityRow] = ActivityRow.placeholders

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
        }
        .task { await load() }
    }

    // MARK: - Top bar (logo + people icon)

    private var topBar: some View {
        HStack {
            // Talise mark — 4 droplets in a windmill. Built inline so we
            // don't need to bundle an extra asset for this primitive.
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
                Text(currency(balance))
                    .font(TaliseFont.display(28, weight: .medium))
                    .kerning(-1)
                    .foregroundStyle(TaliseColor.fg)
                Text(String(format: "Earn up to %.0f%%", apyHeadline * 100))
                    .font(TaliseFont.mono(10, weight: .light))
                    .kerning(-0.4)
                    .foregroundStyle(TaliseColor.accent)
                    .padding(.top, 2)
            }
            Spacer()
            HStack(spacing: 8) {
                actionButton(systemName: "plus") {
                    // open onramp / add funds
                }
                actionButton(systemName: "paperplane.fill", rotated: -30) {
                    // navigate to send
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

    // MARK: - Username card (jude@talise + Sui drop)

    private var usernameCard: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 25)
                .fill(TaliseColor.usernameCard)
                .overlay(
                    RoundedRectangle(cornerRadius: 25)
                        .stroke(Color.white.opacity(0.05), lineWidth: 1)
                )
                .frame(height: 212)

            // Sui drop top-right
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
        if case .ready(let user) = session.phase,
           let handle = user.businessHandle, !handle.isEmpty {
            return "\(handle)@talise"
        }
        if case .ready(let user) = session.phase {
            let first = (user.name ?? user.email).split(separator: "@").first?.split(separator: " ").first ?? ""
            return "\(String(first).lowercased())@talise"
        }
        return "you@talise"
    }

    // MARK: - Activity card

    private var activityCard: some View {
        RoundedRectangle(cornerRadius: 25)
            .fill(TaliseColor.surface)
            .frame(height: 283)
            .overlay(alignment: .top) {
                VStack(spacing: 0) {
                    ForEach(Array(activity.prefix(4).enumerated()), id: \.offset) { _, row in
                        activityRow(row)
                    }
                }
                .padding(.top, 18)
                .padding(.horizontal, 24)
            }
    }

    private func activityRow(_ row: ActivityRow) -> some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().fill(row.badgeColor).frame(width: 30, height: 30)
                Image(systemName: row.icon)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(row.iconColor)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .font(TaliseFont.body(12, weight: .light))
                    .kerning(-0.48)
                    .foregroundStyle(TaliseColor.fg)
                MicroLabel(text: row.subtitle)
                    .kerning(-0.32)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(row.amount)
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

    // MARK: - Data

    private func load() async {
        if case .ready(let user) = session.phase {
            _ = user
            // TODO: GET /api/balances (aggregate) once that endpoint exists.
            // The Figma displays a non-zero default; on first sign-in we
            // show the real $0.00.
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

// MARK: - Activity row model

private struct ActivityRow {
    let icon: String
    let iconColor: Color
    let badgeColor: Color
    let title: String
    let subtitle: String
    let amount: String

    static let placeholders: [ActivityRow] = [
        .init(
            icon: "arrow.up.right",
            iconColor: Color(hex: 0xE08D8A),
            badgeColor: TaliseColor.badgeSent,
            title: "Sent",
            subtitle: "2h ago",
            amount: "-$320.00"
        ),
        .init(
            icon: "arrow.down.left",
            iconColor: Color(hex: 0x79D96C),
            badgeColor: TaliseColor.badgeReceived,
            title: "Received",
            subtitle: "4h ago",
            amount: "+$5000.00"
        ),
        .init(
            icon: "gift.fill",
            iconColor: TaliseColor.fg,
            badgeColor: TaliseColor.badgeNeutral,
            title: "Claim Reward",
            subtitle: "7h ago",
            amount: "+$2.50"
        ),
        .init(
            icon: "leaf.fill",
            iconColor: TaliseColor.fg,
            badgeColor: TaliseColor.badgeNeutral,
            title: "Invest",
            subtitle: "2h ago",
            amount: "$100.00"
        ),
    ]
}

// MARK: - Talise logo mark (four droplets in a windmill)

private struct TaliseLogoMark: View {
    var body: some View {
        Canvas { ctx, size in
            let cx = size.width / 2
            let cy = size.height / 2
            let r: CGFloat = size.width * 0.22
            // Four small ovals around the center, rotated 0/90/180/270.
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
