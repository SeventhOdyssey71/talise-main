import SwiftUI

/// Full-screen "You just saved …" celebration shown after a successful
/// NAVI supply (invest). Implements Figma node 130:2 ("Savings Pop Up")
/// verbatim — pastel-green field, half-toned piggy illustration,
/// localized amount, mono congratulations line, and a single "Back to
/// Invest" pill that dismisses.
///
/// The amount is the user's actual invested figure, formatted in their
/// display currency via the caller (EarnView passes a pre-formatted
/// string from `TaliseFormat.local2`), so a ₦ user sees "₦12,000.00"
/// and a $ user sees "$2.12" — the screenshot value.
///
/// Design tokens (from Figma get_design_context, node 130:2):
///   bg            #CAFFB8
///   amount        DM Sans 35 / regular / #4B8A37 / tracking -0.7
///   subtitle      JetBrains Mono 13 / regular / #6E9C5F / tracking -0.26
///   button        #4B8A37 pill, radius 30, 175×41
///   button text   DM Sans 15 / #B1F49A / tracking -0.3
struct SavingsSuccessView: View {
    /// Pre-formatted, currency-aware amount string, e.g. "$2.12" or
    /// "₦12,000.00". Rendered after the "You just saved " prefix.
    let amountText: String
    let onDismiss: () -> Void

    private let bg = Color(hex: 0xCAFFB8)
    private let deepGreen = Color(hex: 0x4B8A37)
    private let subtitleGreen = Color(hex: 0x6E9C5F)
    private let buttonText = Color(hex: 0xB1F49A)

    var body: some View {
        ZStack {
            bg.ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                // Half-toned piggy — sized to ~62% of width, matching
                // the Figma's 242pt illustration on a 402pt frame.
                Image("SavingsPiggy")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 240, height: 228)

                Spacer().frame(height: 36)

                Text("You just saved \(amountText)")
                    .font(TaliseFont.heading(35, weight: .regular))
                    .kerning(-0.7)
                    .foregroundStyle(deepGreen)
                    .multilineTextAlignment(.center)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .padding(.horizontal, 24)

                Text("Congratulations on taking this financial step! We getting rich step by step.")
                    .font(TaliseFont.mono(13, weight: .regular))
                    .kerning(-0.26)
                    .foregroundStyle(subtitleGreen)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(width: 310)
                    .padding(.top, 14)

                Spacer()

                Button(action: onDismiss) {
                    Text("Back to Invest")
                        .font(TaliseFont.body(15, weight: .medium))
                        .kerning(-0.3)
                        .foregroundStyle(buttonText)
                        .frame(width: 175, height: 41)
                        .background(
                            Capsule().fill(deepGreen)
                        )
                }
                .buttonStyle(.plain)
                .padding(.bottom, 40)
            }
        }
        .preferredColorScheme(.light)
    }
}
