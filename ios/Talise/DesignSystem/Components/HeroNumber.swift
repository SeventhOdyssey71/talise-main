import SwiftUI

/// Centered display number used across Home / Earn / Rewards.
/// Mirrors web `<HeroNumber>` — 88-104pt depending on platform size class.
struct HeroNumber: View {
    let value: String
    var eyebrow: String? = nil
    var sub: String? = nil
    @Environment(\.horizontalSizeClass) private var sizeClass

    private var fontSize: CGFloat {
        sizeClass == .compact ? 64 : 88
    }

    var body: some View {
        VStack(spacing: 12) {
            if let eyebrow {
                Eyebrow(text: eyebrow)
            }
            Text(value)
                .font(TaliseFont.display(fontSize, weight: .medium))
                .kerning(-2)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .foregroundStyle(TaliseColor.fg)
                .contentTransition(.numericText())
            if let sub {
                Text(sub)
                    .font(TaliseFont.body(13))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

struct StatCard: View {
    let eyebrow: String
    let value: String
    var sub: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow(text: eyebrow)
            Text(value)
                .font(TaliseFont.heading(20))
                .foregroundStyle(TaliseColor.fg)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            if let sub {
                Text(sub)
                    .font(TaliseFont.body(12))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
        }
        .padding(TaliseSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TaliseColor.surface)
        .overlay(
            RoundedRectangle(cornerRadius: TaliseRadius.lg)
                .stroke(TaliseColor.line, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: TaliseRadius.lg))
    }
}

#Preview {
    VStack(spacing: 24) {
        HeroNumber(value: "$1,284.50", eyebrow: "Total balance", sub: "USDsui · live")
        HStack(spacing: 12) {
            StatCard(eyebrow: "APY", value: "5.2%", sub: "live")
            StatCard(eyebrow: "Daily", value: "$0.18")
            StatCard(eyebrow: "Sends", value: "12")
        }
    }
    .padding()
}
