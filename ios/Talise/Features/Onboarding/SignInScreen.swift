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
                    Image("GoogleG")
                        .resizable()
                        .scaledToFit()
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

// The leading icon on the "Continue with Google" CTA uses the real
// Google "G" mark from the asset catalog (`Image("GoogleG")`), per
// Google's sign-in branding guidelines.
