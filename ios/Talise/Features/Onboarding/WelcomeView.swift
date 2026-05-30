import SwiftUI

/// Hero onboarding screen — first thing a fresh install sees after the
/// splash. Mossy-green radial gradient washes the top half down into
/// black; the Talise pinwheel sits in the upper-middle; bottom-left
/// headline + subtitle copy frames two CTAs (primary "Get Started" and
/// secondary "I have an account" for returning users) over a tiny
/// Terms acknowledgement footer.
///
/// `onContinue` → start the brand-intro carousel (new user path).
/// `onSignIn`   → jump straight to the sign-in sheet (returning user).
struct WelcomeView: View {
    let onContinue: () -> Void
    let onSignIn: () -> Void

    var body: some View {
        ZStack {
            // Black base so the gradient's lower half blends cleanly
            // into the safe-area.
            TaliseColor.bg.ignoresSafeArea()

            // Mossy green radial wash anchored at the top. The center
            // sits just above the screen top so the brightest area is
            // at the device's top edge, falling off to black around
            // ~55% of the viewport height. The hex (0x6BA85A) is a
            // softened forest green — the regular accent (0x79D96C)
            // is too vivid for a full-width wash.
            GeometryReader { proxy in
                RadialGradient(
                    colors: [
                        Color(hex: 0x6BA85A).opacity(0.95),
                        Color(hex: 0x2A3E22).opacity(0.6),
                        Color.black.opacity(0.0),
                    ],
                    center: UnitPoint(x: 0.5, y: -0.05),
                    startRadius: 0,
                    endRadius: proxy.size.height * 0.55
                )
                .ignoresSafeArea()
            }

            VStack(spacing: 0) {
                Spacer().frame(height: 120)

                logoMark
                    .frame(width: 96, height: 96)

                Spacer()

                copyBlock
                    .padding(.horizontal, 24)
                    .padding(.bottom, 20)

                primaryCTA
                    .padding(.horizontal, 24)
                    .padding(.bottom, 12)

                secondaryCTA
                    .padding(.horizontal, 24)
                    .padding(.bottom, 16)

                termsFooter
                    .padding(.horizontal, 32)
                    .padding(.bottom, 24)
            }
        }
        .preferredColorScheme(.dark)
    }

    // ── Subviews ────────────────────────────────────────────────────

    @ViewBuilder
    private var logoMark: some View {
        if UIImage(named: "TaliseLogo") != nil {
            Image("TaliseLogo")
                .resizable()
                .scaledToFit()
        } else {
            Pinwheel()
        }
    }

    private var copyBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Move money without borders")
                .font(TaliseFont.heading(26, weight: .medium))
                .kerning(-0.6)
                .foregroundStyle(TaliseColor.fg)
                .multilineTextAlignment(.leading)

            Text(
                "Moving money across the world is complex, Talise brings simplicity to this. Free transactions, smart money movement."
            )
            .font(TaliseFont.body(13, weight: .light))
            .foregroundStyle(TaliseColor.fgMuted)
            .multilineTextAlignment(.leading)
            .lineSpacing(2)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var primaryCTA: some View {
        Button(action: onContinue) {
            Text("Get Started")
                .font(TaliseFont.body(15, weight: .medium))
                .foregroundStyle(TaliseColor.bg)
                .frame(maxWidth: .infinity)
                .frame(height: 54)
                .background(TaliseColor.fg)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private var secondaryCTA: some View {
        Button(action: onSignIn) {
            Text("I have an account")
                .font(TaliseFont.body(15, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
                .frame(maxWidth: .infinity)
                .frame(height: 54)
                .background(TaliseColor.surface2)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private var termsFooter: some View {
        // Light footer ack — `Terms and Conditions` is underlined so it
        // reads as a link target. No tap handler yet (we don't have a
        // terms page route); when one ships, wrap the Text in a Button
        // that opens it.
        (Text("You accept ")
            + Text("Terms and Conditions").underline()
            + Text(" by continuing."))
            .font(TaliseFont.body(11, weight: .light))
            .foregroundStyle(TaliseColor.fgDim)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
    }
}

/// Hand-drawn approximation of the white pinwheel brand mark — same
/// geometry as `HomeView`'s `TaliseLogoMark`, duplicated here so the
/// Onboarding feature stays self-contained.
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
