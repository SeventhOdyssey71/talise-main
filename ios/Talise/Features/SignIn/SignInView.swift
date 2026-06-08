import SwiftUI

struct SignInView: View {
    @Environment(AppSession.self) private var session
    @State private var signingIn = false
    @State private var error: String?
    @State private var appeared = false

    var body: some View {
        ZStack {
            // Flat near-black canvas. No bloom, no wash — the headline owns
            // the screen.
            TaliseColor.bg.ignoresSafeArea()

            VStack(alignment: .leading, spacing: TaliseSpacing.xl) {
                Spacer()

                // Brand mark — small mono-cap eyebrow, sits quietly above
                // the hero so the headline owns the screen.
                HStack(spacing: 8) {
                    Circle()
                        .fill(TaliseColor.greenMint)
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

                    // Flat solid primary CTA — green fill, dark ink, no glass.
                    Button {
                        Task { await beginSignIn() }
                    } label: {
                        HStack(spacing: 8) {
                            if signingIn {
                                ProgressView()
                                    .progressViewStyle(.circular)
                                    .controlSize(.small)
                                    .tint(Color(hex: 0x0A140C))
                            } else {
                                Image(systemName: "g.circle.fill")
                                    .font(.system(size: 16, weight: .semibold))
                                Text("Continue with Google")
                                    .font(TaliseFont.heading(16, weight: .medium))
                            }
                        }
                        .foregroundStyle(Color(hex: 0x0A140C))
                        .frame(maxWidth: .infinity)
                        .frame(height: 54)
                        .background(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .fill(TaliseColor.greenMint)
                        )
                        .opacity(signingIn ? 0.85 : 1.0)
                    }
                    .buttonStyle(.plain)
                    .disabled(signingIn)

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
