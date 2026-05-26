import SwiftUI

/// Hero screen with the dark-green-disc Talise mark, wordmark, the
/// product one-liner, three carousel dots, and the primary "Get started"
/// CTA. The `TaliseLogo` asset entry is intentionally empty — once
/// Higgsfield exports the disc + pinwheel PNG it drops in; until then
/// we render the same generated mark used in `HomeView`.
struct WelcomeView: View {
    let onContinue: () -> Void

    var body: some View {
        ZStack {
            TaliseColor.bg.ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                logoHero
                    .frame(width: 128, height: 128)
                    .padding(.bottom, 28)

                Text("Talise")
                    .font(TaliseFont.heading(36, weight: .medium))
                    .kerning(-1.2)
                    .foregroundStyle(TaliseColor.fg)

                Text("Send money across the globe. For free.")
                    .font(TaliseFont.body(15, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .multilineTextAlignment(.center)
                    .padding(.top, 12)
                    .padding(.horizontal, 32)

                Spacer()

                // Dot indicators pointing at the upcoming three carousel
                // slides — they're inert here (the carousel itself owns
                // the live selection state), purely a previewing affordance.
                HStack(spacing: 8) {
                    ForEach(0..<3, id: \.self) { _ in
                        Circle()
                            .fill(TaliseColor.fgDim)
                            .frame(width: 6, height: 6)
                    }
                }
                .padding(.bottom, 24)

                LiquidGlassButton(
                    title: "Get started",
                    size: .lg,
                    action: onContinue
                )
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
        }
    }

    @ViewBuilder
    private var logoHero: some View {
        // Real asset slots in once Higgsfield renders the dark-green disc
        // + white pinwheel. Until then, render the existing Canvas mark
        // inside a dark-green disc so the layout doesn't shift.
        if UIImage(named: "TaliseLogo") != nil {
            Image("TaliseLogo")
                .resizable()
                .scaledToFit()
        } else {
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(hex: 0x1F4730),
                                Color(hex: 0x0D2A1A),
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                Pinwheel()
                    .padding(20)
            }
        }
    }
}

/// Hand-drawn approximation of the dark-green-disc / white-pinwheel
/// brand mark. Reuses the same geometry as `HomeView`'s `TaliseLogoMark`
/// but is duplicated locally so the Onboarding feature stays self-
/// contained (no cross-feature import).
private struct Pinwheel: View {
    var body: some View {
        Canvas { ctx, size in
            let cx = size.width / 2
            let cy = size.height / 2
            let r: CGFloat = size.width * 0.22
            for i in 0..<4 {
                let angle = CGFloat(i) * .pi / 2
                var transform = CGAffineTransform(translationX: cx, y: cy)
                transform = transform.rotated(by: angle)
                transform = transform.translatedBy(x: 0, y: -size.height * 0.28)
                let rect = CGRect(
                    x: -r * 0.45, y: -r * 0.55,
                    width: r * 0.9, height: r * 1.15
                ).applying(transform)
                let path = Path(ellipseIn: rect)
                ctx.fill(path, with: .color(.white))
            }
        }
    }
}
