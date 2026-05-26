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
                    // 2. Mode-aware tint — black ~0.42 in dark, white ~0.55 in
                    //    light. Without this the material reads too neutral
                    //    against either pure-black or pure-white pages.
                    shape.fill(TaliseColor.glassTint)
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
                // 4. Specular highlight — bright on top, dim in the middle,
                //    slight return at the bottom for the "glass slab" feel.
                //    Asset-driven so it flips to a black-opacity gradient in
                //    light mode (white-on-white would be invisible).
                shape.strokeBorder(
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
            .clipShape(shape)
            // 5. Two-layer shadow — large soft for depth, small tight for
            //    the contact-point shadow against the page bg.
            .shadow(color: Color.black.opacity(0.55), radius: 22, x: 0, y: 10)
            .shadow(color: Color.black.opacity(0.32), radius: 3, x: 0, y: 1)
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
                    .fill(TaliseColor.pressPulse.opacity(configuration.isPressed ? 1.0 : 0.0))
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
