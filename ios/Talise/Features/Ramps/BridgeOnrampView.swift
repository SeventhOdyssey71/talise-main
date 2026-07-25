import SwiftUI
import SafariServices

/// Bridge ADD-MONEY screen for a chosen corridor. Fetches the funding session
/// and renders one of:
///   • Verify-identity step (hosted Bridge KYC + ToS opened in Safari), or
///   • Bank deposit instructions (the virtual account to send fiat to), or
///   • a clean "not available yet" state when funding isn't switched on.
///
/// Funds land on the user's OWN Sui address as USDC (Bridge's Sui asset), so
/// when the server reports `requiresSwapToUsdsui` we say so plainly rather than
/// promising USDsui the user would then not find.
struct BridgeOnrampView: View {
    let corridor: RampCorridor

    @State private var session: OnrampSessionResponse?
    @State private var loading = true
    @State private var unavailable = false
    @State private var errorText: String?
    @State private var safariURL: URL?
    @State private var copied: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header

                if loading {
                    loadingCard
                } else if unavailable {
                    unavailableCard
                } else if let errorText {
                    messageCard(title: "Something went wrong", body: errorText)
                } else if session?.kycRequired == true {
                    verifyCard(kyc: session?.kycUrl, tos: session?.tosUrl)
                } else if let di = session?.depositInstructions {
                    depositCard(di)
                } else if let kyc = session?.kycUrl {
                    verifyCard(kyc: kyc, tos: session?.tosUrl)
                } else if session != nil {
                    // Enabled, verified, but the provider returned nothing we
                    // can act on. Say so honestly instead of a blank screen.
                    messageCard(
                        title: "Couldn't load your funding details",
                        body: "Nothing has been charged. Pull to try again in a moment."
                    )
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 28)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(item: $safariURL) { url in RampSafariView(url: url) }
        .overlay(alignment: .bottom) { copiedToast }
        .animation(.snappy(duration: 0.25), value: copied)
    }

    private var header: some View {
        HStack(spacing: 14) {
            RoundedFlag(code: corridor.code, size: 46)
            VStack(alignment: .leading, spacing: 3) {
                Text("Add money · \(corridor.name)")
                    .font(TaliseFont.heading(20, weight: .medium))
                    .kerning(-0.4)
                    .foregroundStyle(TaliseColor.fg)
                Text("Fund in \(corridor.currencyCode) — lands in your Talise wallet.")
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 4)
    }

    private var loadingCard: some View {
        HStack(spacing: 12) {
            ProgressView().tint(TaliseColor.greenMint)
            Text("Setting up your funding details…")
                .font(TaliseFont.body(14, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
            Spacer(minLength: 0)
        }
        .padding(18)
        .rampCard()
    }

    private var unavailableCard: some View {
        messageCard(
            title: "Not available just yet",
            body: "Bank funding for \(corridor.name) isn't switched on yet. In the meantime you can fund Talise by receiving dollars to your own address — go back and choose Crypto."
        )
    }

    /// Identity step. Bridge won't issue a funding account until KYC (and the
    /// ToS acceptance) clears, so this is a real next step, not an error.
    private func verifyCard(kyc: String?, tos: String?) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Verify your identity", systemImage: "checkmark.shield.fill")
                .font(TaliseFont.heading(16, weight: .semibold))
                .foregroundStyle(TaliseColor.fg)
            Text(session?.status == "pending"
                 ? "Your check is being reviewed by our banking partner. This usually takes a few minutes — we'll open your funding account as soon as it clears."
                 : "A quick, secure check (handled by our banking partner) before your bank funding goes live. Takes a couple of minutes.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
            if let kyc, let u = URL(string: kyc) {
                Button {
                    safariURL = u
                } label: {
                    Text("Continue")
                        .font(TaliseFont.body(15, weight: .semibold))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(Capsule().fill(TaliseColor.greenMint))
                }
                .buttonStyle(.plain)
            }
            if let tos, let u = URL(string: tos) {
                Button("Review and accept the terms") { safariURL = u }
                    .font(TaliseFont.body(13, weight: .regular))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
            Button("I've finished — check again") {
                Task { await load() }
            }
            .font(TaliseFont.body(13, weight: .regular))
            .foregroundStyle(TaliseColor.fgMuted)
        }
        .padding(18)
        .rampCard()
    }

    private func depositCard(_ di: BridgeDepositInstructions) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Send \(di.currency.uppercased()) to this account")
                .font(TaliseFont.heading(16, weight: .semibold))
                .foregroundStyle(TaliseColor.fg)
            Text("Transfer from your bank. This account is yours permanently — reuse it any time you top up.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 0) {
                if let v = di.beneficiaryName { copyRow("Beneficiary", v) }
                if let v = di.bankName { copyRow("Bank", v) }
                if let v = di.accountNumber { copyRow("Account number", v) }
                if let v = di.routingNumber { copyRow("Routing number", v) }
                if let v = di.iban { copyRow("IBAN", v) }
                if let v = di.bic { copyRow("BIC", v) }
                if let v = di.depositMessage { copyRow("Reference", v) }
            }
            .padding(.vertical, 4)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(TaliseColor.surface2.opacity(0.5))
            )

            if di.depositMessage != nil {
                Text("Include the reference exactly as shown, or your bank may not be able to match the deposit.")
                    .font(TaliseFont.body(12, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(session?.requiresSwapToUsdsui == false
                 ? "Funds arrive as USDsui in your wallet, usually within minutes."
                 : "Funds arrive on Sui as USDC, usually within minutes. One tap on your home screen converts them to USDsui — free.")
                .font(TaliseFont.body(12, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(18)
        .rampCard()
    }

    private func copyRow(_ label: String, _ value: String) -> some View {
        Button {
            UIPasteboard.general.string = value
            UISelectionFeedbackGenerator().selectionChanged()
            copied = label
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 1_600_000_000)
                copied = nil
            }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(label)
                        .font(TaliseFont.mono(10, weight: .regular))
                        .kerning(0.4)
                        .foregroundStyle(TaliseColor.fgDim)
                    Text(value)
                        .font(TaliseFont.body(15, weight: .regular))
                        .foregroundStyle(TaliseColor.fg)
                        .textSelection(.enabled)
                }
                Spacer(minLength: 8)
                Image(systemName: "doc.on.doc")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(TaliseColor.fgDim)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        }
        .buttonStyle(.plain)
    }

    private func messageCard(title: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(TaliseFont.heading(16, weight: .semibold))
                .foregroundStyle(TaliseColor.fg)
            Text(body)
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .rampCard()
    }

    @ViewBuilder private var copiedToast: some View {
        if let copied {
            Text("\(copied) copied")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fg)
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .background(Capsule().fill(TaliseColor.surface2))
                .padding(.bottom, 32)
                .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    private func load() async {
        loading = true
        errorText = nil
        unavailable = false
        defer { loading = false }
        do {
            // Amount is nominal — a virtual account accepts any deposit; the
            // route just requires a positive value. Currency = the corridor's
            // so a EUR user funds a SEPA account, not USD.
            session = try await BridgeRampAPI.onrampSession(
                amountCents: 10_000,
                currency: corridor.currencyCode
            )
        } catch {
            if APIError.isCancellation(error) { return }
            // 404 = the ONRAMP_ENABLED switch is off; 503 = switch on but the
            // provider has no credentials. Both mean "closed", not "broken", so
            // they get the honest not-available state instead of an error.
            if case APIError.status(let code, _) = error, code == 404 || code == 503 {
                unavailable = true
            } else {
                errorText = "We couldn't set up funding right now. Please try again."
            }
        }
    }
}

/// Shared SFSafariViewController host for the ramps (KYC redirect). Mirrors
/// the private one in DepositFlowView; lives here so the Ramps module is
/// self-contained.
struct RampSafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        let cfg = SFSafariViewController.Configuration()
        cfg.entersReaderIfAvailable = false
        return SFSafariViewController(url: url, configuration: cfg)
    }
    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

/// `URL` is Identifiable for `.sheet(item:)` in the ramps module.
extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}
