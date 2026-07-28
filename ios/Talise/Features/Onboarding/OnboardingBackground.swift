import SwiftUI

/// Reusable backdrop for the onboarding multi-step flow (sign-in →
/// handle pick → PIN setup → permissions). Matches `WelcomeView`'s
/// palette and direction: a mossy-green wash at the TOP of the screen
/// fading DOWN into pure black at the bottom, plus a soft pastel-green
/// bloom anchored top-right to add the frosted-glass dimensionality
/// from the reference screenshots.
///
/// Apply via `.background(OnboardingBackground())` on a ZStack-rooted
/// screen, or place it as the first child in a ZStack with
/// `.ignoresSafeArea()`.
struct OnboardingBackground: View {
    @Environment(\.colorScheme) private var scheme

    // Hoisted + explicitly typed: a ternary between two inline Gradient.Stop
    // literals makes Swift's type-checker blow up inside a view body.
    private static let washDark: [Gradient.Stop] = [
        Gradient.Stop(color: Color(hex: 0x6BA85A), location: 0.0),
        Gradient.Stop(color: Color(hex: 0x355626), location: 0.28),
        Gradient.Stop(color: Color.black, location: 0.68),
        Gradient.Stop(color: Color.black, location: 1.0),
    ]
    // Deliberately SHORT and faint. The first pass ran a heavy mint to 72% of
    // the screen, which read as an unfinished gradient and muddied the white
    // ground the light spec is built on. This is a tint at the very top that is
    // gone by a third of the way down — brand present, page still crisp white.
    private static let washLight: [Gradient.Stop] = [
        Gradient.Stop(color: Color(hex: 0xCAFFB8).opacity(0.34), location: 0.0),
        Gradient.Stop(color: Color(hex: 0xCAFFB8).opacity(0.10), location: 0.16),
        Gradient.Stop(color: Color.white.opacity(0.0), location: 0.36),
        Gradient.Stop(color: Color.white.opacity(0.0), location: 1.0),
    ]

    var body: some View {
        GeometryReader { proxy in
            let W = proxy.size.width
            let H = proxy.size.height

            ZStack {
                // Black base — bottom half stays near-pure-black.
                TaliseColor.bg
                    .ignoresSafeArea()

                // Vertical wash. DARK: mossy green fading to black. LIGHT: the
                // same gesture inverted — a mint tint falling to white. This
                // MUST be theme-aware: the dark stops end opaque black, and
                // with the adaptive palette the headline is near-black on light,
                // so reusing them left "Welcome to Talise" unreadable.
                LinearGradient(
                    stops: scheme == .dark ? Self.washDark : Self.washLight,
                    startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()

                // Soft pastel-green bloom anchored top-right — the
                // "frosted glass surface" highlight. Sized so it reads
                // as a diffuse glow rather than a hard disc.
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color(hex: 0x9BD68A).opacity(0.55),
                                Color(hex: 0x6BA85A).opacity(0.18),
                                Color.clear,
                            ],
                            center: .center,
                            startRadius: 0,
                            endRadius: min(W, H) * 0.55
                        )
                    )
                    .frame(width: min(W, H) * 1.4, height: min(W, H) * 1.4)
                    .offset(x: W * 0.35, y: -H * 0.45)
                    // `.screen` lightens toward white, so on a light ground it
                    // does nothing. Use normal blending there and let the low
                    // opacities carry the bloom.
                    .blendMode(scheme == .dark ? .screen : .normal)
                    .opacity(scheme == .dark ? 1.0 : 0.5)
                    .ignoresSafeArea()
            }
        }
        .ignoresSafeArea()
    }
}
