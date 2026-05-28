import SwiftUI

/// Step 5: success. Animated checkmark, "Sent", short receipt blurb,
/// "Lands in about a second" reassurance, Done button that calls
/// onDone and lets the parent dismiss. Sui mainnet finality is ~0.4s
/// — anything longer in the copy is misleading.
struct SendCompleteView: View {
    @Bindable var draft: SendDraft
    var onDone: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: 22) {
                SendSuccessAnimation(size: 140)

                VStack(spacing: 8) {
                    Text("Sent")
                        .font(TaliseFont.heading(34, weight: .medium))
                        .kerning(-1)
                        .foregroundStyle(TaliseColor.fg)
                    Text("Lands in about a second.")
                        .font(TaliseFont.body(14, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted)
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, 32)

                receiptBlock
                    .padding(.horizontal, 32)
                    .padding(.top, 4)
            }

            Spacer()

            doneButton
                .padding(.horizontal, 24)
                .padding(.bottom, 18)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }

    @ViewBuilder
    private var receiptBlock: some View {
        if let s = draft.success {
            VStack(spacing: 6) {
                Text("\(s.currency.symbol)\(s.displayAmount) → \(s.recipientDisplay)")
                    .font(TaliseFont.body(14, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                MicroLabel(
                    text: String(s.digest.prefix(20)) + "…",
                    color: TaliseColor.fgDim
                )
                .kerning(0.5)
            }
        } else if let err = draft.errorMessage {
            Text(err)
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.danger)
                .multilineTextAlignment(.center)
        }
    }

    private var doneButton: some View {
        Button(action: onDone) {
            Text("Done")
                .font(TaliseFont.heading(16, weight: .medium))
                .foregroundStyle(TaliseColor.bg)
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .background(TaliseColor.fg)
                .clipShape(Capsule())
        }
    }
}
