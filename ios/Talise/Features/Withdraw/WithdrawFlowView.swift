import SwiftUI

/// Top-level Withdraw flow. Replaces the old direct-to-Send sheet the
/// paper-plane button used to open. Now lands on a full-page options
/// screen with two paths:
///
///   - Withdraw to Bank → Nigerian bank transfer. Offramp provider
///     backend doesn't exist yet (no `/api/offramp/...` routes); the
///     form is a working UI stub that says "Coming soon" on Continue.
///   - Onchain Send → existing multi-step `SendFlowView`, now hosted
///     as a pushed page inside this stack rather than a separate
///     fullScreenCover from MainTabView.
///
/// All sub-pages PUSH from this stack. The stack itself is presented
/// as a fullScreenCover from MainTabView — that initial bottom-up
/// slide is unavoidable, but everything beyond it slides in from the
/// trailing edge as the user asked.
struct WithdrawFlowView: View {
    var onClose: () -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                inlineHeader
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        NavigationLink {
                            BankWithdrawView()
                        } label: {
                            OptionCardRow(
                                icon: "building.columns.fill",
                                title: "Withdraw to Bank",
                                subtitle: "Cash out to a Nigerian bank account in NGN.",
                                badge: nil
                            )
                        }
                        .buttonStyle(.plain)

                        // Onchain Send hand-off: dismiss the Withdraw
                        // cover, then post the Send-cover notification
                        // with a 220ms delay so the cover dismiss has
                        // time to settle before the next one slides up.
                        // We can't push SendFlowView inside this stack
                        // — its own NavigationStack would nest and the
                        // multi-step path breaks.
                        Button {
                            onClose()
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
                                NotificationCenter.default.post(
                                    name: .taliseRequestSendCover, object: nil
                                )
                            }
                        } label: {
                            OptionCardRow(
                                icon: "paperplane.fill",
                                title: "Onchain Send",
                                subtitle: "Send USDsui to any Talise user, @handle, or Sui address.",
                                badge: "No fee"
                            )
                        }
                        .buttonStyle(.plain)

                        // Cross-border send hand-off. Same dismiss-then-post
                        // pattern as Onchain Send so the international rail's
                        // own NavigationStack runs as a root cover, not
                        // nested inside this Withdraw stack.
                        Button {
                            onClose()
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
                                NotificationCenter.default.post(
                                    name: .taliseRequestCrossBorderCover, object: nil
                                )
                            }
                        } label: {
                            OptionCardRow(
                                icon: "globe",
                                title: "Send abroad",
                                subtitle: "Send to Nigeria, Japan, the Philippines and more — they get paid in their currency.",
                                badge: "Live rate"
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

    /// Custom inline header instead of the system large title. Lets us
    /// use the app's Talise sans font, lighter weight, smaller size.
    private var inlineHeader: some View {
        HStack(alignment: .center) {
            Text("Withdraw")
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

/// Nigerian bank transfer form. UI only — backend offramp doesn't
/// exist yet, so Continue tells the user we're not live and points
/// them at Onchain Send. The form's structure mirrors the reference
/// design (account number → bank picker → continue) so when the
/// offramp provider is wired in, only `submit()` changes.
private struct BankWithdrawView: View {
    @State private var accountNumber: String = ""
    @State private var selectedBank: String? = nil
    @State private var amount: String = ""
    @State private var notice: String? = nil

    /// Top Nigerian banks. A real implementation would pull this from
    /// the offramp provider's list (Yellow Card, Maplerad, etc.) so
    /// the list stays in sync with what they support.
    private let banks: [String] = [
        "Access Bank",
        "First Bank",
        "GTBank",
        "Kuda",
        "Opay",
        "PalmPay",
        "Stanbic IBTC",
        "UBA",
        "Zenith Bank",
    ]

    private var canSubmit: Bool {
        accountNumber.count == 10
            && selectedBank != nil
            && (Double(amount) ?? 0) > 0
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                fieldLabel("Amount in NGN")
                amountField

                fieldLabel("Receiver's account")
                accountField

                fieldLabel("Bank")
                bankPicker

                if let notice {
                    Text(notice)
                        .font(TaliseFont.body(12, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 4)
                }

                Spacer(minLength: 8)

                continueButton
                    .padding(.top, 4)
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .navigationTitle("Withdraw to Bank")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(TaliseColor.bg, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }

    private func fieldLabel(_ s: String) -> some View {
        Text(s)
            .font(TaliseFont.mono(10, weight: .light))
            .kerning(1.3)
            .foregroundStyle(TaliseColor.fgDim)
    }

    private var amountField: some View {
        HStack(spacing: 8) {
            Text("₦")
                .font(TaliseFont.heading(20, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
            TextField("", text: $amount, prompt: Text("0").foregroundColor(TaliseColor.fgDim))
                .keyboardType(.decimalPad)
                .font(TaliseFont.heading(20, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(TaliseColor.surfaceGlass)
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(TaliseColor.line, lineWidth: 0.5)
        )
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var accountField: some View {
        TextField("", text: $accountNumber, prompt: Text("10-digit account number").foregroundColor(TaliseColor.fgDim))
            .keyboardType(.numberPad)
            .font(TaliseFont.body(15))
            .foregroundStyle(TaliseColor.fg)
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
            .background(TaliseColor.surfaceGlass)
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(TaliseColor.line, lineWidth: 0.5)
            )
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .onChange(of: accountNumber) { _, new in
                // Strip non-digits, cap at 10 — Nigerian NUBAN format.
                let cleaned = new.filter { $0.isNumber }
                accountNumber = String(cleaned.prefix(10))
            }
    }

    private var bankPicker: some View {
        Menu {
            ForEach(banks, id: \.self) { b in
                Button(b) { selectedBank = b }
            }
        } label: {
            HStack {
                Text(selectedBank ?? "Select bank")
                    .font(TaliseFont.body(15))
                    .foregroundStyle(selectedBank == nil ? TaliseColor.fgDim : TaliseColor.fg)
                Spacer()
                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
            .background(TaliseColor.surfaceGlass)
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(TaliseColor.line, lineWidth: 0.5)
            )
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    private var continueButton: some View {
        Button(action: submit) {
            Text("Continue")
                .font(TaliseFont.heading(16, weight: .medium))
                .foregroundStyle(TaliseColor.bg)
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .background(canSubmit ? TaliseColor.fg : TaliseColor.fg.opacity(0.35))
                .clipShape(Capsule())
        }
        .disabled(!canSubmit)
    }

    private func submit() {
        // Offramp provider isn't wired yet — when it is, this is where
        // the POST to `/api/offramp/bank/initiate` happens. For now,
        // surface a clear "not live" notice so the user isn't left
        // wondering if their money moved.
        notice = "Bank withdrawals aren't live yet. Use Onchain Send for now — we'll email you when this opens."
    }
}
