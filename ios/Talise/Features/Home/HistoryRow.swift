import SwiftUI

/// Single history row. Reused by Home (top 4) and HistoryView (full list).
///
/// Visual treatment is the Liquid Glass card from TaliseGlassCard with
/// a directional tint stacked over the system material:
///   • Sent     → small red tint
///   • Received → small green tint
///   • Other    → no tint (neutral glass)
///
/// Tints are intentionally low alpha (~0.10) so the row reads as
/// "subtly colored glass" against the dark page, not a solid pill.
struct HistoryRow: View {
    let entry: ActivityEntryDTO
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 14) {
                ZStack {
                    Circle().fill(TaliseColor.surface2).frame(width: 32, height: 32)
                    Image(systemName: iconName)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(TaliseFont.body(13, weight: .light))
                        .kerning(-0.48)
                        .foregroundStyle(TaliseColor.fg)
                    MicroLabel(text: subtitle, color: TaliseColor.fgDim)
                        .kerning(-0.32)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(amountFormatted)
                        .font(TaliseFont.body(14, weight: .light))
                        .kerning(-0.56)
                        .foregroundStyle(TaliseColor.fg)
                    HStack(spacing: 2) {
                        MicroLabel(text: "Details", color: TaliseColor.fgMuted)
                            .kerning(-0.32)
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 8, weight: .regular))
                            .foregroundStyle(TaliseColor.fgMuted)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        // Directional tint is only applied while the user is pressing
        // the row — at rest the row reads as neutral glass; on press
        // it picks up red (sent) or green (received) with a smooth
        // crossfade. Neutral category never tints.
        .buttonStyle(HistoryRowButtonStyle(
            tintColor: tintColor,
            tintAlpha: tintAlpha
        ))
    }

    // MARK: - Category + tint

    private enum Category {
        case sent
        case received
        case neutral   // Invest, Claim Reward, anything else — no tint
    }

    /// Today we only have the chain-derived direction (sent / received).
    /// Adding Invest / Claim Reward categories will require server-side
    /// classification (detect NAVI supply, rewards claim, etc.); until
    /// then those map to `neutral` once they land. For now the chain
    /// view yields just Sent/Received, so this is a 1:1 mapping.
    private var category: Category {
        entry.isReceived ? .received : .sent
    }

    private var tintColor: Color {
        switch category {
        case .sent:     return Color(hex: 0xC95A4A)
        case .received: return Color(hex: 0x4FB35E)
        case .neutral:  return .clear
        }
    }

    private var tintAlpha: Double {
        switch category {
        case .sent, .received: return 0.18  // press-only, so slightly punchier
        case .neutral:         return 0
        }
    }

    private var iconName: String {
        switch category {
        case .sent:     return "arrow.up.right"
        case .received: return "arrow.down.left"
        case .neutral:  return "circle"
        }
    }

    private var title: String {
        switch category {
        case .sent:     return "Sent"
        case .received: return "Received"
        case .neutral:  return "Activity"
        }
    }

    private var subtitle: String {
        let date = Date(timeIntervalSince1970: entry.timestampMs / 1000)
        let fmt = RelativeDateTimeFormatter()
        fmt.unitsStyle = .abbreviated
        return fmt.localizedString(for: date, relativeTo: Date())
    }

    private var amountFormatted: String {
        let prefix = entry.isReceived ? "+" : "-"
        if let usd = entry.amountUsdsui {
            return prefix + TaliseFormat.local2(Swift.abs(usd))
        }
        if let sui = entry.amountSui {
            return String(format: "\(prefix)%.4f SUI", Swift.abs(sui))
        }
        return prefix + "—"
    }
}

/// Glassy row background that animates a directional tint in/out
/// based on the button's pressed state. At rest the row reads as
/// neutral glass; on press it picks up red (Sent) or green (Received).
private struct HistoryRowButtonStyle: ButtonStyle {
    let tintColor: Color
    let tintAlpha: Double

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: 18, style: .continuous)
        let alpha = configuration.isPressed ? tintAlpha : 0
        return configuration.label
            .background(
                ZStack {
                    shape.fill(.ultraThinMaterial)
                    shape.fill(Color.black.opacity(0.35))
                    shape.fill(tintColor.opacity(alpha))
                }
            )
            .overlay(
                shape.strokeBorder(
                    LinearGradient(
                        colors: [
                            Color.white.opacity(0.16),
                            Color.white.opacity(0.04),
                            Color.white.opacity(0.08),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                    lineWidth: 1
                )
            )
            .clipShape(shape)
            .scaleEffect(configuration.isPressed ? 0.985 : 1.0)
            .shadow(color: Color.black.opacity(0.25), radius: 10, x: 0, y: 4)
            .animation(.easeOut(duration: 0.18), value: configuration.isPressed)
    }
}
