import SwiftUI
import UIKit

/// Set or change the device PIN from Settings. If a PIN already exists the user
/// must enter the current one first; then they pick a new 4-digit PIN and
/// confirm it. Writes through `PinService` (Keychain, per-user salted hash).
struct ChangePinView: View {
    let userId: String
    let onDone: () -> Void

    private enum Step { case verifyCurrent, enterNew, confirmNew }
    @State private var step: Step
    @State private var entry: String = ""
    @State private var firstNew: String?
    @State private var shakeTrigger = 0
    @State private var errorMessage: String?

    private let pinLength = 4

    init(userId: String, onDone: @escaping () -> Void) {
        self.userId = userId
        self.onDone = onDone
        _step = State(initialValue: PinService.shared.hasPin(userId: userId) ? .verifyCurrent : .enterNew)
    }

    var body: some View {
        ZStack {
            TaliseColor.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                header
                    .padding(.top, 28)
                Spacer(minLength: 24)
                pinDots.modifier(ShakePin(animatableData: CGFloat(shakeTrigger)))
                if let errorMessage {
                    Text(errorMessage)
                        .font(TaliseFont.body(13, weight: .light))
                        .foregroundStyle(TaliseColor.danger)
                        .padding(.top, 14)
                }
                Spacer(minLength: 24)
                numpad.padding(.horizontal, 28)
                Button { onDone() } label: {
                    Text("Cancel")
                        .font(TaliseFont.body(14, weight: .medium))
                        .foregroundStyle(TaliseColor.fgMuted)
                }
                .buttonStyle(.plain)
                .padding(.top, 10)
                .padding(.bottom, 12)
            }
            .padding(.horizontal, 8)
        }
    }

    private var header: some View {
        VStack(spacing: 8) {
            Text(title).font(TaliseFont.heading(22)).foregroundStyle(TaliseColor.fg)
            Text(subtitle).font(TaliseFont.body(14, weight: .light)).foregroundStyle(TaliseColor.fgMuted)
        }
        .multilineTextAlignment(.center)
    }

    private var title: String {
        switch step {
        case .verifyCurrent: return "Enter current PIN"
        case .enterNew:      return "Choose a new PIN"
        case .confirmNew:    return "Confirm your PIN"
        }
    }
    private var subtitle: String {
        switch step {
        case .verifyCurrent: return "Confirm it's you"
        case .enterNew:      return "Pick 4 digits you'll remember"
        case .confirmNew:    return "Enter the same 4 digits again"
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
        let rows: [[String]] = [["1","2","3"],["4","5","6"],["7","8","9"],["","0","⌫"]]
        return VStack(spacing: 6) {
            ForEach(rows.indices, id: \.self) { r in
                HStack(spacing: 0) {
                    ForEach(rows[r].indices, id: \.self) { c in keyView(rows[r][c]) }
                }
            }
        }
    }

    @ViewBuilder private func keyView(_ k: String) -> some View {
        if k.isEmpty {
            Color.clear.frame(maxWidth: .infinity).frame(height: 64)
        } else if k == "⌫" {
            Button { if !entry.isEmpty { entry.removeLast() } } label: {
                Image(systemName: "delete.left").font(.system(size: 22))
                    .foregroundStyle(TaliseColor.fg).frame(maxWidth: .infinity).frame(height: 64).contentShape(Rectangle())
            }.buttonStyle(.plain)
        } else {
            Button { tap(k) } label: {
                Text(k).font(.system(size: 32, weight: .regular, design: .rounded))
                    .foregroundStyle(TaliseColor.fg).frame(maxWidth: .infinity).frame(height: 64).contentShape(Rectangle())
            }.buttonStyle(.plain)
        }
    }

    private func tap(_ d: String) {
        guard entry.count < pinLength else { return }
        errorMessage = nil
        entry.append(d)
        if entry.count == pinLength { advance() }
    }

    private func advance() {
        switch step {
        case .verifyCurrent:
            if PinService.shared.verifyPin(entry, userId: userId) {
                entry = ""; step = .enterNew
            } else { fail("Incorrect PIN") }
        case .enterNew:
            firstNew = entry; entry = ""; step = .confirmNew
        case .confirmNew:
            if entry == firstNew {
                do {
                    try PinService.shared.setPin(entry, userId: userId)
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    onDone()
                } catch {
                    fail("Couldn't save PIN. Try again.")
                    step = .enterNew; firstNew = nil
                }
            } else {
                fail("PINs didn't match")
                step = .enterNew; firstNew = nil
            }
        }
    }

    private func fail(_ msg: String) {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
        errorMessage = msg
        withAnimation(.default) { shakeTrigger += 1 }
        entry = ""
    }
}

private struct ShakePin: GeometryEffect {
    var animatableData: CGFloat
    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: sin(animatableData * .pi * 6) * 9, y: 0))
    }
}
