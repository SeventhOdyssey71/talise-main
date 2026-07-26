import SwiftUI

/// Notification count badge in the Talise mint — a soft "green light" on the
/// home logo when there's private balance to claim. Dark text on mint reads
/// cleanly against the green header.
struct ReceiveBadge: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(Color(hex: 0x123014))
            .padding(.horizontal, text.count > 1 ? 5 : 0)
            .frame(minWidth: 17, minHeight: 17)
            .background(Capsule().fill(TaliseColor.greenMint))
            .overlay(Capsule().stroke(Color(hex: 0x0E1A0C), lineWidth: 1.5))
            .shadow(color: TaliseColor.greenMint.opacity(0.55), radius: 4)
            .fixedSize()
    }
}

/// The RECEIVE side of private sends. A private payment lands as a shielded note
/// the recipient owns in the pool — it never moved their public balance. This
/// screen surfaces that claimable balance and sweeps it into the spendable
/// wallet in one confirm. Styled to match `TokenBucketView`.
struct PrivateInboxView: View {
    var onDone: () -> Void

    @Environment(ShieldInbox.self) private var inbox
    @Environment(AppSession.self) private var session

    /// Amount captured at sweep time (the live balance zeroes out after), so the
    /// success screen shows what was actually claimed.
    @State private var claimedText: String?
    @State private var errorText: String?
    @State private var resetSlider = false

    var body: some View {
        Group {
            if let claimedText {
                SuccessfulTxView(
                    amountText: claimedText,
                    title: "Added to your balance",
                    subtitle: "Your private funds are now spendable",
                    onDone: onDone
                )
            } else {
                claimScreen
            }
        }
    }

    private var claimScreen: some View {
        VStack(spacing: 0) {
            header
            ScrollView(showsIndicators: false) {
                VStack(spacing: 22) {
                    hero
                    explainer
                    if let errorText {
                        Text(errorText)
                            .font(TaliseFont.body(13))
                            .foregroundStyle(TaliseColor.fgMuted)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                    }
                    Color.clear.frame(height: 8)
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
            }
            Spacer(minLength: 0)
            footer
        }
        .taliseScreenBackground()
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Button { onDone() } label: {
                Text("Done")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
            Spacer()
            HStack(spacing: 6) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(TaliseColor.greenMint)
                MicroLabel(text: "Private balance", color: TaliseColor.fgMuted)
            }
            Spacer()
            // Balancing spacer so the label stays centred.
            Text("Done").font(.system(size: 15, weight: .semibold)).foregroundStyle(.clear)
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 8)
    }

    // MARK: - Hero

    private var hero: some View {
        VStack(spacing: 8) {
            Image(systemName: "lock.circle.fill")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(TaliseColor.greenMint)
                .padding(.bottom, 2)
            Text(TaliseFormat.local2(inbox.pendingUsd))
                .font(TaliseFont.display(52, weight: .medium)).kerning(-1)
                .foregroundStyle(TaliseColor.fg)
            Text("Waiting in your shielded pool")
                .font(TaliseFont.mono(11, weight: .regular)).tracking(1.0)
                .foregroundStyle(TaliseColor.fgMuted)
            if inbox.pendingCount > 0 {
                Text(inbox.pendingCount == 1 ? "1 private receipt" : "\(inbox.pendingCount) private receipts")
                    .font(TaliseFont.body(13))
                    .foregroundStyle(TaliseColor.fgDim)
                    .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
    }

    private var explainer: some View {
        Text("Someone paid you privately. Sweep it into your spendable balance.")
            .font(TaliseFont.body(14))
            .foregroundStyle(TaliseColor.fgMuted)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 24)
    }

    // MARK: - Footer / confirm

    private var footer: some View {
        VStack(spacing: 10) {
            SlideToConfirm(
                title: inbox.isSweeping ? "Sweeping in…" : "Slide to sweep in",
                tint: TaliseColor.greenMint,
                reset: $resetSlider
            ) {
                await sweep()
            }
            Text("Gasless · goes straight to your balance")
                .font(TaliseFont.mono(10, weight: .regular)).tracking(0.6)
                .foregroundStyle(TaliseColor.fgDim)
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 24)
    }

    // MARK: - Actions

    private func sweep() async {
        errorText = nil
        guard let addr = session.currentUser?.suiAddress, !addr.isEmpty else {
            errorText = "Couldn’t find your wallet address. Try again in a moment."
            resetSlider = true
            return
        }
        // Snapshot the amount before the sweep clears it, for the success screen.
        let amountText = TaliseFormat.local2(inbox.pendingUsd)
        do {
            _ = try await inbox.sweep(to: addr)
            claimedText = amountText
        } catch {
            errorText = "Couldn’t sweep just now. Your funds are safe, please try again."
            resetSlider = true
        }
    }
}
