import SwiftUI

/// Small capsule CTA — "Copy", "Suiscan", "Migrate", "View all", etc.
/// Sits inline with text or in row trailing positions.
///
/// Layering, outer → inner:
///   material > dark tint > optional accent wash > specular stroke > shadow
///
/// Uses a Capsule (not RoundedRect) so it scales gracefully with the
/// label's intrinsic width. Compact by default — height 28 — to nest
/// inside cards without dominating them.
struct LiquidGlassPill: View {
    let title: String
    var icon: String? = nil
    var tint: Color? = nil
    var compact: Bool = false
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: compact ? 10 : 11, weight: .medium))
                }
                Text(title)
                    .font(TaliseFont.body(compact ? 11 : 12, weight: .medium))
                    .kerning(-0.1)
            }
            .foregroundStyle(TaliseColor.fg)
            .padding(.horizontal, compact ? 10 : 14)
            .frame(height: compact ? 24 : 30)
            .background(
                ZStack {
                    Capsule().fill(.ultraThinMaterial)
                    Capsule().fill(TaliseColor.glassTint)
                    if let tint {
                        Capsule().fill(
                            LinearGradient(
                                colors: [tint.opacity(0.22), tint.opacity(0.06)],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                    }
                }
            )
            .overlay(
                Capsule().strokeBorder(
                    LinearGradient(
                        colors: [
                            TaliseColor.strokeSpecularTop,
                            TaliseColor.strokeSpecularMid,
                            TaliseColor.strokeSpecularBottom,
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                    lineWidth: 1
                )
            )
            .clipShape(Capsule())
            .shadow(color: Color.black.opacity(0.40), radius: 8, x: 0, y: 3)
        }
        .buttonStyle(LiquidGlassPillPressStyle())
    }
}

/// Capsule-specific press style — same idea as `LiquidGlassPressStyle` but
/// shape-correct so the tap pulse hugs the pill edge.
private struct LiquidGlassPillPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .overlay(
                Capsule()
                    .fill(TaliseColor.pressPulse.opacity(configuration.isPressed ? 1.0 : 0.0))
                    .allowsHitTesting(false)
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

#Preview {
    ZStack {
        TaliseColor.bg.ignoresSafeArea()
        VStack(spacing: 14) {
            HStack(spacing: 10) {
                LiquidGlassPill(title: "Copy", icon: "doc.on.doc") {}
                LiquidGlassPill(title: "Suiscan", icon: "arrow.up.right.square") {}
                LiquidGlassPill(title: "Migrate", tint: TaliseColor.warmGold) {}
            }
            HStack(spacing: 10) {
                LiquidGlassPill(title: "View all", compact: true) {}
                LiquidGlassPill(title: "Live", icon: "circle.fill", tint: TaliseColor.live, compact: true) {}
            }
        }
        .padding()
    }
}
