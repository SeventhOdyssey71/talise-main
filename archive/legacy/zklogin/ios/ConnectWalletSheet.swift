import SwiftUI

/// The only sign-in path Cible exposes: Google → zkLogin.
///
/// Paste-address, QR scan, and "install Slush/Suiet" flows were removed
/// — the bridge + zkLogin combo gives every user a Sui wallet in one tap
/// with no seed phrase to manage, so the alternatives are unnecessary.
struct ConnectWalletSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var wallet: WalletService
    @StateObject private var zkLogin = ZkLoginService.shared

    @State private var localError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Capsule()
                .fill(Color.fg3.opacity(0.4))
                .frame(width: 36, height: 4)
                .frame(maxWidth: .infinity)
                .padding(.top, 8)

            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text("Sign in")
                    .font(Typography.title)
                    .foregroundStyle(Color.fg)
                Text("One tap with Google. No seed phrase. No app to install.")
                    .font(Typography.body)
                    .foregroundStyle(Color.fg2)
            }
            .padding(.horizontal, Spacing.lg)

            VStack(alignment: .leading, spacing: Spacing.md) {
                BulletRow(text: "Your wallet is derived from your Google account via Sui zkLogin.")
                BulletRow(text: "Cible never sees your password or private keys.")
                BulletRow(text: "Sign out anytime in Settings to clear the local session.")
            }
            .padding(.horizontal, Spacing.lg)

            Spacer(minLength: 0)

            VStack(spacing: Spacing.md) {
                googleSignInButton
                if let msg = displayError {
                    Text(msg)
                        .font(Typography.caption)
                        .foregroundStyle(Color.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Text("By signing in you accept the Terms of Use and Privacy Policy.")
                    .font(.caption2)
                    .foregroundStyle(Color.fg3)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.lg)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.bg.ignoresSafeArea())
        .presentationDetents([.medium, .large])
        .onChange(of: zkLogin.status) { newStatus in
            handleStatus(newStatus)
        }
    }

    private var googleSignInButton: some View {
        Button {
            localError = nil
            zkLogin.signInWithGoogle()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "g.circle.fill")
                    .font(.system(size: 18, weight: .bold))
                Text(buttonTitle)
                    .font(.system(size: 15, weight: .semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Color.fg)
            .foregroundStyle(Color.bg)
            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
        }
        .disabled(buttonDisabled)
        .opacity(buttonDisabled ? 0.5 : 1)
        .accessibilityIdentifier("wallet.zkLogin.google")
        .accessibilityHint("Signs you in with Google via Sui zkLogin")
    }

    private var buttonTitle: String {
        switch zkLogin.status {
        case .signingIn: return "Signing in…"
        case .ready: return "Signed in. Tap to continue"
        case .failed: return "Try Google sign-in again"
        case .idle: return "Sign in with Google"
        }
    }

    private var buttonDisabled: Bool {
        if case .signingIn = zkLogin.status { return true }
        return false
    }

    private var displayError: String? {
        if let local = localError { return local }
        if case let .failed(msg) = zkLogin.status { return msg }
        return nil
    }

    private func handleStatus(_ status: ZkLoginService.Status) {
        switch status {
        case .ready(let suiAddress):
            Task {
                await wallet.connect(address: suiAddress)
                dismiss()
            }
        case .failed(let msg):
            localError = msg
        default:
            break
        }
    }
}

private struct BulletRow: View {
    let text: String
    var body: some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.accent)
                .padding(.top, 2)
            Text(text)
                .font(Typography.body)
                .foregroundStyle(Color.fg2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
