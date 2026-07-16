import SwiftUI
import UIKit
import LocalAuthentication

/// Full-screen PIN unlock shown when a signed-in user returns to the app (or
/// relaunches) and the ~3-day session is still valid. A correct PIN unlocks the
/// existing session — no Google/Apple round-trip. Face ID / Touch ID can unlock
/// too. "Sign in another way" clears the session and returns to Google/Apple
/// (the only way past a forgotten PIN, since the PIN can't be recovered).
struct PinUnlockView: View {
    @Environment(AppSession.self) private var session

    @State private var entry: String = ""
    @State private var shakeTrigger: Int = 0
    @State private var failed = false
    @State private var biometricsAvailable = false

    private let pinLength = 4

    private var user: UserDTO? { session.lockedUser }

    var body: some View {
        ZStack {
            TaliseColor.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                Spacer(minLength: 24)
                header
                Spacer(minLength: 28)
                pinDots
                    .modifier(ShakeEffect(animatableData: CGFloat(shakeTrigger)))
                if failed {
                    Text("Incorrect PIN")
                        .font(TaliseFont.body(13, weight: .light))
                        .foregroundStyle(TaliseColor.danger)
                        .padding(.top, 14)
                }
                Spacer(minLength: 28)
                numpad
                    .padding(.horizontal, 28)
                footer
                    .padding(.top, 10)
                    .padding(.bottom, 8)
            }
            .padding(.horizontal, 8)
        }
        .task {
            biometricsAvailable = LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
            await tryBiometric()
        }
    }

    // MARK: - Pieces

    private var header: some View {
        VStack(spacing: 14) {
            avatar
            Text("Welcome back")
                .font(TaliseFont.heading(22))
                .foregroundStyle(TaliseColor.fg)
            Text(subtitle)
                .font(TaliseFont.body(14, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
        }
    }

    private var subtitle: String {
        if let name = user?.name?.split(separator: " ").first.map(String.init), !name.isEmpty {
            return "Enter your PIN, \(name)"
        }
        return "Enter your PIN to continue"
    }

    @ViewBuilder private var avatar: some View {
        let initial = String((user?.name?.trimmingCharacters(in: .whitespaces).first).map(String.init) ?? "T").uppercased()
        ZStack {
            Circle().fill(TaliseColor.surface2).frame(width: 72, height: 72)
            if let pic = user?.picture, let url = URL(string: pic) {
                AsyncImage(url: url) { img in
                    img.resizable().scaledToFill()
                } placeholder: { Text(initial).font(TaliseFont.heading(26)).foregroundStyle(TaliseColor.fg) }
                .frame(width: 72, height: 72).clipShape(Circle())
            } else {
                Text(initial).font(TaliseFont.heading(26)).foregroundStyle(TaliseColor.fg)
            }
        }
    }

    private var pinDots: some View {
        HStack(spacing: 24) {
            ForEach(0..<pinLength, id: \.self) { idx in
                let filled = idx < entry.count
                Circle()
                    .strokeBorder(filled ? Color.clear : TaliseColor.fgDim, lineWidth: 1.2)
                    .background(Circle().fill(filled ? TaliseColor.fg : Color.clear))
                    .frame(width: 15, height: 15)
                    .scaleEffect(filled ? 1.0 : 0.9)
                    .animation(.spring(response: 0.22, dampingFraction: 0.7), value: entry)
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
        return VStack(spacing: 6) {
            ForEach(rows.indices, id: \.self) { r in
                HStack(spacing: 0) {
                    ForEach(rows[r].indices, id: \.self) { c in key(rows[r][c]) }
                }
            }
        }
    }

    @ViewBuilder private func key(_ k: Key) -> some View {
        switch k {
        case .d(let d):
            Button { tap(d) } label: {
                Text(d).font(.system(size: 32, weight: .regular, design: .rounded))
                    .foregroundStyle(TaliseColor.fg)
                    .frame(maxWidth: .infinity).frame(height: 64).contentShape(Rectangle())
            }.buttonStyle(.plain)
        case .delete:
            Button { if !entry.isEmpty { entry.removeLast() } } label: {
                Image(systemName: "delete.left").font(.system(size: 22))
                    .foregroundStyle(TaliseColor.fg)
                    .frame(maxWidth: .infinity).frame(height: 64).contentShape(Rectangle())
            }.buttonStyle(.plain)
        case .bio:
            Button { Task { await tryBiometric() } } label: {
                Image(systemName: "faceid").font(.system(size: 26))
                    .foregroundStyle(TaliseColor.fg)
                    .frame(maxWidth: .infinity).frame(height: 64).contentShape(Rectangle())
            }.buttonStyle(.plain)
        case .blank:
            Color.clear.frame(maxWidth: .infinity).frame(height: 64)
        }
    }

    private var footer: some View {
        Button {
            session.signOut()
        } label: {
            Text("Sign in another way")
                .font(TaliseFont.body(14, weight: .medium))
                .foregroundStyle(TaliseColor.fgMuted)
        }
        .buttonStyle(.plain)
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
            withAnimation(.default) { shakeTrigger += 1 }
            entry = ""
        }
    }

    private func tryBiometric() async {
        guard biometricsAvailable, let _ = user?.id else { return }
        do {
            try await BiometricGate.shared.requireUserPresence(reason: "Unlock Talise")
            session.unlock()
        } catch {
            // Fall back to PIN entry — no error surfaced (user can just type it).
        }
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
