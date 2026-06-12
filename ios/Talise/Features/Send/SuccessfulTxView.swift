import SwiftUI
import UIKit

/// Full-screen "Transaction Successful!" celebration shown after a
/// payment lands. Implements Figma node 141:18 — dark theme: black field
/// with a soft green glow, a half-toned coin stack that drops in
/// scrapbook-style, a large light-green amount, a "Transaction
/// Successful!" line, a one-line mono "gas cost = 0, money arrives < 1s"
/// reassurance, and a Share Receipt + Done button row.
///
/// `amountText` is pre-formatted in the user's display currency by the
/// caller via `TaliseFormat.local2`, e.g. "$65.00".
///
/// Design tokens (Figma get_design_context, node 141:18):
///   bg              flat black (glow blob retired with glassmorphism)
///   amount          DM Sans 75 / regular / #B1F49A / tracking -1.5
///   title           DM Sans 25 / medium / #B1F49A / tracking -0.5
///   subtitle        JetBrains Mono 13 / regular / white / tracking -0.26
///   Share Receipt   white @ 20% pill, 158×41, text white
///   Done            white pill, 92×41, text black
struct SuccessfulTxView: View {
    /// Pre-formatted, currency-aware amount, e.g. "$65.00".
    let amountText: String
    /// Headline line. Defaults to the wallet-to-wallet "Transaction
    /// Successful!"; cross-border fiat-payout sends override it with
    /// chain-final-but-not-yet-delivered copy ("Sent to @kenji").
    var title: String = "Transaction Successful!"
    /// One-line reassurance under the title. Defaults to the gasless
    /// wallet-to-wallet line; cross-border sends override it with the
    /// bank-arrival timeline ("On its way to their bank").
    var subtitle: String = "gas cost = 0, money arrives < 1s"
    var onShareReceipt: (() -> Void)? = nil
    let onDone: () -> Void
    /// Pre-formatted Round-up & Save amount (e.g. "₦120.00") auto-saved
    /// alongside this payment. Nil/empty → no pop. When set, a piggy
    /// chip springs up under the subtitle a beat after the celebration
    /// lands, so Spend + Save users SEE the save happen.
    var savedText: String? = nil

    private let mintGreen = Color(hex: 0xB1F49A)
    @State private var showSavedPop = false

    var body: some View {
        ZStack {
            // Flat black canvas — the radial green glow + blur bloom was
            // retired with the rest of the glassmorphism.
            TaliseColor.bg.ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                // Coin stack drops in with the paper-placement wobble,
                // tilted the opposite way from the savings piggy so the
                // two screens feel hand-placed rather than templated.
                Image("SuccessCoins")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 360, height: 282)
                    .scrapbookEntry(delay: 0.05, tilt: 6)

                Spacer().frame(height: 24)

                Text(amountText)
                    .font(TaliseFont.heading(75, weight: .regular))
                    .kerning(-1.5)
                    .foregroundStyle(mintGreen)
                    .multilineTextAlignment(.center)
                    .minimumScaleFactor(0.4)
                    .lineLimit(1)
                    .padding(.horizontal, 20)
                    .scrapbookFadeUp(delay: 0.20)

                Text(title)
                    .font(TaliseFont.heading(25, weight: .medium))
                    .kerning(-0.5)
                    .foregroundStyle(mintGreen)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 20)
                    .padding(.top, 18)
                    .scrapbookFadeUp(delay: 0.28)

                Text(subtitle)
                    .font(TaliseFont.mono(13, weight: .regular))
                    .kerning(-0.26)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .scrapbookFadeUp(delay: 0.34)

                // Spend + Save pop — the auto-saved slice, springing up a
                // beat after the celebration so the save reads as its own
                // moment. Piggy + amount in a quiet pill; no claims, just
                // the fact.
                if let savedText, !savedText.isEmpty {
                    HStack(spacing: 10) {
                        Image("SavingsPiggy")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 30, height: 30)
                        Text("Saved \(savedText)")
                            .font(TaliseFont.body(14, weight: .medium))
                            .kerning(-0.3)
                            .foregroundStyle(mintGreen)
                        Text("· Spend + Save")
                            .font(TaliseFont.mono(11, weight: .regular))
                            .foregroundStyle(TaliseColor.fgDim)
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(Capsule().fill(mintGreen.opacity(0.12)))
                    .overlay(Capsule().strokeBorder(mintGreen.opacity(0.25), lineWidth: 1))
                    .padding(.top, 18)
                    .scaleEffect(showSavedPop ? 1 : 0.6)
                    .opacity(showSavedPop ? 1 : 0)
                    .onAppear {
                        withAnimation(.spring(response: 0.45, dampingFraction: 0.62).delay(0.7)) {
                            showSavedPop = true
                        }
                        // A soft success tick when the pop lands.
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.75) {
                            UIImpactFeedbackGenerator(style: .soft).impactOccurred()
                        }
                    }
                }

                Spacer()

                HStack(spacing: 13) {
                    Button(action: { onShareReceipt?() }) {
                        HStack(spacing: 6) {
                            Text("Share Receipt")
                            Image(systemName: "square.and.arrow.up")
                                .font(.system(size: 12, weight: .medium))
                        }
                        .font(TaliseFont.body(15, weight: .medium))
                        .kerning(-0.3)
                        .foregroundStyle(.white)
                        .frame(width: 158, height: 41)
                        .background(Capsule().fill(TaliseColor.surface2))
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)

                    Button(action: onDone) {
                        Text("Done")
                            .font(TaliseFont.body(15, weight: .medium))
                            .kerning(-0.3)
                            .foregroundStyle(.black)
                            .frame(width: 92, height: 41)
                            .background(Capsule().fill(.white))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.bottom, 40)
                .scrapbookFadeUp(delay: 0.40)
            }
        }
        .preferredColorScheme(.dark)
    }
}
