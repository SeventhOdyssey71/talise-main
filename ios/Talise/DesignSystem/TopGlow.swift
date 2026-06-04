import SwiftUI

/// Mossy-green top wash matching the onboarding gradient verbatim
/// (`WelcomeView` + `OnboardingBackground`). One palette across the
/// whole app: bright forest green at the top, fading to pure black
/// before the content area. Linear (not radial) so the brightness
/// reads evenly across the screen width instead of pooling under the
/// notch. Stops match `OnboardingBackground` exactly so a user coming
/// out of onboarding into the first authenticated tab sees the wash
/// continue without a perceptible jump.
struct TopGlow: View {
    var body: some View {
        LinearGradient(
            stops: [
                .init(color: Color(hex: 0x6BA85A), location: 0.0),
                .init(color: Color(hex: 0x355626), location: 0.18),
                .init(color: Color.black,           location: 0.55),
                .init(color: Color.black,           location: 1.0),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        // Taller-than-content band so the bottom half stays pure black
        // for the History rows + tab bar; the green only lives in the
        // top ~30% of the screen, same as `WelcomeView`.
        .frame(height: 520)
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

/// Reusable FLAT card treatment — glassmorphism retired. (Name kept so the
/// 75 `.taliseGlass()` call sites don't churn; it no longer uses any blur.)
///
/// Layering, outer → inner:
///   solid surface > optional flat directional tint > hairline edge
///
/// - Solid `TaliseColor.surface` fill — a clean opaque panel on the black
///   page, not an ambient frosted plate.
/// - Optional `tint` adds a quiet flat green wash (Sent / Received / Earn)
///   over the surface — no gradient, no material.
/// - One faint `TaliseColor.line` hairline defines the edge. No specular
///   gradient, no drop shadow — the Apple-system flat look.
///
/// `interactive: true` opts the card into a press-down brighten — used
/// when the card itself is a button.
///
/// Usage:
///   `.taliseGlass()`                            // 25pt default radius
///   `.taliseGlass(cornerRadius: 14)`            // smaller card
///   `.taliseGlass(tint: TaliseColor.accent)`    // directional
///   `.taliseGlass(interactive: true)`           // pressable
struct TaliseGlassCard: ViewModifier {
    let cornerRadius: CGFloat
    let tint: Color?
    let interactive: Bool
    @Environment(\.isEnabled) private var isEnabled

    init(cornerRadius: CGFloat = 25, tint: Color? = nil, interactive: Bool = false) {
        self.cornerRadius = cornerRadius
        self.tint = tint
        self.interactive = interactive
    }

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        return content
            .background(
                ZStack {
                    // 1. Flat solid surface — NO blur material. Clean opaque
                    //    panel on the black page, in the Apple-system idiom.
                    shape.fill(TaliseColor.surface)
                    // 2. Optional directional tint — Sent / Received / Earn
                    //    cards get a quiet flat wash of their green over the
                    //    surface (no gradient, no glass).
                    if let tint {
                        shape.fill(tint.opacity(0.13))
                    }
                }
            )
            .overlay(
                // 3. One faint hairline to define the card edge on black.
                shape.strokeBorder(TaliseColor.line, lineWidth: 1)
            )
            .clipShape(shape)
            .opacity(isEnabled ? 1.0 : 0.6)
    }
}

extension View {
    /// Apply the Talise Liquid Glass treatment to any container.
    /// - Parameters:
    ///   - cornerRadius: Corner radius of the rounded rect. Defaults to 25
    ///     (matches the large activity / username cards).
    ///   - tint: Optional directional color overlay (Sent red, Received
    ///     green, Earn green). When nil the card is neutral glass.
    ///   - interactive: When true the card slightly brightens on press;
    ///     attach inside a Button label or use the `.taliseGlassPressable()`
    ///     style on a Button.
    func taliseGlass(
        cornerRadius: CGFloat = 25,
        tint: Color? = nil,
        interactive: Bool = false
    ) -> some View {
        modifier(TaliseGlassCard(cornerRadius: cornerRadius, tint: tint, interactive: interactive))
    }
}

/// Press-down brighten for any glass card used as a button. Applies a
/// momentary white wash + scale to mimic the liquid-glass "tap pulse".
struct LiquidGlassPressStyle: ButtonStyle {
    var cornerRadius: CGFloat = 25

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(Color.white.opacity(configuration.isPressed ? 0.06 : 0.0))
                    .allowsHitTesting(false)
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1.0)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

extension View {
    /// Convenience for wrapping a Button label so it animates on press
    /// with the Liquid Glass pulse — pair with `.taliseGlass()`.
    func taliseGlassPressable(cornerRadius: CGFloat = 25) -> some View {
        buttonStyle(LiquidGlassPressStyle(cornerRadius: cornerRadius))
    }
}
