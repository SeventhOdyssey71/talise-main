import SwiftUI
import UIKit

/// Rewards tab — the money-management hub.
///
/// Phase 1 (this file): tier badge with next-tier progress, lifetime
/// stats row (sent + saved in the user's display currency), earn-rules
/// card explaining how points accrue, referral card.
///
/// Section anchors for parallel-agent work — DO NOT collapse these
/// markers; the Phase 2/3/4 agents key off them:
///
///   // ANCHOR: roundup-section   ← Phase 2 (Round-up & Save card)
///   // ANCHOR: goals-section     ← Phase 3 (Savings Goals)
///   // ANCHOR: redeem-section    ← Phase 4 (Redemption catalogue)
///
/// Each agent owns its own struct file (RoundupCard.swift,
/// GoalsSection.swift, RedemptionsSection.swift) and inserts a single
/// call site at its anchor — no overlapping edits on the body.
struct RewardsView: View {
    @State private var summary: RewardsSummary?
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        // Rewards = points + perks hub. The Money-management surfaces
        // (Round-up, Goals, Insights) moved to the Invest tab where
        // they semantically belong — Round-up auto-supplies to NAVI,
        // Goals are savings buckets, Insights are spend/save analytics.
        // Rewards stays focused on: tier progression, lifetime tallies,
        // how-you-earn rules, the redemption catalogue, and referrals.
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 22) {
                header
                tierCard
                lifetimeStatsRow
                earnRulesCard
                // ANCHOR: redeem-section
                RedemptionsSection(pointsTotal: summary?.pointsTotal ?? 0, onRedeemed: { Task { await load() } })
                referralCard
                if let error {
                    Text(error)
                        .font(TaliseFont.body(12, weight: .light))
                        .foregroundStyle(TaliseColor.danger)
                }
                Spacer(minLength: 120)
            }
            .padding(.horizontal, 24)
            .padding(.top, 24)
        }
        .refreshable { await load() }
        .taliseScreenBackground()
        .task { await load() }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            MicroLabel(text: "Rewards", color: TaliseColor.fgDim).kerning(1.5)
            Text("Spend, save, earn")
                .font(TaliseFont.heading(28, weight: .medium))
                .kerning(-1)
                .foregroundStyle(TaliseColor.fg)
        }
    }

    // MARK: - Tier card

    /// Tier badge + total points + progress bar to the next tier. The
    /// progress bar fades to a "Top tier" pill when there's no next
    /// rung. Tier info is server-computed (lib/rewards/earn.ts → TIERS)
    /// so iOS doesn't drift from the canonical thresholds.
    @ViewBuilder
    private var tierCard: some View {
        let tier = summary?.tier
        let points = summary?.pointsTotal ?? 0

        VStack(alignment: .leading, spacing: 18) {
            // Tier label sits above a big accent-green points number.
            // The earlier rosette-on-the-right was a separate visual
            // element fighting the brand (bronze orange vs Talise
            // green); dropped in favor of letting the number itself
            // be the hero — exactly the treatment the Round-up
            // card uses for "Saved via round-up ₦2.00".
            VStack(alignment: .leading, spacing: 6) {
                MicroLabel(
                    text: tier?.label.uppercased() ?? "BRONZE",
                    color: TaliseColor.accent
                ).kerning(2.0)
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(points)")
                        .font(TaliseFont.heading(44, weight: .medium))
                        .kerning(-1.6)
                        .foregroundStyle(TaliseColor.accent)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                    Text("points")
                        .font(TaliseFont.body(13, weight: .light))
                        .foregroundStyle(TaliseColor.fgDim)
                }
            }

            tierProgressBar(tier: tier, points: points)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TaliseColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 22))
    }

    /// "850 points to Silver" + a filled progress bar. The bar always
    /// has a minimum filled width (8pt) so brand-new users at 4 of
    /// 500 points don't see what looks like an empty track. Replaces
    /// the pill on top-tier accounts.
    @ViewBuilder
    private func tierProgressBar(tier: RewardsTier?, points: Int) -> some View {
        if let nextLabel = tier?.nextLabel, let toNext = tier?.pointsToNext, toNext > 0 {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("\(toNext.formatted()) to \(nextLabel)")
                        .font(TaliseFont.mono(11, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted)
                    Spacer()
                    Text("\(points.formatted()) / \((points + toNext).formatted())")
                        .font(TaliseFont.mono(10, weight: .light))
                        .foregroundStyle(TaliseColor.fgDim)
                }
                GeometryReader { geo in
                    let total = points + toNext
                    let progress: CGFloat = total > 0 ? CGFloat(points) / CGFloat(total) : 0
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.06))
                        // Min 8pt filled so the bar reads as "started"
                        // even for sub-1% progress. Looks like a real
                        // step instead of an empty rail.
                        Capsule().fill(TaliseColor.accent)
                            .frame(width: max(8, geo.size.width * progress))
                    }
                }
                .frame(height: 8)
            }
        } else if tier != nil {
            Text("Top tier — every point still counts toward perks")
                .font(TaliseFont.mono(11, weight: .light))
                .foregroundStyle(TaliseColor.accent)
        }
    }

    // MARK: - Lifetime stats row

    /// Two tiles side-by-side: lifetime Sent + lifetime Saved, in the
    /// user's display currency. The on-chain values are USD; the
    /// formatter localizes via CurrencySettings.
    private var lifetimeStatsRow: some View {
        HStack(spacing: 12) {
            lifetimeTile(
                label: "Lifetime sent",
                value: summary?.lifetimeSentUsd ?? 0,
                accent: false
            )
            lifetimeTile(
                label: "Lifetime saved",
                value: summary?.lifetimeSavedUsd ?? 0,
                accent: true
            )
        }
    }

    private func lifetimeTile(label: String, value: Double, accent: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            MicroLabel(text: label, color: TaliseColor.fgDim).kerning(1.5)
            Text(TaliseFormat.local2(value))
                // Bigger + bolder than the previous 22pt — matches the
                // confident "₦2.00" treatment on the Round-up card.
                // Accent tile gets vivid Talise green; the other stays
                // white so the eye picks the savings side as the win.
                .font(TaliseFont.heading(26, weight: .medium))
                .kerning(-0.9)
                .foregroundStyle(accent ? TaliseColor.accent : TaliseColor.fg)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TaliseColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 22))
    }

    // MARK: - Earn rules card

    /// Transparent "how points work" explainer. Reads from the server's
    /// `pointRates` so the displayed numbers always match the engine.
    /// If `pointRates` is missing (older server build) we fall back to
    /// hardcoded copy that mirrors the documented defaults.
    @ViewBuilder
    private var earnRulesCard: some View {
        let rates = summary?.pointRates
        VStack(alignment: .leading, spacing: 12) {
            MicroLabel(text: "How you earn", color: TaliseColor.fgDim).kerning(1.5)
            // Visually-consistent rows — every icon uses the same
            // subtle disc, every label same weight. The RATE value on
            // the right is what differentiates the row (e.g. 5 pts/$1
            // round-up reads as the standout because of the number,
            // not because the whole row looks different).
            VStack(spacing: 0) {
                earnRule(
                    icon: "paperplane",
                    label: "Send money",
                    rate: rates?.send ?? 1
                )
                earnRuleDivider
                earnRule(
                    icon: "leaf.fill",
                    label: "Save to yield",
                    rate: rates?.invest ?? 3
                )
                earnRuleDivider
                earnRule(
                    icon: "arrow.triangle.2.circlepath",
                    label: "Round-up auto-save",
                    rate: rates?.roundup ?? 5
                )
                earnRuleDivider
                earnRule(
                    icon: "target",
                    label: "Add to a goal",
                    rate: rates?.goal ?? 4
                )
            }
            .padding(.vertical, 4)
            .background(TaliseColor.surface)
            .clipShape(RoundedRectangle(cornerRadius: 22))
        }
    }

    /// Uniform row treatment — same icon disc, same label weight, same
    /// rate-text size across all four. The rate VALUE is the only
    /// thing that varies (and accent-green so it's the data-point the
    /// eye finds first). Earlier revision accented one whole row
    /// (Save to yield) and left the other three muted, which made
    /// the muted rows read as "lesser perks" rather than "different
    /// rates of the same system".
    private func earnRule(icon: String, label: String, rate: Int) -> some View {
        HStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(TaliseColor.accent.opacity(0.16))
                    .frame(width: 34, height: 34)
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(TaliseColor.accent)
            }
            Text(label)
                .font(TaliseFont.body(14, weight: .light))
                .foregroundStyle(TaliseColor.fg)
            Spacer()
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("\(rate)")
                    .font(TaliseFont.heading(15, weight: .medium))
                    .foregroundStyle(TaliseColor.accent)
                Text(rate == 1 ? "pt / $1" : "pts / $1")
                    .font(TaliseFont.mono(10, weight: .light))
                    .foregroundStyle(TaliseColor.fgDim)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    private var earnRuleDivider: some View {
        Rectangle().fill(Color.white.opacity(0.05))
            .frame(height: 1)
            .padding(.horizontal, 14)
    }

    // MARK: - Referral card

    @ViewBuilder
    private var referralCard: some View {
        if let code = summary?.code {
            VStack(alignment: .leading, spacing: 14) {
                MicroLabel(text: "Your referral code", color: TaliseColor.fgDim).kerning(1.5)
                HStack {
                    Text(code)
                        .font(TaliseFont.mono(15, weight: .light))
                        .foregroundStyle(TaliseColor.fg)
                    Spacer()
                    Button {
                        UIPasteboard.general.string = "https://talise.io/r/\(code)"
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "doc.on.doc")
                                .font(.system(size: 11, weight: .medium))
                            Text("Copy")
                                .font(TaliseFont.heading(12, weight: .medium))
                        }
                        .foregroundStyle(TaliseColor.fg)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(TaliseColor.surface2)
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
                if (summary?.referralCount ?? 0) > 0 {
                    Text("\(summary?.referralCount ?? 0) friends joined with your code")
                        .font(TaliseFont.mono(11, weight: .light))
                        .foregroundStyle(TaliseColor.accent)
                }
                Button {
                    share(text: "Join me on Talise: https://talise.io/r/\(code)")
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 13, weight: .medium))
                        Text("Share Talise")
                            .font(TaliseFont.heading(14, weight: .medium))
                    }
                    .foregroundStyle(TaliseColor.bg)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background(TaliseColor.fg)
                    .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
            .padding(18)
            .background(TaliseColor.usernameCard)
            .clipShape(RoundedRectangle(cornerRadius: 22))
        }
    }

    // MARK: - Data

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            summary = try await APIClient.shared.get("/api/referral/summary")
        } catch {
            self.error = error.localizedDescription
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
