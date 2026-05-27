import SwiftUI

/// Bottom-sheet PIN entry. Hosted once at the app root via
/// `PinGateHost` (see `PinGate.swift`); any call site asks for entry via
/// `PinGate.shared.requireUserPresence(reason:userId:)`.
///
/// The sheet handles two modes:
///   - `.create`: prompt for 4 digits, then prompt again to confirm.
///     Matching pair → write to Keychain via `PinService` → resolve.
///   - `.verify`: prompt for 4 digits, compare against the stored hash.
///     Wrong PIN shakes + clears; "Forgot PIN" resolves with a sign-out.
struct PinEntrySheet: View {
    let request: PinGate.ActiveRequest

    @State private var entry: String = ""
    @State private var firstPin: String? = nil  // .create: holds the first attempt
    @State private var shakeTrigger: Int = 0
    @State private var failureMessage: String? = nil

    private let pinLength = 4

    var body: some View {
        VStack(spacing: 0) {
            iconBadge
                .padding(.top, 12)
            Text(titleText)
                .font(TaliseFont.heading(22, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
                .padding(.top, 16)
            Text(subtitleText)
                .font(TaliseFont.body(13))
                .foregroundStyle(TaliseColor.fgMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 6)

            pinBoxes
                .padding(.top, 22)
                .modifier(ShakeEffect(trigger: shakeTrigger))

            if let msg = failureMessage {
                Text(msg)
                    .font(TaliseFont.body(12))
                    .foregroundStyle(TaliseColor.danger)
                    .padding(.top, 8)
            } else {
                Spacer().frame(height: 24)
            }

            Spacer(minLength: 0)

            numpad
                .padding(.horizontal, 28)
                .padding(.bottom, 8)

            if request.mode == .verify {
                Button(action: request.onForgot) {
                    Text("Forgot PIN?")
                        .font(TaliseFont.body(13, weight: .medium))
                        .foregroundStyle(TaliseColor.fgSubtle)
                        .underline()
                        .padding(.vertical, 10)
                }
                .padding(.bottom, 4)
            }
        }
        .frame(maxWidth: .infinity)
        .background(TaliseColor.bg.ignoresSafeArea())
    }

    // MARK: - Header

    private var iconBadge: some View {
        ZStack {
            Circle()
                .fill(TaliseColor.accent.opacity(0.18))
                .frame(width: 56, height: 56)
            Image(systemName: "lock.fill")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(TaliseColor.accent)
        }
    }

    private var titleText: String {
        switch request.mode {
        case .verify:
            return "Enter PIN to confirm"
        case .create:
            return firstPin == nil ? "Create your PIN" : "Confirm your PIN"
        }
    }

    private var subtitleText: String {
        switch request.mode {
        case .verify:
            return request.reason
        case .create:
            return firstPin == nil
                ? "Set a 4-digit PIN. You'll use it to confirm every transaction."
                : "Re-enter the PIN to confirm."
        }
    }

    // MARK: - PIN dots

    private var pinBoxes: some View {
        HStack(spacing: 14) {
            ForEach(0..<pinLength, id: \.self) { idx in
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(TaliseColor.line, lineWidth: 1)
                        .background(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(TaliseColor.surface)
                        )
                        .frame(width: 56, height: 56)
                    if idx < entry.count {
                        Circle()
                            .fill(TaliseColor.fg)
                            .frame(width: 14, height: 14)
                            .transition(.scale.combined(with: .opacity))
                    }
                }
            }
        }
        .animation(.spring(response: 0.25, dampingFraction: 0.7), value: entry)
    }

    // MARK: - Numpad

    private var numpad: some View {
        let rows: [[NumpadKey]] = [
            [.digit("1"), .digit("2"), .digit("3")],
            [.digit("4"), .digit("5"), .digit("6")],
            [.digit("7"), .digit("8"), .digit("9")],
            [.blank,      .digit("0"), .delete],
        ]
        return VStack(spacing: 10) {
            ForEach(rows.indices, id: \.self) { r in
                HStack(spacing: 10) {
                    ForEach(rows[r].indices, id: \.self) { c in
                        keyView(rows[r][c])
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func keyView(_ key: NumpadKey) -> some View {
        switch key {
        case .digit(let d):
            Button { tapDigit(d) } label: {
                Text(d)
                    .font(TaliseFont.heading(26, weight: .regular))
                    .foregroundStyle(TaliseColor.fg)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(TaliseColor.surface.opacity(0.6))
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
        case .delete:
            Button { tapDelete() } label: {
                Image(systemName: "delete.left")
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(TaliseColor.fg)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(Color.clear)
            }
            .buttonStyle(.plain)
        case .blank:
            Color.clear.frame(maxWidth: .infinity).frame(height: 56)
        }
    }

    private enum NumpadKey {
        case digit(String)
        case delete
        case blank
    }

    // MARK: - Handlers

    private func tapDigit(_ d: String) {
        guard entry.count < pinLength else { return }
        failureMessage = nil
        entry.append(d)
        if entry.count == pinLength {
            // Defer one runloop tick so the final dot animates in before
            // the sheet either dismisses or transitions to "confirm".
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 120_000_000)
                completeAttempt()
            }
        }
    }

    private func tapDelete() {
        guard !entry.isEmpty else { return }
        entry.removeLast()
        failureMessage = nil
    }

    private func completeAttempt() {
        let pin = entry
        switch request.mode {
        case .verify:
            if PinService.shared.verifyPin(pin, userId: request.userId) {
                request.onSuccess()
            } else {
                failVerify()
            }
        case .create:
            if let first = firstPin {
                if first == pin {
                    do {
                        try PinService.shared.setPin(pin, userId: request.userId)
                        request.onSuccess()
                    } catch {
                        failureMessage = "Couldn't save PIN. Try again."
                        resetAll()
                    }
                } else {
                    failureMessage = "PINs didn't match. Try again."
                    shakeTrigger += 1
                    resetAll()
                }
            } else {
                firstPin = pin
                entry = ""
            }
        }
    }

    private func failVerify() {
        shakeTrigger += 1
        failureMessage = "Wrong PIN. Try again."
        entry = ""
    }

    private func resetAll() {
        entry = ""
        firstPin = nil
    }
}

/// Horizontal-shake modifier driven by an incrementing trigger. Wraps the
/// PIN-boxes whenever a verify fails or a confirm-step mismatches.
private struct ShakeEffect: ViewModifier {
    let trigger: Int
    @State private var offset: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .offset(x: offset)
            .onChange(of: trigger) { _, _ in
                let steps: [CGFloat] = [-10, 10, -8, 8, -4, 4, 0]
                Task { @MainActor in
                    for s in steps {
                        offset = s
                        try? await Task.sleep(nanoseconds: 50_000_000)
                    }
                }
            }
    }
}
