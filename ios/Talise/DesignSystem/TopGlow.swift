import SwiftUI

/// Forest-green atmospheric wash that sits at the very top of each
/// authenticated tab. Reads as a tight "horizon glow" against the pure
/// black background — focused at the status-bar edge, fully transparent
/// well before reaching the content's first interactive element.
///
/// Earlier revision used a blue hue + a wide 320pt band, which spilled
/// through to the History rows and competed with the green Earn accent.
/// Switched to a hue that's a desaturated derivative of `TaliseColor.accent`
/// (the same Talise green used on "Earn up to 11%", venue badges, and
/// invest-row tints) so the page background hints at brand color
/// without polluting the surface.
struct TopGlow: View {
    var body: some View {
        // Center pushed well above the top edge (UnitPoint y: -0.6) so
        // only the lower arc of the radial is visible — that arc is
        // wide and gently curved across the full screen width, instead
        // of looking like a small spotlight in the middle. Combined
        // with a large endRadius this produces a "horizon wash" effect:
        // green at the very top edge, smoothly fading to pure black
        // by the time you reach mid-screen.
        ZStack(alignment: .top) {
            // Wide base wash. The big radius (600) is what makes the
            // glow span corner-to-corner; the off-screen center is
            // what flattens it into a gentle band rather than a circle.
            RadialGradient(
                colors: [
                    Color(red: 0.16, green: 0.42, blue: 0.26).opacity(0.65),
                    Color(red: 0.12, green: 0.30, blue: 0.20).opacity(0.30),
                    Color(red: 0.08, green: 0.18, blue: 0.13).opacity(0.10),
                    .clear,
                ],
                center: .init(x: 0.5, y: -0.6),
                startRadius: 0,
                endRadius: 600
            )
            // Brighter accent right under the notch — tighter radius,
            // higher saturation. This keeps a clear "lit" point at the
            // very top so the wash has structure instead of feeling
            // like flat tint.
            RadialGradient(
                colors: [
                    Color(red: 0.36, green: 0.66, blue: 0.42).opacity(0.42),
                    Color(red: 0.36, green: 0.66, blue: 0.42).opacity(0.16),
                    .clear,
                ],
                center: .init(x: 0.5, y: 0.0),
                startRadius: 0,
                endRadius: 320
            )
        }
        .blur(radius: 24)
        // Taller band — the wash needs room to decay to clear before
        // the History rows. With the new wide radii, 360pt gives the
        // gradient enough vertical real estate to spread without
        // bleeding into the activity list.
        .frame(height: 360)
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
