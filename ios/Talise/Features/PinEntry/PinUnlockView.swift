import SwiftUI
import UIKit
import LocalAuthentication

/// Full-screen PIN unlock shown when a signed-in user returns to the app (or
/// relaunches) and the ~3-day session is still valid. A correct PIN unlocks the
/// existing session — no Google/Apple round-trip. Face ID / Touch ID can unlock
/// too. A forgotten PIN can always fall back to a fresh sign-in (surfaced only
/// after a couple of misses, so the default screen stays clean).
struct PinUnlockView: View {
    @Environment(AppSession.self) private var session

    @State private var entry: String = ""
    @State private var shakeTrigger: Int = 0
    @State private var failed = false
    @State private var attempts = 0
    @State private var biometricsAvailable = false

    private let pinLength = 4

    private var user: UserDTO? { session.lockedUser }

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 44)
            header
            Spacer(minLength: 34)
            pinDots
                .modifier(ShakeEffect(animatableData: CGFloat(shakeTrigger)))
            Text("Incorrect PIN")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.danger)
                .opacity(failed ? 1 : 0)
                .padding(.top, 14)
            Spacer(minLength: 30)
            numpad
                .padding(.horizontal, 30)
            forgotLink
                .frame(height: 46)
        }
        .padding(.horizontal, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .taliseScreenBackground()
        .task {
            biometricsAvailable = LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
            await tryBiometric()
        }
    }

    // MARK: - Pieces

    private var header: some View {
        VStack(spacing: 10) {
            Text("Welcome back")
                .font(TaliseFont.heading(27))
                .foregroundStyle(TaliseColor.fg)
            Text(subtitle)
                .font(TaliseFont.body(15, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
        }
        .multilineTextAlignment(.center)
    }

    private var subtitle: String {
        if let name = user?.name?.split(separator: " ").first.map(String.init), !name.isEmpty {
            return "Enter your PIN, \(name)"
        }
        return "Enter your PIN to continue"
    }

    private var pinDots: some View {
        HStack(spacing: 26) {
            ForEach(0..<pinLength, id: \.self) { idx in
                let filled = idx < entry.count
                Circle()
                    .strokeBorder(filled ? Color.clear : TaliseColor.fgDim, lineWidth: 1.4)
                    .background(Circle().fill(filled ? TaliseColor.greenMint : Color.clear))
                    .frame(width: 16, height: 16)
                    .scaleEffect(filled ? 1.0 : 0.85)
                    .animation(.spring(response: 0.24, dampingFraction: 0.7), value: entry)
            }
        }
    }

    private var numpad: some View {
        let rows: [[Key]] = [
            [.d("1"), .d("2"), .d("3")],
            [.d("4"), .d("5"), .d("6")],
            [.d("7"), .d("8"), .d("9")],
            [biometricsAvailable ? .bio : .blank, .d("0"), .delete],
        ]
        return VStack(spacing: 10) {
            ForEach(rows.indices, id: \.self) { r in
                HStack(spacing: 10) {
                    ForEach(rows[r].indices, id: \.self) { c in key(rows[r][c]) }
                }
            }
        }
    }

    @ViewBuilder private func key(_ k: Key) -> some View {
        switch k {
        case .d(let d):
            Button { tap(d) } label: {
                Text(d)
                    .font(.system(size: 30, weight: .regular, design: .rounded))
                    .foregroundStyle(TaliseColor.fg)
                    .frame(maxWidth: .infinity)
                    .frame(height: 68)
                    .contentShape(Rectangle())
            }
            .buttonStyle(KeyStyle())
        case .delete:
            Button { if !entry.isEmpty { entry.removeLast() } } label: {
                Image(systemName: "delete.left")
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .frame(maxWidth: .infinity).frame(height: 68).contentShape(Rectangle())
            }.buttonStyle(.plain)
        case .bio:
            Button { Task { await tryBiometric() } } label: {
                Image(systemName: "faceid")
                    .font(.system(size: 25))
                    .foregroundStyle(TaliseColor.greenMint)
                    .frame(maxWidth: .infinity).frame(height: 68).contentShape(Rectangle())
            }.buttonStyle(.plain)
        case .blank:
            Color.clear.frame(maxWidth: .infinity).frame(height: 68)
        }
    }

    @ViewBuilder private var forgotLink: some View {
        if attempts >= 2 {
            Button { session.signOut() } label: {
                Text("Forgot PIN? Sign in again")
                    .font(TaliseFont.body(14, weight: .medium))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
            .buttonStyle(.plain)
            .transition(.opacity)
        }
    }

    private enum Key { case d(String), delete, bio, blank }

    // MARK: - Handlers

    private func tap(_ d: String) {
        guard entry.count < pinLength else { return }
        failed = false
        entry.append(d)
        if entry.count == pinLength { verify() }
    }

    private func verify() {
        guard let uid = user?.id else { session.signOut(); return }
        if PinService.shared.verifyPin(entry, userId: uid) {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            session.unlock()
        } else {
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            failed = true
            withAnimation(.default) { attempts += 1; shakeTrigger += 1 }
            entry = ""
        }
    }

    private func tryBiometric() async {
        guard biometricsAvailable, user?.id != nil else { return }
        do {
            try await BiometricGate.shared.requireUserPresence(reason: "Unlock Talise")
            session.unlock()
        } catch {
            // Fall back to PIN entry — no error surfaced (user can just type it).
        }
    }
}

/// Subtle press feedback for numpad keys — a quiet circular highlight.
private struct KeyStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                Circle()
                    .fill(TaliseColor.surface2)
                    .opacity(configuration.isPressed ? 0.9 : 0)
                    .frame(width: 68, height: 68)
            )
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// Horizontal shake for a wrong PIN.
private struct ShakeEffect: GeometryEffect {
    var animatableData: CGFloat
    func effectValue(size: CGSize) -> ProjectionTransform {
        let dx = sin(animatableData * .pi * 6) * 9
        return ProjectionTransform(CGAffineTransform(translationX: dx, y: 0))
    }
}
