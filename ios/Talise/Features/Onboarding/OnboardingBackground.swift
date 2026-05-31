import SwiftUI

/// Reusable backdrop for the onboarding multi-step flow (handle pick →
/// PIN setup → permissions). The treatment matches the "Zypp" inspiration
/// screenshots: a soft pastel-green wash at the BOTTOM of the screen
/// fading UP into pure black at the top. Inverts the `WelcomeView` palette
/// so the post-Welcome screens read as a continuation rather than a
/// repeat. Same hex tokens, just stacked the other way + a soft radial
/// bloom in the bottom-right to add the frosted-glass dimensionality
/// from the reference.
///
/// Apply via `.background(OnboardingBackground())` on a ZStack-rooted
/// screen, or place it as the first child in a ZStack with
/// `.ignoresSafeArea()`.
struct OnboardingBackground: View {
    var body: some View {
        GeometryReader { proxy in
            let W = proxy.size.width
            let H = proxy.size.height

            ZStack {
                // Black base — top half stays near-pure-black.
                TaliseColor.bg
                    .ignoresSafeArea()

                // Vertical wash: black at top, mossy green at bottom.
                // Same hex stops as WelcomeView, reversed direction.
                LinearGradient(
                    stops: [
                        .init(color: Color.black,             location: 0.0),
                        .init(color: Color.black,             location: 0.32),
                        .init(color: Color(hex: 0x355626),    location: 0.72),
                        .init(color: Color(hex: 0x6BA85A),    location: 1.0),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()

                // Soft pastel-green bloom anchored bottom-right — the
                // "frosted glass surface" highlight from the reference.
                // Sized to ~80% of the shortest edge so it reads as a
                // diffuse glow rather than a hard disc.
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
                    .offset(x: W * 0.35, y: H * 0.45)
                    .blendMode(.screen)
                    .ignoresSafeArea()
            }
        }
        .ignoresSafeArea()
    }
}
