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
    /// Optional callback fired when the user taps the "Swap to USDsui"
    /// CTA that appears on inbound non-USDsui coin rows (2026-05-29 —
    /// replaces the archived auto-swap cron). When nil, the CTA is
    /// hidden and the row behaves as before.
    var onSwapToUsdsui: (() -> Void)? = nil

    /// True when the inbound coin on this row should surface the
    /// "Swap to USDsui" affordance. Triggers on:
    ///   • direction == "received"
    ///   • otherCoin present (i.e. NOT a plain USDsui/SUI receive)
    ///   • otherCoin.symbol is not already USDsui
    private var showsSwapCTA: Bool {
        guard onSwapToUsdsui != nil else { return false }
        guard entry.direction == "received" else { return false }
        guard let other = entry.otherCoin else { return false }
        return other.symbol.uppercased() != "USDSUI"
    }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 14) {
                ZStack {
                    // Tinted directional badge — dusty red for Sent,
                    // mossy green for Received, accent for Invest. The
                    // bg is the tint at ~32% over the page bg, the
                    // arrow is the tint at full saturation so it
                    // reads as a colored glyph on a colored disc.
                    Circle()
                        .fill(badgeBgColor)
                        .frame(width: 32, height: 32)
                    Image(systemName: iconName)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(badgeFgColor)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(TaliseFont.body(13, weight: .light))
                        .kerning(-0.48)
                        .foregroundStyle(TaliseColor.fg)
                    MicroLabel(text: subtitle, color: TaliseColor.fgDim)
                        .kerning(-0.32)
                    if showsSwapCTA {
                        // "Swap to USDsui" — small, accent-tinted CTA
                        // shown directly under the subtitle on inbound
                        // non-USDsui coin rows. Replaces the archived
                        // auto-swap cron. POSTs `/api/swap/prepare` via
                        // the caller-supplied `onSwapToUsdsui` handler.
                        Button {
                            onSwapToUsdsui?()
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "arrow.triangle.2.circlepath")
                                    .font(.system(size: 10, weight: .semibold))
                                Text("Swap to USDsui")
                                    .font(TaliseFont.body(11, weight: .medium))
                            }
                            .foregroundStyle(TaliseColor.accent)
                            .padding(.top, 2)
                        }
                        .buttonStyle(.plain)
                    }
                }
                Spacer()
                // Amount only — the whole row is tappable so the
                // "Details ↗" eyebrow was visual filler. Subtitle
                // already carries the "tap me" affordance via the
                // row-press tint.
                Text(amountFormatted)
                    .font(TaliseFont.body(14, weight: .light))
                    .kerning(-0.56)
                    .foregroundStyle(TaliseColor.fg)
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
        case invest
        case withdraw
        case autoswap
        case neutral
    }

    /// Server-side `direction` field carries the classification. Plain
    /// transfers ride the chain-derived sent/received; yield venue
    /// txs (DeepBook supply, NAVI lending) come back as
    /// `invest`/`withdraw`; vault auto-swap conversions come back as
    /// `autoswap` (emitted by `VaultAutoSwap` event in the Move
    /// `talise::vault` module). Each gets its own icon + tint.
    private var category: Category {
        switch entry.direction {
        case "received": return .received
        case "invest":   return .invest
        case "withdraw": return .withdraw
        case "autoswap": return .autoswap
        // DEX swaps (the legacy Convert banner, manual Cetus calls,
        // anything where the user moved one coin in and a different
        // one out in the same tx) share the auto-swap visual
        // language — green leaf, accent tint — because the user
        // doesn't care which path moved the funds; what matters is
        // "I converted X into Y." Auto-swap and manual swap render
        // identically.
        case "swap":     return .autoswap
        case "sent":     return .sent
        default:         return .neutral
        }
    }

    private var tintColor: Color {
        switch category {
        case .sent:     return Color(hex: 0xC95A4A)
        case .received: return Color(hex: 0x4FB35E)
        // Invest + withdraw share the Talise green accent — they're
        // yield motion, not money lost / gained from another wallet.
        case .invest:   return TaliseColor.accent
        case .withdraw: return Color(hex: 0x4FB35E)
        // Auto-swap also reads as green — it's the system working on
        // the user's behalf to keep the @handle in USDsui.
        case .autoswap: return TaliseColor.accent
        case .neutral:  return .clear
        }
    }

    /// Circular badge fill (the disc behind the arrow). A 32% wash of
    /// the directional color over the page background reads as
    /// "muted dusty red / forest green" without competing with the
    /// row's content text.
    private var badgeBgColor: Color {
        switch category {
        case .sent:     return Color(hex: 0xC95A4A).opacity(0.32)
        case .received: return Color(hex: 0x4FB35E).opacity(0.32)
        case .invest:   return TaliseColor.accent.opacity(0.22)
        case .withdraw: return Color(hex: 0x4FB35E).opacity(0.32)
        case .autoswap: return TaliseColor.accent.opacity(0.22)
        case .neutral:  return TaliseColor.surface2
        }
    }

    /// Arrow color inside the badge. Sits at full saturation against
    /// the muted disc, matching the design ref where the glyph is
    /// noticeably brighter than its background.
    private var badgeFgColor: Color {
        switch category {
        case .sent:     return Color(hex: 0xF0A99E)
        case .received: return Color(hex: 0xA9DFB3)
        case .invest:   return TaliseColor.accent
        case .withdraw: return Color(hex: 0xA9DFB3)
        case .autoswap: return TaliseColor.accent
        case .neutral:  return TaliseColor.fg
        }
    }

    private var tintAlpha: Double {
        switch category {
        case .sent, .received, .invest, .withdraw, .autoswap: return 0.18
        case .neutral:                                         return 0
        }
    }

    /// SF Symbol used in the circular badge. Invest uses the leaf
    /// (matches the Invest tab bar icon, so the connection between
    /// "the tab I supplied from" and "this row" is visual not just
    /// textual). Withdraw mirrors with the leaf inverted via
    /// arrow.down-on-leaf — see invest case below.
    private var iconName: String {
        switch category {
        case .sent:     return "arrow.up.right"
        case .received: return "arrow.down.left"
        case .invest:   return "leaf.fill"
        case .withdraw: return "leaf"
        // Auto-swap reuses the leaf — same family as the Earn / Invest
        // tab, signalling "the system worked for you". The conversion
        // is implicit in the title ("Auto-swapped 0.5 SUI → $1.20").
        case .autoswap: return "leaf.fill"
        case .neutral:  return "circle"
        }
    }

    private var title: String {
        // Non-USDsui/non-SUI rows (WAL, USDC, USDT, …) override the
        // default "Sent"/"Received" so the row clearly shows the coin.
        if let other = entry.otherCoin {
            return entry.isReceived
                ? "Received \(other.symbol)"
                : "Sent \(other.symbol)"
        }
        switch category {
        case .sent:     return "Sent"
        case .received: return "Received"
        case .invest:
            if let v = entry.venue, !v.isEmpty {
                return "Invested in \(displayVenueName(v))"
            }
            return "Invested"
        case .withdraw:
            if let v = entry.venue, !v.isEmpty {
                return "Withdrew from \(displayVenueName(v))"
            }
            return "Withdrew"
        case .autoswap:
            // Two flavors share this case:
            //   • direction == "autoswap" → the vault's cron-driven
            //     swap (sub-second auto-conversion). Server emits the
            //     source coin via `venue`.
            //   • direction == "swap" → any DEX swap touching the
            //     user's wallet (legacy Convert banner, direct Cetus
            //     call, etc.). For these we render "Swapped X → Y"
            //     using the SUI / otherCoin / USDsui legs we have.
            //
            // Title is just the verb; `amountFormatted` does the
            // "X → Y" composition.
            if entry.direction == "swap" { return "Swapped" }
            if let v = entry.venue, !v.isEmpty {
                return "Auto-swapped \(v.uppercased())"
            }
            return "Auto-swapped to USDsui"
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
        // Auto-swap & manual swap are net-neutral economically — one
        // coin in, a different coin out. We render BOTH legs of the
        // transformation ("0.1 SUI → ₦139.59") so the row reads as
        // a conversion rather than a debit/credit. The title already
        // tells the user what category they're looking at.
        if category == .autoswap {
            // Build the leg strings independently so we can compose
            // "from → to" no matter which fields the server populated:
            //   • SUI ↔ USDsui swap: amountSui + amountUsdsui
            //   • USDC/WAL/etc → USDsui: otherCoin + amountUsdsui
            //   • USDsui → SUI (rare): amountUsdsui + amountSui
            var legs: [String] = []
            if let sui = entry.amountSui, sui > 0 {
                legs.append(String(format: "%.4f SUI", sui))
            }
            if let other = entry.otherCoin {
                legs.append("\(other.displayAmount) \(other.symbol)")
            }
            if let usd = entry.amountUsdsui, usd > 0 {
                legs.append(TaliseFormat.local2(usd))
            }
            switch legs.count {
            case 0: return "→ —"
            case 1: return "→ \(legs[0])"
            default:
                // Always end on USDsui when present — that's the
                // canonical Talise unit, and the "destination" the
                // user opted into when they enabled auto-swap.
                return "\(legs[0]) → \(legs[1])"
            }
        }
        // Invest = wallet → pool (debit, "-"); Withdraw = pool → wallet
        // (credit, "+"). Plain transfers use direction directly.
        let isInflow = entry.isReceived || entry.isWithdraw
        let prefix = isInflow ? "+" : "-"
        // Non-USDsui/non-SUI row: format raw u64 with the coin's
        // decimals + symbol. We don't compute a USD value because
        // we don't have a reliable price for arbitrary tokens.
        if let other = entry.otherCoin {
            return "\(prefix)\(other.displayAmount) \(other.symbol)"
        }
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
