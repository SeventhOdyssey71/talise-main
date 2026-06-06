import SwiftUI

/// Primary CTA dressed in Liquid Glass instead of a flat fill. Use anywhere
/// we currently lean on a solid accent button — Send, Confirm, Add Money,
/// "Earn", etc. — to keep the Apple HIG glass language consistent.
///
/// Layering, outer → inner:
///   material > dark tint > directional accent wash > specular stroke > shadow
///
/// The `tint` is what gives the button its identity. A `nil` tint reads as
/// neutral glass (good for secondary actions); pass `TaliseColor.accent`
/// for the canonical green CTA, `.danger` for destructive actions, etc.
///
/// Sizes mirror `TaliseButton` so swap-in is mechanical. The press
/// interaction is handled by `LiquidGlassPressStyle` so it pulses the
/// way the rest of the system does.
struct LiquidGlassButton: View {
    let title: String
    var icon: String? = nil
    var tint: Color? = TaliseColor.accent
    var size: TaliseButtonSize = .lg
    var loading: Bool = false
    var fullWidth: Bool = true
    var action: () -> Void

    var body: some View {
        Button(action: { if !loading { action() } }) {
            HStack(spacing: 8) {
                if loading {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .controlSize(.small)
                        .tint(labelColor)
                } else if let icon {
                    Image(systemName: icon)
                        .font(.system(size: size.fontSize + 1, weight: .medium))
                }
                Text(title)
                    .font(TaliseFont.heading(size.fontSize, weight: .medium))
            }
            .foregroundStyle(labelColor)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .frame(height: size.height)
            .padding(.horizontal, size.hPadding)
            .background(
                ZStack {
                    let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    if let fillGradient {
                        // Dimensional gradient fill for the bright-green CTA —
                        // a real lit pill, not a flat block.
                        shape.fill(fillGradient)
                    } else if let tint {
                        // Other tints (danger / gold) keep their solid identity
                        // but ride on a thin material so they read as glass.
                        shape.fill(.ultraThinMaterial)
                        shape.fill(tint)
                    } else {
                        // Neutral / secondary — translucent glass surface.
                        shape.fill(.ultraThinMaterial)
                        shape.fill(TaliseColor.surface2.opacity(0.7))
                    }
                    // Interior top sheen — the polished-glass crown.
                    shape.fill(TaliseGlass.topSheen)
                }
            )
            .overlay(
                // Specular edge on every variant so it reads as a lit pill.
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(tint == nil ? TaliseGlass.edge : TaliseGlass.edgeSoft, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .shadow(color: shadowColor, radius: 14, x: 0, y: 8)
            .opacity(loading ? 0.85 : 1.0)
        }
        .taliseGlassPressable(cornerRadius: cornerRadius)
        .disabled(loading)
    }

    /// Bright Talise greens get the dimensional `greenCTA` gradient; every
    /// other tint keeps a solid fill (handled in the background ZStack).
    private var fillGradient: LinearGradient? {
        guard let tint else { return nil }
        let brightGreens = [
            TaliseColor.accent, TaliseColor.greenMint,
            TaliseColor.greenDeep, TaliseColor.live, TaliseColor.success,
        ]
        return brightGreens.contains(tint) ? TaliseColor.greenCTA : nil
    }

    /// A faint brand-tinted glow under the primary CTA; neutral elsewhere.
    private var shadowColor: Color {
        if fillGradient != nil { return TaliseColor.greenDeep.opacity(0.35) }
        return Color.black.opacity(0.4)
    }

    private var cornerRadius: CGFloat {
        switch size {
        case .sm: return 12
        case .md: return 14
        case .lg: return 16
        }
    }

    /// Dark ink on the bright Talise greens (for contrast + pop); white on
    /// the neutral surface and the darker tints (danger / gold).
    private var labelColor: Color {
        guard let tint else { return TaliseColor.fg }
        let brightGreens = [
            TaliseColor.accent, TaliseColor.greenMint,
            TaliseColor.live, TaliseColor.success,
        ]
        return brightGreens.contains(tint) ? Color(hex: 0x0A140C) : TaliseColor.fg
    }
}

#Preview {
    ZStack {
        TaliseColor.bg.ignoresSafeArea()
        TopGlow().ignoresSafeArea(edges: .top)
        VStack(spacing: 16) {
            LiquidGlassButton(title: "Send money", icon: "arrow.up.right") {}
            LiquidGlassButton(title: "Confirm", tint: nil, size: .md) {}
            LiquidGlassButton(title: "Migrate", icon: "arrow.triangle.2.circlepath", tint: TaliseColor.warmGold, size: .md) {}
            LiquidGlassButton(title: "Delete", tint: TaliseColor.danger, size: .md) {}
            LiquidGlassButton(title: "Loading…", loading: true) {}
        }
        .padding()
    }
}
