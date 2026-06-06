import SwiftUI

struct SignInView: View {
    @Environment(AppSession.self) private var session
    @State private var signingIn = false
    @State private var error: String?
    @State private var appeared = false

    var body: some View {
        ZStack {
            // Cinematic canvas: pure-black base with a soft brand-green
            // wash blooming from the top-left, in the iOS-26 idiom.
            TaliseColor.bg.ignoresSafeArea()
            signInWash.ignoresSafeArea()

            VStack(alignment: .leading, spacing: TaliseSpacing.xl) {
                Spacer()

                // Brand mark — small mono-cap eyebrow, sits quietly above
                // the hero so the headline owns the screen.
                HStack(spacing: 8) {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [TaliseColor.greenMint, TaliseColor.greenDeep],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 8, height: 8)
                    Text("TALISE")
                        .font(TaliseFont.mono(11, weight: .regular))
                        .tracking(3.0)
                        .foregroundStyle(TaliseColor.fgMuted)
                }
                .opacity(appeared ? 1 : 0)
                .offset(y: appeared ? 0 : 8)

                // Big confident hero headline.
                Text("Send money\nacross the globe.\nFor free.")
                    .font(TaliseFont.display(40, weight: .medium))
                    .kerning(-1.2)
                    .foregroundStyle(TaliseColor.fg)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .opacity(appeared ? 1 : 0)
                    .offset(y: appeared ? 0 : 14)

                Text("One Google account. One Sui address. No seed phrase, no setup. You sign with Face ID; we never see your keys.")
                    .font(TaliseFont.body(15))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, TaliseSpacing.xs)
                    .opacity(appeared ? 1 : 0)
                    .offset(y: appeared ? 0 : 18)

                Spacer()

                VStack(spacing: TaliseSpacing.md) {
                    if let error {
                        Text(error)
                            .font(TaliseFont.body(12))
                            .foregroundStyle(TaliseColor.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .transition(.opacity)
                    }

                    LiquidGlassButton(
                        title: "Continue with Google",
                        icon: "g.circle.fill",
                        size: .lg,
                        loading: signingIn
                    ) {
                        Task { await beginSignIn() }
                    }

                    Text("By continuing you agree to our Terms and Privacy.")
                        .font(TaliseFont.body(11))
                        .foregroundStyle(TaliseColor.fgDim)
                        .frame(maxWidth: .infinity, alignment: .center)
                }
                .opacity(appeared ? 1 : 0)
                .offset(y: appeared ? 0 : 22)
                .padding(.bottom, TaliseSpacing.md)
            }
            .padding(.horizontal, TaliseSpacing.xl)
        }
        .animation(.easeOut(duration: 0.55), value: appeared)
        .animation(.easeOut(duration: 0.2), value: error)
        .onAppear { appeared = true }
    }

    /// Soft brand-green bloom from the top — a quiet liquid-glass wash, not
    /// a loud gradient. Two stacked radial gradients keep it organic.
    private var signInWash: some View {
        ZStack {
            RadialGradient(
                colors: [Color(hex: 0x1C3D24).opacity(0.9), Color.clear],
                center: .init(x: 0.15, y: 0.0),
                startRadius: 0,
                endRadius: 520
            )
            RadialGradient(
                colors: [Color(hex: 0x14301C).opacity(0.6), Color.clear],
                center: .init(x: 0.95, y: 0.28),
                startRadius: 0,
                endRadius: 420
            )
        }
        .allowsHitTesting(false)
    }

    private func beginSignIn() async {
        signingIn = true
        error = nil
        defer { signingIn = false }
        do {
            let result = try await ZkLoginCoordinator.shared.signIn()
            session.handleSignedIn(user: result.user)
        } catch GoogleSignInService.SignInError.cancelled {
            // user backed out — no error toast
        } catch {
            self.error = error.localizedDescription
        }
    }
}
