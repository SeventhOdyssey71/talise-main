import SwiftUI
import UIKit

/// Rewards tab — the money-management hub.
///
/// Phase 1 (this file): tier badge with next-tier progress, lifetime
/// stats row (sent + saved in the user's display currency), earn-rules
/// card explaining how points accrue, referral card, recent activity.
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
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 22) {
                header
                tierCard
                lifetimeStatsRow
                // ANCHOR: roundup-section
                RoundupCard(summary: summary, onChange: { Task { await load() } })
                // ANCHOR: goals-section
                earnRulesCard
                // ANCHOR: redeem-section
                RedemptionsSection(pointsTotal: summary?.pointsTotal ?? 0, onRedeemed: { Task { await load() } })
                referralCard
                recentSection
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

        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    MicroLabel(
                        text: tier?.label.uppercased() ?? "BRONZE",
                        color: TaliseColor.accent
                    ).kerning(2.0)
                    Text("\(points)")
                        .font(TaliseFont.heading(40, weight: .medium))
                        .kerning(-1.4)
                        .foregroundStyle(TaliseColor.fg)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text("points")
                        .font(TaliseFont.body(12, weight: .light))
                        .foregroundStyle(TaliseColor.fgDim)
                }
                Spacer()
                tierGlyph(tier?.id ?? "bronze")
            }

            tierProgressBar(tier: tier, points: points)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TaliseColor.surface)
        .overlay(
            RoundedRectangle(cornerRadius: 22)
                .stroke(TaliseColor.accent.opacity(0.18), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 22))
    }

    /// Color-shifted glyph per tier — a quick visual rank cue without
    /// shipping bespoke artwork yet. Future: real tier badges from
    /// the brand kit.
    private func tierGlyph(_ id: String) -> some View {
        let color: Color = {
            switch id {
            case "silver": return Color(hex: 0xC0C0C0)
            case "gold":   return Color(hex: 0xE0B048)
            case "plat":   return Color(hex: 0xB0E0E6)
            default:       return Color(hex: 0xB87333) // bronze
            }
        }()
        return ZStack {
            Circle().fill(color.opacity(0.18))
                .frame(width: 56, height: 56)
            Image(systemName: "rosette")
                .font(.system(size: 26, weight: .medium))
                .foregroundStyle(color)
        }
    }

    /// "850 points to Gold" sub-line + filled progress bar. Hidden
    /// (replaced by "Top tier" pill) when `nextLabel` is nil.
    @ViewBuilder
    private func tierProgressBar(tier: RewardsTier?, points: Int) -> some View {
        if let nextLabel = tier?.nextLabel, let toNext = tier?.pointsToNext, toNext > 0 {
            VStack(alignment: .leading, spacing: 8) {
                Text("\(toNext) points to \(nextLabel)")
                    .font(TaliseFont.mono(11, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                GeometryReader { geo in
                    let total = points + toNext
                    let progress: CGFloat = total > 0 ? CGFloat(points) / CGFloat(total) : 0
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.06))
                        Capsule().fill(TaliseColor.accent)
                            .frame(width: max(2, geo.size.width * progress))
                    }
                }
                .frame(height: 6)
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
        VStack(alignment: .leading, spacing: 6) {
            MicroLabel(text: label, color: TaliseColor.fgDim).kerning(1.5)
            Text(TaliseFormat.local2(value))
                .font(TaliseFont.heading(22, weight: .medium))
                .kerning(-0.8)
                .foregroundStyle(accent ? TaliseColor.accent : TaliseColor.fg)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        }
        .padding(18)
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
                    rate: rates?.save ?? 3,
                    accent: true
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

    private func earnRule(icon: String, label: String, rate: Int, accent: Bool = false) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(accent ? TaliseColor.accent.opacity(0.20) : TaliseColor.surface2)
                    .frame(width: 32, height: 32)
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(accent ? TaliseColor.accent : TaliseColor.fg)
            }
            Text(label)
                .font(TaliseFont.body(14, weight: .light))
                .foregroundStyle(TaliseColor.fg)
            Spacer()
            Text(rate == 1 ? "1 pt / $1" : "\(rate) pts / $1")
                .font(TaliseFont.mono(11, weight: .light))
                .foregroundStyle(accent ? TaliseColor.accent : TaliseColor.fgMuted)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
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

    // MARK: - Recent activity

    @ViewBuilder
    private var recentSection: some View {
        if let events = summary?.recentEvents, !events.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                MicroLabel(text: "Recent", color: TaliseColor.fgDim).kerning(1.5)
                VStack(spacing: 0) {
                    ForEach(Array(events.enumerated()), id: \.element.id) { idx, event in
                        eventRow(event)
                        if idx < events.count - 1 {
                            Rectangle().fill(Color.white.opacity(0.05))
                                .frame(height: 1).padding(.horizontal, 12)
                        }
                    }
                }
                .background(TaliseColor.surface)
                .clipShape(RoundedRectangle(cornerRadius: 22))
            }
        } else if !loading {
            VStack(spacing: 6) {
                Text("No activity yet")
                    .font(TaliseFont.body(14, weight: .light))
                    .foregroundStyle(TaliseColor.fg)
                Text("Send, save, or invite a friend — every action earns points.")
                    .font(TaliseFont.mono(10, weight: .light))
                    .foregroundStyle(TaliseColor.fgDim)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 24)
            .background(TaliseColor.surface)
            .clipShape(RoundedRectangle(cornerRadius: 22))
        }
    }

    private func eventRow(_ event: RewardsEvent) -> some View {
        HStack {
            Text(displayLabelForKind(event.kind))
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fg)
            Spacer()
            Text(event.points >= 0 ? "+\(event.points)" : "\(event.points)")
                .font(TaliseFont.heading(14, weight: .medium))
                .foregroundStyle(event.points >= 0 ? TaliseColor.accent : TaliseColor.danger)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    /// Friendly labels for the rewards_event kinds the server emits.
    /// Stays in sync with web/lib/rewards-constants.ts EVENT_LABELS.
    private func displayLabelForKind(_ kind: String) -> String {
        switch kind {
        case "send_earn":           return "Send"
        case "save_earn":           return "Saved to yield"
        case "roundup_save":        return "Round-up saved"
        case "withdraw_earn":       return "Withdrew from yield"
        case "goal_deposit":        return "Added to goal"
        case "redeemed":            return "Redeemed"
        case "referral_signup":     return "Friend signed up"
        case "referral_first_send": return "Friend's first send"
        case "volume_milestone":    return "Volume milestone"
        case "first_send":          return "Your first send"
        case "first_claim":         return "Claimed your handle"
        case "streak":              return "Daily streak"
        default:                    return kind.replacingOccurrences(of: "_", with: " ").capitalized
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
