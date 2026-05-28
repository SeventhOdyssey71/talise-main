import SwiftUI

/// Vertical "options list" row used by the Deposit and Withdraw flows.
/// Visual recipe: round icon badge on the left, title + subtitle in the
/// middle, optional badge after the title, chevron on the right. Same
/// glass-card chrome as the rest of the app.
///
/// Designed for tap-to-navigate (NavigationLink) — pure presentation,
/// no internal action wiring.
struct OptionCardRow: View {
    let icon: String          // SF Symbol name
    let title: String
    let subtitle: String
    var badge: String? = nil  // e.g. "No fee"
    var accent: Color = TaliseColor.accent

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(accent.opacity(0.15))
                    .frame(width: 40, height: 40)
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(accent)
            }

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(title)
                        .font(TaliseFont.heading(15, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                    if let badge {
                        Text(badge)
                            .font(TaliseFont.mono(9, weight: .light))
                            .kerning(0.4)
                            .foregroundStyle(accent)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(
                                Capsule().fill(accent.opacity(0.15))
                            )
                    }
                }
                Text(subtitle)
                    .font(TaliseFont.body(12, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(TaliseColor.fgDim)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TaliseColor.surfaceGlass)
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(TaliseColor.line, lineWidth: 0.5)
        )
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}
