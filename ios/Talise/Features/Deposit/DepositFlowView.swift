import SwiftUI

/// Top-level Deposit flow. Replaces the old direct-to-Receive sheet
/// the `+` button used to open. Now lands on a full-page options
/// screen with two paths:
///
///   - Deposit into account → fiat onramp (Stripe). The backend route
///     `/api/onramp/session` is wired; iOS embedded SDK integration
///     is a separate scope, so we currently surface a "Coming soon"
///     stub linking to the address as a workaround.
///   - Onchain Deposit → embeds the existing `ReceiveView` (QR + Sui
///     address) as a pushed page, not a sheet.
///
/// The whole flow lives inside its own `NavigationStack` so sub-pages
/// PUSH (slide from the trailing edge) instead of slide up — matching
/// the user's request that "those pages should be whole pages, not
/// slide ups."
struct DepositFlowView: View {
    var onClose: () -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                inlineHeader
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        NavigationLink {
                            DepositOnrampView()
                        } label: {
                            OptionCardRow(
                                icon: "creditcard.fill",
                                title: "Deposit into account",
                                subtitle: "Fund your wallet with your bank card or transfer.",
                                badge: nil
                            )
                        }
                        .buttonStyle(.plain)

                        NavigationLink {
                            DepositOnchainView()
                        } label: {
                            OptionCardRow(
                                icon: "qrcode",
                                title: "Onchain Deposit",
                                subtitle: "Get paid in USDsui via your Talise QR or address.",
                                badge: "No fee"
                            )
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 4)
                }
            }
            .background(TaliseColor.bg.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
        }
        .tint(TaliseColor.fg)
    }

    /// Inline page title — Talise heading font, medium weight, 26pt.
    /// Replaces the system large-title which read as too heavy / too
    /// large against the rest of the surface.
    private var inlineHeader: some View {
        HStack(alignment: .center) {
            Text("Deposit")
                .font(TaliseFont.heading(26, weight: .medium))
                .kerning(-0.6)
                .foregroundStyle(TaliseColor.fg)
            Spacer()
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(TaliseColor.surfaceGlass))
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 14)
    }
}

/// "Deposit into account" landing — fiat onramp via Stripe. The
/// backend session endpoint is ready (`/api/onramp/session`) but the
/// iOS-side embedded-SDK integration isn't wired yet. Until it is,
/// this page tells the user clearly what's coming and points them at
/// the Onchain path as the working alternative.
private struct DepositOnrampView: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                ZStack {
                    Circle()
                        .fill(TaliseColor.accent.opacity(0.15))
                        .frame(width: 72, height: 72)
                    Image(systemName: "creditcard.fill")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(TaliseColor.accent)
                }
                .padding(.top, 24)

                VStack(spacing: 8) {
                    Text("Card & bank deposits coming soon")
                        .font(TaliseFont.heading(20, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                        .multilineTextAlignment(.center)
                    Text("We're wiring up direct card and bank top-ups. In the meantime, use Onchain Deposit to receive USDsui from any wallet.")
                        .font(TaliseFont.body(13, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }

                Spacer(minLength: 16)
            }
            .frame(maxWidth: .infinity)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .navigationTitle("Deposit into account")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(TaliseColor.bg, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

/// "Onchain Deposit" landing — full page (not a sheet) showing the
/// user's QR code + Sui address + handle. Reuses the existing
/// `ReceiveView` body so we don't fork the QR rendering / share /
/// copy logic.
private struct DepositOnchainView: View {
    var body: some View {
        ReceiveView()
            .navigationTitle("Onchain Deposit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(TaliseColor.bg, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
    }
}
