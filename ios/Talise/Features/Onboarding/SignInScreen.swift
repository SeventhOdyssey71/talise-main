import SwiftUI

/// Restyled Continue-with-Google screen used as the auth step inside
/// the onboarding coordinator. Visually echoes the carousel and welcome
/// screens (centered hero illustration over a primary-button capsule).
/// Reuses `ZkLoginCoordinator.shared.signIn()` — does NOT reimplement
/// auth. On success the resulting `UserDTO` is passed up to
/// `OnboardingRoot` so the KYC-tier picker can run before the global
/// `AppSession` state advances.
struct SignInScreen: View {
    let onSignedIn: (UserDTO) -> Void
    @State private var signingIn = false
    @State private var error: String?

    var body: some View {
        ZStack {
            TaliseColor.bg.ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer(minLength: 24)

                hero
                    .frame(width: 96, height: 96)

                Text("Welcome to Talise")
                    .font(TaliseFont.heading(28, weight: .medium))
                    .kerning(-0.8)
                    .foregroundStyle(TaliseColor.fg)
                    .padding(.top, 28)

                Text("One Google account. One Sui address.\nNo seed phrase, no setup.")
                    .font(TaliseFont.body(14, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .multilineTextAlignment(.center)
                    .padding(.top, 10)
                    .padding(.horizontal, 32)

                Spacer()

                if let error {
                    Text(error)
                        .font(TaliseFont.body(12))
                        .foregroundStyle(TaliseColor.danger)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                        .padding(.bottom, 8)
                }

                TaliseButton(
                    title: "Continue with Google",
                    variant: .primary,
                    size: .lg,
                    icon: "g.circle.fill",
                    loading: signingIn
                ) {
                    Task { await beginSignIn() }
                }
                .padding(.horizontal, 24)

                Text("By continuing you agree to our Terms and Privacy.")
                    .font(TaliseFont.body(11, weight: .light))
                    .foregroundStyle(TaliseColor.fgDim)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, 14)
                    .padding(.bottom, 24)
            }
            .padding(.horizontal, 8)
        }
    }

    @ViewBuilder
    private var hero: some View {
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
                .padding(14)
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
