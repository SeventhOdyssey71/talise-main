import SwiftUI

/// Continue-with-Google screen used as step 1 of the onboarding flow.
/// Sits over the shared `OnboardingBackground` so the green wash and
/// frosted bloom continue from the Welcome hero into auth and on to
/// the handle / PIN / permissions steps.
///
/// Reuses `ZkLoginCoordinator.shared.signIn()` — does NOT reimplement
/// auth. On success the resulting `UserDTO` is passed up to
/// `OnboardingRoot` so the rest of the onboarding flow can run.
struct SignInScreen: View {
    let onSignedIn: (UserDTO) -> Void
    @State private var signingIn = false
    @State private var error: String?

    /// Letter-spacing helper — same `-size × 0.03` ratio used across
    /// the onboarding flow (matches the Figma "-0.705 ls @ 23.5pt"
    /// headline spec).
    private func kern(_ size: CGFloat) -> CGFloat { -size * 0.03 }

    var body: some View {
        ZStack {
            OnboardingBackground()

            VStack(spacing: 0) {
                // Top spacer — leaves room for the OnboardingRoot
                // progress-bar overlay (mounted by the coordinator
                // for this step).
                Spacer().frame(height: 70)

                Spacer()

                hero
                    .frame(width: 96, height: 96)

                Text("Welcome to Talise")
                    .font(TaliseFont.heading(26, weight: .semibold))
                    .kerning(kern(26))
                    .foregroundStyle(TaliseColor.fg)
                    .padding(.top, 28)

                Text("One Google account. One Sui address.\nNo seed phrase, no setup.")
                    .font(TaliseFont.body(14, weight: .light))
                    .kerning(kern(14))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .multilineTextAlignment(.center)
                    .padding(.top, 10)
                    .padding(.horizontal, 32)

                Spacer()

                if let error {
                    Text(error)
                        .font(TaliseFont.body(12))
                        .kerning(kern(12))
                        .foregroundStyle(TaliseColor.danger)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                        .padding(.bottom, 8)
                }

                continueWithGoogleButton
                    .padding(.horizontal, 24)

                Text("By continuing you agree to our Terms and Privacy.")
                    .font(TaliseFont.body(11, weight: .light))
                    .kerning(kern(11))
                    .foregroundStyle(TaliseColor.fgDim)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, 14)
                    .padding(.bottom, 28)
            }
        }
    }

    // ── CTA ────────────────────────────────────────────────────────

    /// White capsule CTA matching the Welcome hero "Get Started"
    /// shape (54pt tall, capsule clip, white fill, bg text). The
    /// Google G mark sits inline-left of the title, ~20pt wide.
    private var continueWithGoogleButton: some View {
        Button {
            Task { await beginSignIn() }
        } label: {
            HStack(spacing: 10) {
                if signingIn {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(TaliseColor.bg)
                        .frame(width: 20, height: 20)
                } else {
                    GoogleGLogo()
                        .frame(width: 20, height: 20)
                }
                Text("Continue with Google")
                    .font(TaliseFont.body(15, weight: .medium))
                    .kerning(kern(15))
                    .foregroundStyle(TaliseColor.bg)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .background(TaliseColor.fg)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(signingIn)
    }

    // ── Hero (Talise pinwheel) ─────────────────────────────────────

    @ViewBuilder
    private var hero: some View {
        if UIImage(named: "TaliseLogo") != nil {
            Image("TaliseLogo")
                .resizable()
                .scaledToFit()
        } else {
            Canvas { ctx, size in
                let cx = size.width / 2
                let cy = size.height / 2
                let r: CGFloat = size.width * 0.22
                for i in 0..<4 {
                    let angle = CGFloat(i) * .pi / 2
                    var t = CGAffineTransform(translationX: cx, y: cy)
                    t = t.rotated(by: angle)
                    t = t.translatedBy(x: 0, y: -size.height * 0.28)
                    let rect = CGRect(
                        x: -r * 0.45, y: -r * 0.55,
                        width: r * 0.9, height: r * 1.15
                    ).applying(t)
                    ctx.fill(Path(ellipseIn: rect), with: .color(.white))
                }
            }
        }
    }

    private func beginSignIn() async {
        signingIn = true
        error = nil
        defer { signingIn = false }
        do {
            let result = try await ZkLoginCoordinator.shared.signIn()
            onSignedIn(result.user)
        } catch GoogleSignInService.SignInError.cancelled {
            // Quiet — the user explicitly backed out of the OAuth sheet.
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// ── Google G logo ──────────────────────────────────────────────────

/// SwiftUI-drawn approximation of Google's 4-colour "G" mark — drawn
/// as a stroked arc that segments into the four Google brand colours
/// plus an inner horizontal bar tip. Recognizable at button-icon
/// sizes (20–28pt) without requiring an external trademark asset.
///
/// Trademark note: this is a stylised reproduction for in-app sign-in
/// affordance; before a public release the asset should be replaced
/// with the official Google sign-in mark per Google's branding
/// guidelines (https://developers.google.com/identity/branding-guidelines).
private struct GoogleGLogo: View {
    /// Brand hex from the Google identity guidelines.
    private let blue   = Color(red: 0x42 / 255, green: 0x85 / 255, blue: 0xF4 / 255)
    private let red    = Color(red: 0xEA / 255, green: 0x43 / 255, blue: 0x35 / 255)
    private let yellow = Color(red: 0xFB / 255, green: 0xBC / 255, blue: 0x05 / 255)
    private let green  = Color(red: 0x34 / 255, green: 0xA8 / 255, blue: 0x53 / 255)

    var body: some View {
        GeometryReader { proxy in
            let s = min(proxy.size.width, proxy.size.height)
            let lw = s * 0.22                 // stroke width
            let r  = (s - lw) / 2             // arc radius
            let cx = proxy.size.width / 2
            let cy = proxy.size.height / 2

            ZStack {
                // Four arcs around a centre point, each a quarter of
                // the circle, in the order red (top-left) → blue
                // (top-right) → green (bottom-right) → yellow
                // (bottom-left).
                arc(center: CGPoint(x: cx, y: cy), radius: r,
                    from: .degrees(180), to: .degrees(270))
                    .stroke(red, style: .init(lineWidth: lw, lineCap: .butt))
                arc(center: CGPoint(x: cx, y: cy), radius: r,
                    from: .degrees(270), to: .degrees(360))
                    .stroke(blue, style: .init(lineWidth: lw, lineCap: .butt))
                arc(center: CGPoint(x: cx, y: cy), radius: r,
                    from: .degrees(0), to: .degrees(90))
                    .stroke(green, style: .init(lineWidth: lw, lineCap: .butt))
                arc(center: CGPoint(x: cx, y: cy), radius: r,
                    from: .degrees(90), to: .degrees(180))
                    .stroke(yellow, style: .init(lineWidth: lw, lineCap: .butt))

                // Inner horizontal bar — the G's tongue — drawn in
                // blue (matches the original mark's interior). Starts
                // at the centre and extends right to meet the inner
                // edge of the blue arc.
                Rectangle()
                    .fill(blue)
                    .frame(width: r * 0.85, height: lw * 0.85)
                    .position(x: cx + r * 0.4, y: cy)

                // Small notch where the red arc meets the horizontal
                // bar — punches a transparent wedge so the G's mouth
                // reads correctly. Painted as a black rectangle that
                // gets composited away by the parent's white
                // background (works because the Sign-In button is
                // white).
                Rectangle()
                    .fill(Color.white)
                    .frame(width: lw * 0.6, height: lw * 0.55)
                    .position(x: cx + r * 0.05, y: cy - lw * 0.05)
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }

    private func arc(center: CGPoint, radius: CGFloat,
                     from start: Angle, to end: Angle) -> Path {
        var p = Path()
        p.addArc(center: center, radius: radius,
                 startAngle: start, endAngle: end, clockwise: false)
        return p
    }
}
