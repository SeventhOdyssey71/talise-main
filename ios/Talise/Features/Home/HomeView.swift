import SwiftUI

/// Mirrors web /home — big centered total, asset tabs, sparkline, stat cards.
///
/// IMPORTANT: the screen from Figma node 42-1819 is not yet implemented
/// because the design isn't fetchable in this session (no Figma MCP). Once
/// it's available, replace this scaffold with the design's exact layout.
struct HomeView: View {
    @Environment(AppSession.self) private var session
    @State private var totalUsd: Double = 0
    @State private var usdsui: Double = 0
    @State private var sui: Double = 0
    @State private var loading = true

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 28) {
                    HeroNumber(
                        value: format(totalUsd),
                        eyebrow: "Total balance",
                        sub: loading ? "Loading…" : "USD · live"
                    )
                    .padding(.top, 24)

                    HStack(spacing: 12) {
                        StatCard(eyebrow: "USDsui", value: format(usdsui))
                        StatCard(eyebrow: "SUI", value: String(format: "%.4f", sui))
                    }

                    HStack(spacing: 12) {
                        actionTile(title: "Send", icon: "arrow.up.right", primary: true)
                        actionTile(title: "Receive", icon: "arrow.down.left")
                        actionTile(title: "Earn", icon: "chart.line.uptrend.xyaxis")
                        actionTile(title: "Chat", icon: "sparkles")
                    }

                    activitySection
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
            .navigationTitle("")
            .navigationBarHidden(true)
            .background(TaliseColor.bg)
        }
        .task { await load() }
    }

    private var activitySection: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionHeader(title: "Recent activity")
            VStack(spacing: 0) {
                ForEach(0..<3, id: \.self) { _ in
                    HStack {
                        Circle()
                            .fill(TaliseColor.surface2)
                            .frame(width: 36, height: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("—")
                                .font(TaliseFont.body(14))
                                .foregroundStyle(TaliseColor.fg)
                            Text("Nothing here yet")
                                .font(TaliseFont.body(12))
                                .foregroundStyle(TaliseColor.fgMuted)
                        }
                        Spacer()
                        Text("$0")
                            .font(TaliseFont.body(13))
                            .foregroundStyle(TaliseColor.fgDim)
                    }
                    .padding(.vertical, 12)
                    Divider().background(TaliseColor.line)
                }
            }
            .padding(.horizontal, 16)
            .background(TaliseColor.surface)
            .overlay(
                RoundedRectangle(cornerRadius: TaliseRadius.lg)
                    .stroke(TaliseColor.line, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: TaliseRadius.lg))
        }
        .padding(.top, 12)
    }

    private func actionTile(title: String, icon: String, primary: Bool = false) -> some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(primary ? TaliseColor.bg : TaliseColor.fg)
            Text(title)
                .font(TaliseFont.body(12))
                .foregroundStyle(primary ? TaliseColor.bg : TaliseColor.fg)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(primary ? TaliseColor.fg : TaliseColor.surface)
        .overlay(
            RoundedRectangle(cornerRadius: TaliseRadius.md)
                .stroke(primary ? TaliseColor.fg : TaliseColor.line, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: TaliseRadius.md))
    }

    private func load() async {
        // TODO: hit /api/balances once we add it as a single mobile endpoint
        // (avoid the 3-request fan-out the web /home does server-side).
        loading = false
    }

    private func format(_ v: Double) -> String {
        let fmt = NumberFormatter()
        fmt.numberStyle = .currency
        fmt.currencyCode = "USD"
        fmt.maximumFractionDigits = 2
        return fmt.string(from: NSNumber(value: v)) ?? "$0.00"
    }
}
