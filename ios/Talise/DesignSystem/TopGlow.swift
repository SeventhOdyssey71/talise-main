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

/// Reusable "Liquid Glass" treatment matching the Figma's depth spec.
///
/// Layering, outer → inner:
///   material > dark tint > directional tint (optional) > specular stroke > shadow
///
/// - `.ultraThinMaterial` captures whatever sits behind the card (page bg,
///   TopGlow wash) so cards read as ambient glass, not flat plates.
/// - Dark tint (~0.42) anchors the material into dark mode — without it
///   `.ultraThinMaterial` reads too light against pure black.
/// - Optional `tint` lets directional surfaces (Sent red, Received green,
///   Earn green) compose naturally by adding a faint colored wash on top
///   of the dark tint.
/// - Top-down gradient stroke is the specular highlight — brighter at the
///   top edge to suggest light hitting curved glass.
/// - Two stacked shadows (big soft / tight hard) give weight without
///   bleeding past the edges.
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
                    // 1. System material — the actual blur backdrop.
                    shape.fill(.ultraThinMaterial)
                    // 2. Dark tint — pulls the material into dark mode.
                    shape.fill(Color.black.opacity(0.42))
                    // 3. Optional directional tint — gives Sent / Received /
                    //    Earn cards their accent without losing glass-ness.
                    if let tint {
                        shape.fill(
                            LinearGradient(
                                colors: [
                                    tint.opacity(0.22),
                                    tint.opacity(0.06),
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                    }
                }
            )
            .overlay(
                // 4. Flat hairline stroke — was a 3-stop top-down gradient.
                //    The gradient stroke read as decorative chrome at small
                //    sizes and made every glass card on screen feel busy.
                //    One white hairline is enough to define the edge.
                shape.strokeBorder(Color.white.opacity(0.10), lineWidth: 1)
            )
            .clipShape(shape)
            // 5. Single soft shadow — dropped the tight inner stroke shadow
            //    so cards don't double-print under each other on stacked
            //    surfaces (Earn, Profile). One shadow is enough for depth.
            .shadow(color: Color.black.opacity(0.45), radius: 18, x: 0, y: 8)
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
