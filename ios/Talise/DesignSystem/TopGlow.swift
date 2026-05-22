import SwiftUI

/// Subtle dark-blue atmospheric wash that sits at the top of each
/// authenticated tab. Reads as a faint "horizon glow" against the pure
/// black background — not a hard color band.
///
/// Implementation: two stacked radial gradients with low alpha + a
/// blur. The deep one anchors the hue; the lighter overlay catches
/// SwiftUI's depth shading at the top edge.
struct TopGlow: View {
    var body: some View {
        ZStack(alignment: .top) {
            // Wide, very-low-alpha base wash.
            RadialGradient(
                colors: [
                    Color(red: 0.16, green: 0.22, blue: 0.42).opacity(0.30),
                    Color(red: 0.16, green: 0.22, blue: 0.42).opacity(0.08),
                    .clear,
                ],
                center: .init(x: 0.5, y: 0.0),
                startRadius: 20,
                endRadius: 380
            )
            // Cooler top-edge highlight to hint at light coming in.
            RadialGradient(
                colors: [
                    Color(red: 0.40, green: 0.55, blue: 0.95).opacity(0.18),
                    .clear,
                ],
                center: .init(x: 0.5, y: 0.0),
                startRadius: 0,
                endRadius: 200
            )
        }
        .blur(radius: 28)
        .frame(height: 320)
        .frame(maxWidth: .infinity, alignment: .top)
        .allowsHitTesting(false)
    }
}

/// Convenience modifier — add a TopGlow behind any tab's content.
struct TaliseScreenBackground: ViewModifier {
    func body(content: Content) -> some View {
        ZStack(alignment: .top) {
            TaliseColor.bg.ignoresSafeArea()
            TopGlow()
                .ignoresSafeArea(edges: .top)
            content
        }
    }
}

extension View {
    /// Standard authenticated-screen background: black + a subtle blue
    /// top glow. Apply at the root of each tab view.
    func taliseScreenBackground() -> some View {
        modifier(TaliseScreenBackground())
    }
}

/// Reusable "Liquid Glass" treatment matching the Figma's depth spec.
/// Same recipe as the bottom-nav pill — a `.ultraThinMaterial` blur,
/// a dark tint to anchor it on a black page, a top→bottom gradient
/// stroke for the specular highlight, and two layered drop-shadows for
/// elevation.
///
/// Usage: `.taliseGlass(cornerRadius: 25)` on any container view. The
/// blur captures whatever sits behind the card (page background,
/// TopGlow wash), so cards over the TopGlow region read as ambient
/// glass against the dark blue, not flat black plates.
struct TaliseGlassCard: ViewModifier {
    let cornerRadius: CGFloat

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        return content
            .background(
                ZStack {
                    shape.fill(.ultraThinMaterial)
                    shape.fill(Color.black.opacity(0.45))
                }
            )
            .overlay(
                shape.strokeBorder(
                    LinearGradient(
                        colors: [
                            Color.white.opacity(0.22),
                            Color.white.opacity(0.04),
                            Color.white.opacity(0.10),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                    lineWidth: 1
                )
            )
            .clipShape(shape)
            .shadow(color: Color.black.opacity(0.45), radius: 22, x: 0, y: 10)
            .shadow(color: Color.black.opacity(0.30), radius: 3, x: 0, y: 1)
    }
}

extension View {
    func taliseGlass(cornerRadius: CGFloat = 25) -> some View {
        modifier(TaliseGlassCard(cornerRadius: cornerRadius))
    }
}
