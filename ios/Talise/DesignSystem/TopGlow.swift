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
