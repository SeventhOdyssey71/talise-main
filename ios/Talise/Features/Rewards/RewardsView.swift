import SwiftUI
import UIKit

/// Rewards tab — the points + perks hub.
///
/// Structure (2026-06-10 refresh, modeled on the reference points-hub
/// layout the founder shared, in Talise greens):
///   1. HERO — one solid forest card: points balance + tier + honest
///      progress to the next tier.
///   2. STAT TILES — two-up: Referrals · Sent with Talise.
///   3. SHARE CTA — the big referral action (code row + share button).
///   4. INFO STRIP — one quiet line on how referrals earn.
///   5. EARNING HISTORY — recent point events from the server ledger.
///   6. HOW YOU EARN — the rate rules, last (reference, not action).
struct RewardsView: View {
    @State private var summary: RewardsSummary?
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 24) {
                heroCard
                statTiles
                shareSection
                infoStrip
                historySection
                earnRulesSection
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

    // MARK: - 1. Hero — points balance on a solid forest card

    @ViewBuilder
    private var heroCard: some View {
        let tier = summary?.tier
        let points = summary?.pointsTotal ?? 0

        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Reward points")
                    .font(TaliseFont.mono(11, weight: .regular))
                    .kerning(1.6)
                    .textCase(.uppercase)
                    .foregroundStyle(Color.white.opacity(0.75))
                Spacer()
                // Tier chip — quiet, top-right (Bronze/Silver/Gold/Plat).
                Text(tier?.label ?? "Bronze")
                    .font(TaliseFont.mono(10, weight: .regular))
                    .kerning(0.8)
                    .foregroundStyle(TaliseColor.greenMint)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(Color.white.opacity(0.12)))
            }

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(points.formatted())")
                    .font(TaliseFont.heading(44, weight: .semibold))
                    .kerning(-1.2)
                    .foregroundStyle(.white)
                    .contentTransition(.numericText())
                Text("pts")
                    .font(TaliseFont.heading(17, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.65))
            }
            .redacted(reason: loading && summary == nil ? .placeholder : [])

            tierProgress(tier: tier, points: points)
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [Color(hex: 0x3A6E2A), Color(hex: 0x224417)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    /// Honest progress to the next tier — no fake minimum fill. Rendered
    /// in white-on-forest inside the hero.
    @ViewBuilder
    private func tierProgress(tier: RewardsTier?, points: Int) -> some View {
        if let nextLabel = tier?.nextLabel, let toNext = tier?.pointsToNext, toNext > 0 {
            let total = points + toNext
            let progress = total > 0 ? Double(points) / Double(total) : 0
            VStack(alignment: .leading, spacing: 8) {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.16))
                        Capsule()
                            .fill(TaliseColor.greenMint)
                            .frame(width: max(4, geo.size.width * progress))
                    }
                }
                .frame(height: 5)
                Text("\(toNext.formatted()) pts to \(nextLabel)")
                    .font(TaliseFont.mono(10.5, weight: .regular))
                    .foregroundStyle(Color.white.opacity(0.7))
            }
        } else if tier != nil {
            Text("Top tier — every point still counts toward perks")
                .font(TaliseFont.mono(10.5, weight: .regular))
                .foregroundStyle(TaliseColor.greenMint)
        }
    }

    // MARK: - 2. Stat tiles

    private var statTiles: some View {
        HStack(spacing: 12) {
            statTile(
                icon: "person.2",
                value: "\(summary?.referralCount ?? 0)",
                label: "Referrals"
            )
            statTile(
                icon: "paperplane",
                value: TaliseFormat.local2(summary?.lifetimeSentUsd ?? 0),
                label: "Sent with Talise"
            )
        }
    }

    private func statTile(icon: String, value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(TaliseColor.greenMint)
                .frame(width: 34, height: 34)
                .background(
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .fill(TaliseColor.greenMint.opacity(0.12))
                )
            Text(value)
                .font(TaliseFont.heading(22, weight: .semibold))
                .kerning(-0.5)
                .foregroundStyle(TaliseColor.fg)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(label)
                .font(TaliseFont.body(12, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(TaliseColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(Color.white.opacity(0.05), lineWidth: 1)
        )
    }

    // MARK: - 3. Share CTA (referral code + the one big action)

    @ViewBuilder
    private var shareSection: some View {
        if let code = summary?.code {
            VStack(spacing: 12) {
                HStack {
                    Text(code)
                        .font(TaliseFont.mono(15, weight: .regular))
                        .kerning(1.0)
                        .foregroundStyle(TaliseColor.fg)
                    Spacer(minLength: 8)
                    LiquidGlassPill(title: "Copy", icon: "doc.on.doc", compact: true) {
                        UIPasteboard.general.string = "https://talise.io/r/\(code)"
                    }
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 14)
                .background(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(TaliseColor.surface)
                )

                LiquidGlassButton(
                    title: "Share Talise",
                    icon: "square.and.arrow.up",
                    size: .lg
                ) {
                    share(text: "Join me on Talise: https://talise.io/r/\(code)")
                }
            }
        }
    }

    // MARK: - 4. Info strip

    private var infoStrip: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "sparkles")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(TaliseColor.greenMint)
                .padding(.top, 1)
            Text("Invite friends — you earn points when they join and start moving money.")
                .font(TaliseFont.body(12.5, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(TaliseColor.surface.opacity(0.6))
        )
    }

    // MARK: - 5. Earning history

    @ViewBuilder
    private var historySection: some View {
        let events = summary?.recentEvents ?? []
        if !events.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader("Earning history")
                VStack(spacing: 0) {
                    ForEach(Array(events.prefix(6).enumerated()), id: \.element.id) { i, ev in
                        HStack(alignment: .center, spacing: 12) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(historyTitle(ev.kind))
                                    .font(TaliseFont.body(14, weight: .regular))
                                    .foregroundStyle(TaliseColor.fg)
                                Text(historyDate(ev.createdAt))
                                    .font(TaliseFont.mono(10, weight: .regular))
                                    .foregroundStyle(TaliseColor.fgDim)
                            }
                            Spacer(minLength: 8)
                            Text("+\(ev.points)")
                                .font(TaliseFont.heading(15, weight: .medium))
                                .foregroundStyle(TaliseColor.accent)
                        }
                        .padding(.horizontal, 18)
                        .padding(.vertical, 12)
                        if i < min(events.count, 6) - 1 {
                            RowDivider()
                        }
                    }
                }
                .padding(.vertical, 4)
                .earnHeroGlass(cornerRadius: 20)
            }
        }
    }

    private func historyTitle(_ kind: String) -> String {
        switch kind {
        case "send":            return "Sent money"
        case "invest":          return "Saved to yield"
        case "roundup":         return "Round-up auto-save"
        case "goal", "goal_deposit": return "Added to a goal"
        case "referral":        return "Friend joined"
        default:                return "Points earned"
        }
    }

    private func historyDate(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso) else { return iso }
        let fmt = DateFormatter()
        fmt.dateFormat = "d MMM yyyy"
        return fmt.string(from: date)
    }

    // MARK: - 6. How you earn

    /// Transparent "how points work" explainer as one grouped card of
    /// rows. Reads the server's `pointRates` so the numbers always match
    /// the engine; falls back to documented defaults on older builds.
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
