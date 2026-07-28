import SwiftUI

/// Terminal failure step for the Send flow. Reached when sponsor-prepare,
/// sponsor-execute, or gasless-submit throws — including server 4xx
/// rejections like `ACCUMULATOR_UNDERFUNDED` and transport errors.
///
/// This screen is the deliberate replacement for the historical bug where
/// the green success checkmark rendered with an error string stacked
/// beneath it. The success screen is now gated on a non-empty digest;
/// every other outcome routes here.
struct SendFailureView: View {
    @Bindable var draft: SendDraft
    var onTryAgain: () -> Void
    var onDone: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: 22) {
                ZStack {
                    Circle()
                        .fill(TaliseColor.danger.opacity(0.15))
                        .frame(width: 96, height: 96)
                    Image(systemName: "exclamationmark")
                        .font(.system(size: 36, weight: .semibold))
                        .foregroundStyle(TaliseColor.danger)
                }

                VStack(spacing: 8) {
                    Text("Send failed")
                        .font(TaliseFont.heading(34, weight: .medium))
                        .kerning(-1)
                        .foregroundStyle(TaliseColor.fg)
                    // Deliberately does NOT assert "no funds moved". This screen
                    // is shown for any failure, including a transport timeout
                    // that can fire AFTER the transaction was broadcast — in
                    // which case the money did move, and telling the user
                    // otherwise invites them to send a second time.
                    Text("Check your activity before trying again — if the send went through, it will show there.")
                        .font(TaliseFont.body(14, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }

                if let err = draft.errorMessage, !err.isEmpty {
                    Text(err)
                        .font(TaliseFont.body(13, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                        .padding(.top, 4)
                }
            }

            Spacer()

            VStack(spacing: 10) {
                Button(action: onTryAgain) {
                    Text("Try again")
                        .font(TaliseFont.heading(16, weight: .medium))
                        .foregroundStyle(TaliseColor.bg)
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(TaliseColor.fg)
                        .clipShape(Capsule())
                }
                Button(action: onDone) {
                    Text("Done")
                        .font(TaliseFont.heading(16, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .glassCapsule()
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 18)
        }
        .taliseScreenBackground()
        .toolbar(.hidden, for: .navigationBar)
    }
}
