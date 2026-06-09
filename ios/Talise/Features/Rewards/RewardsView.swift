import SwiftUI
import UIKit

/// Rewards tab — the points + perks hub.
///
/// Rewards = points + perks. The money-management surfaces (Round-up,
/// Goals, Insights) moved to the Invest tab where they semantically
/// belong — Round-up auto-supplies to NAVI, Goals are savings buckets,
/// Insights are spend/save analytics. Rewards stays deliberately spare:
/// tier progression, how-you-earn rules, and referrals. Nothing else.
///
/// Section ordering:
///   Hero (tier + points + progress) → How you earn → Your referral code
///   → inline error.
struct RewardsView: View {
    @State private var summary: RewardsSummary?
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 28) {
                heroCard
                earnRulesSection
                referralCard
                if let error {
                    Text(error)
                        .font(TaliseFont.body(12, weight: .light))
                        .foregroundStyle(TaliseColor.danger)
                        .padding(.horizontal, 4)
                }
                Spacer(minLength: 120)
            }
            .padding(.horizontal, 22)
            .padding(.top, 24)
        }
        .refreshable { await load() }
        .taliseScreenBackground()
        .task { await load() }
    }

    // MARK: - Hero card

    /// The one tinted card on the screen: tier eyebrow, the big points
    /// figure (white — the green is the card wash + progress, not the
    /// number), then an honest progress bar to the next tier. Tier info
    /// is server-computed (lib/rewards/earn.ts → TIERS) so iOS doesn't
    /// drift from the canonical thresholds.
    @ViewBuilder
    private var heroCard: some View {
        let tier = summary?.tier
        let points = summary?.pointsTotal ?? 0

        VStack(alignment: .leading, spacing: 18) {
            HeroAmount(
                eyebrow: tier?.label.uppercased() ?? "BRONZE",
                value: "\(points)",
                unit: "pts",
                loading: loading
            )
            tierProgress(tier: tier, points: points)
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .earnHeroGlass(cornerRadius: 24)
    }

    /// Honest progress to the next tier — no fake minimum fill, so a
    /// brand-new user at 4 of 500 points sees a near-empty rail (which
    /// is the truth). Collapses to a single accent line on top tier.
    @ViewBuilder
    private func tierProgress(tier: RewardsTier?, points: Int) -> some View {
        if let nextLabel = tier?.nextLabel, let toNext = tier?.pointsToNext, toNext > 0 {
            let total = points + toNext
            let progress = total > 0 ? Double(points) / Double(total) : 0
            VStack(alignment: .leading, spacing: 10) {
                QuietProgressBar(progress: progress)
                HStack(alignment: .firstTextBaseline) {
                    Text("\(toNext.formatted()) to \(nextLabel)")
                        .font(TaliseFont.mono(11, weight: .regular))
                        .foregroundStyle(TaliseColor.fgMuted)
                    Spacer(minLength: 8)
                    Text("\(points.formatted()) / \(total.formatted())")
                        .font(TaliseFont.mono(10, weight: .regular))
                        .foregroundStyle(TaliseColor.fgDim)
                }
            }
        } else if tier != nil {
            Text("Top tier — every point still counts toward perks")
                .font(TaliseFont.mono(11, weight: .regular))
                .foregroundStyle(TaliseColor.accent)
        }
    }

    // MARK: - How you earn

    /// Transparent "how points work" explainer as one grouped card of
    /// rows. Reads the server's `pointRates` so the numbers always match
    /// the engine; falls back to documented defaults on older builds.
    /// The rate value is the only green thing per row (rates ARE the
    /// financial figure) — titles and glyphs read uniform.
    @ViewBuilder
    private var earnRulesSection: some View {
        let rates = summary?.pointRates
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("How you earn")
            VStack(spacing: 0) {
                earnRow(icon: "paperplane", title: "Send money", rate: rates?.send ?? 1)
                RowDivider()
                earnRow(icon: "leaf.fill", title: "Save to yield", rate: rates?.invest ?? 3)
                RowDivider()
                earnRow(icon: "arrow.triangle.2.circlepath", title: "Round-up auto-save", rate: rates?.roundup ?? 5)
                RowDivider()
                earnRow(icon: "target", title: "Add to a goal", rate: rates?.goal ?? 4)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 4)
            .earnHeroGlass(cornerRadius: 20)
        }
    }

    private func earnRow(icon: String, title: String, rate: Int) -> some View {
        // Neutral (quiet) glyphs so the ROW reads uniform — the green rate
        // value is the only accent per row, not a column of green discs.
        PremiumListRow(icon: icon, kind: .neutral, title: title) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("\(rate)")
                    .font(TaliseFont.heading(15, weight: .medium))
                    .foregroundStyle(TaliseColor.accent)
                Text(rate == 1 ? "pt / $1" : "pts / $1")
                    .font(TaliseFont.mono(10, weight: .regular))
                    .foregroundStyle(TaliseColor.fgDim)
            }
        }
    }

    // MARK: - Referral card

    @ViewBuilder
    private var referralCard: some View {
        if let code = summary?.code {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader("Your referral code")
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Text(code)
                            .font(TaliseFont.mono(15, weight: .regular))
                            .foregroundStyle(TaliseColor.fg)
                        Spacer(minLength: 8)
                        LiquidGlassPill(title: "Copy", icon: "doc.on.doc", compact: true) {
                            UIPasteboard.general.string = "https://talise.io/r/\(code)"
                        }
                    }
                    if (summary?.referralCount ?? 0) > 0 {
                        Text("\(summary?.referralCount ?? 0) friends joined with your code")
                            .font(TaliseFont.mono(11, weight: .regular))
                            .foregroundStyle(TaliseColor.fgMuted)
                    }
                    LiquidGlassButton(
                        title: "Share Talise",
                        icon: "square.and.arrow.up",
                        size: .lg
                    ) {
                        share(text: "Join me on Talise: https://talise.io/r/\(code)")
                    }
                }
                .padding(20)
                .earnHeroGlass(cornerRadius: 20)
            }
        }
    }

    // MARK: - Data

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            summary = try await APIClient.shared.get("/api/referral/summary")
        } catch {
            // SwiftUI `.task` cancellation on view rebuild is not a real
            // failure — surface only genuine errors.
            if !APIError.isCancellation(error) {
                self.error = error.localizedDescription
            }
        }
    }

    private func share(text: String) {
        let activity = UIActivityViewController(activityItems: [text], applicationActivities: nil)
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }?
            .rootViewController?
            .present(activity, animated: true)
    }
}
