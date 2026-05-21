import SwiftUI

struct SignInView: View {
    @Environment(AppSession.self) private var session
    @State private var signingIn = false
    @State private var error: String?

    private let googleSignIn = GoogleSignInService()

    var body: some View {
        ZStack {
            TaliseColor.bg.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 24) {
                Spacer()
                Text("Talise")
                    .font(TaliseFont.heading(28))
                    .foregroundStyle(TaliseColor.fg)
                Text("Send money across the globe. For free.")
                    .font(TaliseFont.display(36, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                    .lineLimit(3)
                Text("One Google account. One Sui address. No seed phrase, no setup. You sign with Face ID; we never see your keys.")
                    .font(TaliseFont.body(14))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .padding(.bottom, 12)
                Spacer()
                if let error {
                    Text(error)
                        .font(TaliseFont.body(12))
                        .foregroundStyle(TaliseColor.danger)
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
                Text("By continuing you agree to our Terms and Privacy.")
                    .font(TaliseFont.body(11))
                    .foregroundStyle(TaliseColor.fgDim)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.bottom, 12)
            }
            .padding(.horizontal, 24)
        }
    }

    private func beginSignIn() async {
        signingIn = true
        defer { signingIn = false }
        do {
            let pubKey = try EphemeralKeyStore.shared.publicKeyRawBytes()
            let nonce = UUID().uuidString
            let result = try await googleSignIn.signIn(
                nonce: nonce,
                ephemeralPubKeyB64: pubKey.base64EncodedString()
            )
            await session.handleSignInSuccess(
                bearer: result.bearer,
                userId: result.userId
            )
        } catch GoogleSignInService.SignInError.cancelled {
            // user backed out — no error
        } catch {
            self.error = error.localizedDescription
        }
    }
}
