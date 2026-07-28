import SwiftUI
import UIKit

/// One-time PIN creation, shown right after a user's first sign-in on this
/// device (the `.pinSetup` phase). Two steps — create a 4-digit PIN, then
/// confirm it. Required, no skip; any later change happens in
/// Settings → Security (ChangePinView). Matches the unlock screen's look:
/// green top-glow background + brand-mint dots.
struct PinCreateView: View {
    let userId: String
    let onDone: () -> Void

    private enum Step { case create, confirm }
    @State private var step: Step = .create
    @State private var entry: String = ""
    @State private var firstPin: String?
    @State private var shakeTrigger = 0
    @State private var errorMessage: String?

    private let pinLength = 4

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 40)
            logo
            header.padding(.top, 22)
            Spacer(minLength: 32)
            pinDots.modifier(ShakePinCreate(animatableData: CGFloat(shakeTrigger)))
            Text(errorMessage ?? " ")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.danger)
                .opacity(errorMessage == nil ? 0 : 1)
                .padding(.top, 14)
            Spacer(minLength: 28)
            numpad.padding(.horizontal, 30)
            Color.clear.frame(height: 46)
        }
        .padding(.horizontal, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .taliseScreenBackground()
    }

    // MARK: - Pieces

    @ViewBuilder private var logo: some View {
        if UIImage(named: "TaliseLogo") != nil {
            Image("TaliseLogo")
                .resizable().scaledToFit()
                .frame(width: 44, height: 44)
                .foregroundStyle(TaliseColor.fg)
        } else {
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 38))
                .foregroundStyle(TaliseColor.greenMint)
        }
    }

    private var header: some View {
        VStack(spacing: 10) {
            Text(step == .create ? "Create a PIN" : "Confirm your PIN")
                .font(TaliseFont.heading(26))
                .foregroundStyle(TaliseColor.fg)
            Text(step == .create
                 ? "Set a 4-digit PIN to unlock Talise quickly."
                 : "Enter the same 4 digits again.")
                .font(TaliseFont.body(15, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, 32)
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
        let rows: [[String]] = [["1","2","3"],["4","5","6"],["7","8","9"],["","0","⌫"]]
        return VStack(spacing: 10) {
            ForEach(rows.indices, id: \.self) { r in
                HStack(spacing: 10) {
                    ForEach(rows[r].indices, id: \.self) { c in keyView(rows[r][c]) }
                }
            }
        }
    }

    @ViewBuilder private func keyView(_ k: String) -> some View {
        if k.isEmpty {
            Color.clear.frame(maxWidth: .infinity).frame(height: 68)
        } else if k == "⌫" {
            Button { if !entry.isEmpty { entry.removeLast() } } label: {
                Image(systemName: "delete.left").font(.system(size: 22))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .frame(maxWidth: .infinity).frame(height: 68).contentShape(Rectangle())
            }.buttonStyle(.plain)
        } else {
            Button { tap(k) } label: {
                Text(k).font(.system(size: 30, weight: .regular, design: .rounded))
                    .foregroundStyle(TaliseColor.fg)
                    .frame(maxWidth: .infinity).frame(height: 68).contentShape(Rectangle())
            }.buttonStyle(PinKeyStyle())
        }
    }

    // MARK: - Handlers

    private func tap(_ d: String) {
        guard entry.count < pinLength else { return }
        errorMessage = nil
        entry.append(d)
        if entry.count == pinLength { advance() }
    }

    private func advance() {
        switch step {
        case .create:
            firstPin = entry
            entry = ""
            step = .confirm
        case .confirm:
            if entry == firstPin {
                do {
                    try PinService.shared.setPin(entry, userId: userId)
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    onDone()
                } catch {
                    fail("Couldn't save PIN. Try again.")
                    step = .create; firstPin = nil
                }
            } else {
                fail("PINs didn't match — start again")
                step = .create; firstPin = nil
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

/// Quiet circular press highlight for numpad keys.
private struct PinKeyStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                Circle().fill(TaliseColor.surface2)
                    .opacity(configuration.isPressed ? 0.9 : 0)
                    .frame(width: 68, height: 68)
            )
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

private struct ShakePinCreate: GeometryEffect {
    var animatableData: CGFloat
    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: sin(animatableData * .pi * 6) * 9, y: 0))
    }
}
