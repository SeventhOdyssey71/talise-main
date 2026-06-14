import SwiftUI

/// Bridge CASH-OUT screen for a chosen corridor. Collects the payout bank
/// account (US ACH for USD, SEPA/IBAN for EUR), then shows the PERSISTENT Sui
/// address to send USDsui to — sending there pays out fiat to that bank.
///
/// Keeps the on-chain leg honest: Talise shows the address; the actual cash-out
/// is the user sending USDsui to it (a normal send), so this screen ends at
/// "here's your address," not a fake "done."
struct BridgeCashOutView: View {
    let corridor: RampCorridor

    @State private var ownerName = ""
    // USD / ACH
    @State private var accountNumber = ""
    @State private var routingNumber = ""
    @State private var savings = false
    // EUR / SEPA
    @State private var iban = ""
    @State private var bic = ""
    @State private var firstName = ""
    @State private var lastName = ""

    @State private var submitting = false
    @State private var result: CashOutResponse?
    @State private var errorText: String?
    @State private var copied = false

    private var isEur: Bool { corridor.currencyCode == "EUR" }
    private var isUsd: Bool { corridor.currencyCode == "USD" }
    private var supported: Bool { isUsd || isEur }

    private var canSubmit: Bool {
        guard !ownerName.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
        if isUsd { return accountNumber.count >= 4 && routingNumber.count >= 6 }
        if isEur {
            return iban.count >= 10 && bic.count >= 6
                && !firstName.isEmpty && !lastName.isEmpty
        }
        return false
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header
                if let result {
                    addressCard(result)
                } else if !supported {
                    unsupportedCard
                } else {
                    form
                    if let errorText {
                        Text(errorText)
                            .font(TaliseFont.body(13, weight: .light))
                            .foregroundStyle(Color(hex: 0xFF6B6B))
                    }
                    submitButton
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 28)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .scrollDismissesKeyboard(.interactively)
        .overlay(alignment: .bottom) { copiedToast }
        .animation(.snappy(duration: 0.25), value: copied)
    }

    private var header: some View {
        HStack(spacing: 14) {
            RoundedFlag(flag: corridor.flag, size: 46)
            VStack(alignment: .leading, spacing: 3) {
                Text("Cash out · \(corridor.name)")
                    .font(TaliseFont.heading(20, weight: .medium))
                    .kerning(-0.4)
                    .foregroundStyle(TaliseColor.fg)
                Text("Pay out to your \(corridor.currencyCode) bank account.")
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 4)
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 14) {
            field("Account holder name", text: $ownerName)
            if isUsd {
                field("Account number", text: $accountNumber, keyboard: .numberPad)
                field("Routing number", text: $routingNumber, keyboard: .numberPad)
                Toggle(isOn: $savings) {
                    Text("Savings account")
                        .font(TaliseFont.body(14, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted)
                }
                .tint(TaliseColor.greenDeep)
            } else if isEur {
                HStack(spacing: 10) {
                    field("First name", text: $firstName)
                    field("Last name", text: $lastName)
                }
                field("IBAN", text: $iban)
                field("BIC / SWIFT", text: $bic)
            }
        }
        .padding(18)
        .rampCard()
    }

    private func field(
        _ label: String,
        text: Binding<String>,
        keyboard: UIKeyboardType = .default
    ) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label)
                .font(TaliseFont.mono(10, weight: .regular))
                .kerning(0.4)
                .foregroundStyle(TaliseColor.fgDim)
            TextField("", text: text)
                .font(TaliseFont.body(15, weight: .regular))
                .foregroundStyle(TaliseColor.fg)
                .keyboardType(keyboard)
                .autocorrectionDisabled()
                .textInputAutocapitalization(label.contains("name") ? .words : .never)
                .padding(.horizontal, 12)
                .frame(height: 44)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(TaliseColor.surface2)
                )
        }
    }

    private var submitButton: some View {
        Button {
            Task { await submit() }
        } label: {
            HStack(spacing: 8) {
                if submitting { ProgressView().tint(.black) }
                Text(submitting ? "Setting up…" : "Get cash-out address")
            }
            .font(TaliseFont.body(15, weight: .semibold))
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(Capsule().fill(canSubmit ? TaliseColor.greenMint : TaliseColor.surface2))
        }
        .buttonStyle(.plain)
        .disabled(!canSubmit || submitting)
        .opacity(canSubmit ? 1 : 0.6)
    }

    private func addressCard(_ r: CashOutResponse) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Your cash-out address", systemImage: "checkmark.circle.fill")
                .font(TaliseFont.heading(16, weight: .semibold))
                .foregroundStyle(TaliseColor.greenMint)
            Text("Send USDsui to this address to pay out to your \(r.currency.uppercased()) bank. It stays yours — reuse it any time.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                UIPasteboard.general.string = r.address
                UISelectionFeedbackGenerator().selectionChanged()
                copied = true
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 1_600_000_000)
                    copied = false
                }
            } label: {
                HStack {
                    Text(r.address)
                        .font(TaliseFont.mono(13, weight: .regular))
                        .foregroundStyle(TaliseColor.fg)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: 8)
                    Image(systemName: "doc.on.doc")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(TaliseColor.fgDim)
                }
                .padding(.horizontal, 14)
                .frame(height: 48)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(TaliseColor.surface2)
                )
            }
            .buttonStyle(.plain)
        }
        .padding(18)
        .rampCard()
    }

    private var unsupportedCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Cash-out coming soon")
                .font(TaliseFont.heading(16, weight: .semibold))
                .foregroundStyle(TaliseColor.fg)
            Text("Direct bank cash-out for \(corridor.name) is on the way. USD and EUR accounts are supported today.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .rampCard()
    }

    @ViewBuilder private var copiedToast: some View {
        if copied {
            Text("Address copied")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fg)
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .background(Capsule().fill(TaliseColor.surface2))
                .padding(.bottom, 32)
                .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    private func submit() async {
        submitting = true
        errorText = nil
        defer { submitting = false }
        let req: CashOutRequest
        if isUsd {
            req = CashOutRequest(
                rail: "ach", currency: "usd", accountOwnerName: ownerName,
                accountNumber: accountNumber, routingNumber: routingNumber,
                checkingOrSavings: savings ? "savings" : "checking"
            )
        } else {
            req = CashOutRequest(
                rail: "sepa", currency: "eur", accountOwnerName: ownerName,
                firstName: firstName, lastName: lastName,
                iban: iban, bic: bic, country: "DEU"
            )
        }
        do {
            result = try await BridgeRampAPI.cashOutAddress(req)
        } catch {
            let msg = (error as NSError).localizedDescription
            if msg.contains("503") || msg.contains("disabled") {
                errorText = "Cash-out isn't switched on yet. Please try again soon."
            } else if msg.contains("409") || msg.contains("CUSTOMER") {
                errorText = "Finish identity verification (Add money) first, then cash out."
            } else {
                errorText = "We couldn't set up cash-out. Check your details and try again."
            }
        }
    }
}
