import SwiftUI

/// Step 3: read-only confirm. Shows the from/to glass cards, the "no
/// network fee" footnote, and a Confirm button that kicks off the
/// sponsor-execute and advances to `SendInProgressView`.
struct SendReviewView: View {
    @Bindable var draft: SendDraft
    var onConfirm: () async -> Void
    var onBack: () -> Void

    @Environment(AppSession.self) private var session

    var body: some View {
        VStack(spacing: 0) {
            header

            ScrollView {
                VStack(spacing: 18) {
                    titleBlock
                        .padding(.top, 10)

                    fromCard
                    arrow
                    toCard

                    feeLine
                        .padding(.top, 4)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }

            confirmButton
                .padding(.horizontal, 24)
                .padding(.bottom, 18)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(TaliseColor.surfaceGlass))
            }
            Spacer()
            MicroLabel(text: "Review", color: TaliseColor.fgDim).kerning(1.5)
            Spacer()
            Color.clear.frame(width: 36, height: 36)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
    }

    // MARK: - Title

    private var titleBlock: some View {
        VStack(spacing: 6) {
            // Sui txs are public on chain — "privately" was misleading.
            // The honest framing is that gas is sponsored and the user's
            // wallet identity is the only thing visible. The receipt is
            // queryable but who's paying gas isn't.
            Text("Review send")
                .font(TaliseFont.heading(24, weight: .medium))
                .kerning(-0.5)
                .foregroundStyle(TaliseColor.fg)
            Text("Confirm the details. Settles on Sui in a few seconds.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - From card

    private var fromCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Eyebrow(text: "From \(myHandle)")
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(draft.currency.symbol)
                    .font(TaliseFont.heading(28, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                Text(displayAmount)
                    .font(TaliseFont.heading(40, weight: .medium))
                    .kerning(-1)
                    .foregroundStyle(TaliseColor.fg)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            Text(usdsuiEquivalent)
                .font(TaliseFont.mono(12, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .taliseGlass(cornerRadius: 22)
    }

    private var displayAmount: String {
        draft.rawAmount.isEmpty ? "0" : draft.rawAmount
    }

    private var usdsuiEquivalent: String {
        let fmt = NumberFormatter()
        fmt.numberStyle = .decimal
        fmt.minimumFractionDigits = 2
        fmt.maximumFractionDigits = 2
        let body = fmt.string(from: NSNumber(value: draft.amountUsdsui)) ?? "0.00"
        return "\(body) USDsui"
    }

    private var myHandle: String {
        switch session.phase {
        case .ready(let user), .onboarding(let user):
            return user.displayHandle() ?? "you"
        default:
            return "you"
        }
    }

    private var arrow: some View {
        Image(systemName: "arrow.down")
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(TaliseColor.fgMuted)
            .frame(width: 28, height: 28)
            .background(Circle().fill(TaliseColor.surfaceGlass))
    }

    // MARK: - To card

    private var toCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow(text: "To")
            Text(recipientPrimary)
                .font(TaliseFont.heading(20, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
                .lineLimit(1)
                .truncationMode(.middle)
            Text(recipientShortAddress)
                .font(TaliseFont.mono(11, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
            if let sends = draft.previousSendsToRecipient, sends > 0 {
                Text(sends == 1 ? "1 previous send" : "\(sends) previous sends")
                    .font(TaliseFont.mono(11, weight: .light))
                    .foregroundStyle(TaliseColor.accent)
                    .padding(.top, 2)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .taliseGlass(cornerRadius: 22)
    }

    private var recipientPrimary: String {
        if let r = draft.resolved,
           let name = r.displayName, !name.isEmpty, name != r.address {
            return name
        }
        return recipientShortAddress
    }

    private var recipientShortAddress: String {
        guard let r = draft.resolved else { return "—" }
        let a = r.address
        guard a.count > 14 else { return a }
        return String(a.prefix(8)) + "…" + String(a.suffix(6))
    }

    // MARK: - Fee line

    private var feeLine: some View {
        HStack(spacing: 6) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 11, weight: .regular))
                .foregroundStyle(TaliseColor.accent)
            Text("No network fee — sponsored by Talise.")
                .font(TaliseFont.mono(11, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    // MARK: - Confirm

    private var confirmButton: some View {
        Button {
            Task { await onConfirm() }
        } label: {
            Text("Confirm")
                .font(TaliseFont.heading(16, weight: .medium))
                .foregroundStyle(TaliseColor.bg)
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .background(TaliseColor.fg)
                .clipShape(Capsule())
        }
    }
}
