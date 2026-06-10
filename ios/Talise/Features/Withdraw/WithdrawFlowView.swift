import SwiftUI

/// Top-level Withdraw flow. Replaces the old direct-to-Send sheet the
/// paper-plane button used to open. Now lands on a full-page options
/// screen with two paths:
///
///   - Withdraw to Bank → Nigerian bank transfer, wired to the live Linq
///     off-ramp (`/api/offramp/linq/{quote,create,status}`): quote →
///     slide-to-confirm (USDsui → Linq deposit wallet) → poll until completed.
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

    /// Which action group (if any) is expanded inline.
    private enum ActionGroup { case cheques, work }
    @State private var expanded: ActionGroup?

    /// Dismiss the cover, then post the target cover's notification with a
    /// 220ms delay so the dismiss settles before the next cover slides up.
    /// (We can't push these flows inside this stack — each runs its own
    /// NavigationStack and nesting breaks the multi-step paths.)
    private func handOff(_ name: Notification.Name) {
        onClose()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
            NotificationCenter.default.post(name: name, object: nil)
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                inlineHeader
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        // ── Primary actions: a clean 2×2 grid ──
                        LazyVGrid(
                            columns: [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)],
                            spacing: 14
                        ) {
                            NavigationLink {
                                BankWithdrawView()
                            } label: {
                                ActionTile(icon: "hi.bank", title: "Bank transfer", caption: "Cash out in NGN")
                            }
                            .buttonStyle(TilePress())

                            Button { handOff(.taliseRequestSendCover) } label: {
                                ActionTile(icon: "hi.send", title: "Send", caption: "@handle or address")
                            }
                            .buttonStyle(TilePress())

                            Button { handOff(.taliseRequestCrossBorderCover) } label: {
                                ActionTile(icon: "hi.globe", title: "Send abroad", caption: "Paid in their currency")
                            }
                            .buttonStyle(TilePress())

                            Button {
                                withAnimation(.snappy(duration: 0.24)) {
                                    expanded = expanded == .cheques ? nil : .cheques
                                }
                            } label: {
                                ActionTile(
                                    icon: "hi.cheque",
                                    title: "Cheques",
                                    caption: "Money, in a link",
                                    expandable: true,
                                    isExpanded: expanded == .cheques
                                )
                            }
                            .buttonStyle(TilePress())
                        }

                        // ── Cheques group, expanded inline under the grid ──
                        if expanded == .cheques {
                            SubActionList(rows: [
                                .init(icon: "hi.write", title: "Write a cheque") {
                                    handOff(.taliseRequestChequeWriteCover)
                                },
                                .init(icon: "hi.cash", title: "Cash a cheque") {
                                    handOff(.taliseRequestChequeClaimCover)
                                },
                                .init(icon: "hi.list", title: "My cheques") {
                                    handOff(.taliseRequestMyChequesCover)
                                },
                            ])
                            .transition(.opacity.combined(with: .move(edge: .top)))
                        }

                        // ── Work group: streams, invoices, contracts ──
                        Button {
                            withAnimation(.snappy(duration: 0.24)) {
                                expanded = expanded == .work ? nil : .work
                            }
                        } label: {
                            GroupRow(
                                icon: "hi.briefcase",
                                title: "Work",
                                caption: "Streams · Invoices · Contracts",
                                isExpanded: expanded == .work
                            )
                        }
                        .buttonStyle(TilePress())

                        if expanded == .work {
                            SubActionList(rows: [
                                .init(icon: "hi.stream", title: "Stream a payment") {
                                    handOff(.taliseRequestStreamCover)
                                },
                                .init(icon: "hi.invoice", title: "Invoices") {
                                    handOff(.taliseRequestInvoicesCover)
                                },
                                .init(icon: "hi.contract", title: "Contracts") {
                                    handOff(.taliseRequestContractsCover)
                                },
                            ])
                            .transition(.opacity.combined(with: .move(edge: .top)))
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 10)
                    .padding(.bottom, 32)
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
            Text("Move money")
                .font(TaliseFont.heading(26, weight: .medium))
                .kerning(-0.6)
                .foregroundStyle(TaliseColor.fg)
            Spacer()
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(TaliseColor.surface2))
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 14)
    }
}

// MARK: - Action tiles + groups
//
// CashApp-grammar: generous tiles, one squircle icon chip in a SUBTLE brand
// green per action, confident type, soft hairline ring — no badge pills, no
// loud filled discs. Icons are the Hugeicons set (Assets.xcassets/HugeIcons,
// template-rendered SVGs extracted from the same @hugeicons set the web app
// uses), so web + iOS finally share one icon language.

/// Hugeicon image, template-tinted.
private struct HugeIcon: View {
    let name: String
    var size: CGFloat = 20
    var tint: Color = TaliseColor.greenMint

    var body: some View {
        Image(name)
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .foregroundStyle(tint)
    }
}

/// The squircle icon chip — soft mint wash, mint glyph.
private struct IconChip: View {
    let icon: String
    var side: CGFloat = 42
    var iconSize: CGFloat = 20

    var body: some View {
        RoundedRectangle(cornerRadius: side * 0.32, style: .continuous)
            .fill(TaliseColor.greenMint.opacity(0.12))
            .frame(width: side, height: side)
            .overlay(HugeIcon(name: icon, size: iconSize))
    }
}

/// Press feedback for the big tiles — a gentle scale, CashApp-style.
private struct TilePress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.965 : 1)
            .animation(.snappy(duration: 0.18), value: configuration.isPressed)
    }
}

/// One square-ish primary tile in the 2×2 grid.
private struct ActionTile: View {
    let icon: String
    let title: String
    let caption: String
    var expandable = false
    var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                IconChip(icon: icon)
                Spacer()
                if expandable {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(TaliseColor.fgDim)
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                        .padding(.top, 4)
                }
            }
            Spacer(minLength: 16)
            Text(title)
                .font(TaliseFont.heading(16, weight: .semibold))
                .kerning(-0.3)
                .foregroundStyle(TaliseColor.fg)
            Text(caption)
                .font(TaliseFont.body(12.5, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .lineLimit(1)
                .padding(.top, 3)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 132)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(TaliseColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(Color.white.opacity(0.05), lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

/// Slim full-width group header row (Work).
private struct GroupRow: View {
    let icon: String
    let title: String
    let caption: String
    var isExpanded = false

    var body: some View {
        HStack(spacing: 14) {
            IconChip(icon: icon)
            VStack(alignment: .leading, spacing: 2.5) {
                Text(title)
                    .font(TaliseFont.heading(16, weight: .semibold))
                    .kerning(-0.3)
                    .foregroundStyle(TaliseColor.fg)
                Text(caption)
                    .font(TaliseFont.body(12.5, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
            Spacer()
            Image(systemName: "chevron.down")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(TaliseColor.fgDim)
                .rotationEffect(.degrees(isExpanded ? 180 : 0))
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(TaliseColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(Color.white.opacity(0.05), lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

/// The expanded rows of a group — one rounded container, hairline dividers.
private struct SubActionList: View {
    struct Row: Identifiable {
        let icon: String
        let title: String
        let action: () -> Void
        var id: String { title }
    }
    let rows: [Row]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { i, row in
                Button(action: row.action) {
                    HStack(spacing: 14) {
                        IconChip(icon: row.icon, side: 34, iconSize: 16)
                        Text(row.title)
                            .font(TaliseFont.body(15, weight: .regular))
                            .foregroundStyle(TaliseColor.fg)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(TaliseColor.fgDim)
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 13)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if i < rows.count - 1 {
                    Divider().overlay(TaliseColor.fg.opacity(0.06)).padding(.leading, 66)
                }
            }
        }
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(TaliseColor.surface.opacity(0.55))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(Color.white.opacity(0.04), lineWidth: 1)
        )
    }
}

// MARK: - Linq off-ramp DTOs

/// `POST /api/offramp/linq/quote` response. Resolves the destination
/// account name and the live NGN you'll receive for `amountUsdsui`.
private struct LinqQuoteResp: Decodable {
    let accountName: String
    let bankName: String
    let bankCode: String
    let accountNumber: String
    let rate: Double
    let amountUsdsui: Double
    let amountNgn: Double
}
/// `POST /api/offramp/linq/create` response. `walletAddress` is the Sui
/// address the user must send exactly `amountUsdsui` USDSUI to; the order
/// is then settled by Linq and tracked via `orderId`.
private struct LinqCreateResp: Decodable {
    let orderId: String
    let linqOrderId: String
    let walletAddress: String
    let coinType: String
    let amountUsdsui: Double
    let amountNgn: Double
    let rate: Double
    let depositWindowMinutes: Int
}
/// `GET /api/offramp/linq/status/[orderId]` — current state of the order.
private struct LinqStatusResp: Decodable {
    let orderId: String
    let status: String
    let phase: String             // initiated | processing | completed | failed
    let amountUsdsui: Double
    let amountNgn: Double
}

/// `POST /api/offramp/linq/resolve` response. Amount-independent name
/// enquiry — detects the account holder so the user never types it.
private struct LinqResolveResp: Decodable {
    let accountName: String
    let bankName: String
    let bankCode: String
    let accountNumber: String
}
/// `GET /api/offramp/linq/rate` — public display rate for the live estimate.
private struct LinqRateResp: Decodable {
    let rate: Double
}

/// One bank option for the picker. `name` is what we show; `bankCode` is
/// the plain NIBSS code Linq accepts directly (no UUID resolution).
private struct OfframpBank: Identifiable, Hashable {
    let name: String
    let bankCode: String
    var id: String { bankCode }
}

/// Nigerian bank transfer — wired to the live Linq off-ramp.
///
/// Flow: enter USDsui amount + account + bank → QUOTE (name-check + rate) →
/// slide to confirm (creates a Linq order, then signs a USDsui transfer to
/// the Linq deposit wallet) → POLL status until completed/failed.
private struct BankWithdrawView: View {
    @State private var accountNumber: String = ""
    @State private var selectedBank: OfframpBank? = nil
    @State private var amount: String = ""

    @State private var step: Step = .form
    @State private var quote: LinqQuoteResp?
    @State private var quoting = false
    @State private var confirming = false
    @State private var statusText: String = ""
    @State private var finalStatus: String?      // completed | failed
    @State private var error: String?

    // Inline account-name resolution. The user never types their own name —
    // we name-enquire the (bank, account) pair and detect the holder.
    @State private var resolvedName: String?
    @State private var resolving = false
    @State private var resolveError: String?
    @State private var resolveTask: Task<Void, Never>?

    // Live display rate (1 USDsui = `rate` NGN) for the "≈ ₦X" estimate.
    @State private var displayRate: Double?

    // Searchable bank-picker sheet.
    @State private var showBankPicker = false

    private enum Step { case form, review, sending, done }

    /// Common Nigerian banks, name + plain NIBSS code (Linq codes).
    private let banks: [OfframpBank] = [
        .init(name: "Access Bank",              bankCode: "044"),
        .init(name: "Guaranty Trust Bank",      bankCode: "058"),
        .init(name: "First Bank of Nigeria",    bankCode: "011"),
        .init(name: "Zenith Bank",              bankCode: "057"),
        .init(name: "United Bank For Africa",   bankCode: "033"),
        .init(name: "Wema Bank",                bankCode: "035"),
        .init(name: "Sterling Bank",            bankCode: "232"),
        .init(name: "Fidelity Bank",            bankCode: "070"),
        .init(name: "First City Monument Bank", bankCode: "214"),
        .init(name: "Stanbic IBTC Bank",        bankCode: "039"),
        .init(name: "Kuda",                     bankCode: "090267"),
        .init(name: "OPay",                     bankCode: "100004"),
        .init(name: "PalmPay",                  bankCode: "100033"),
        .init(name: "Moniepoint",               bankCode: "090405"),
    ]

    /// Whether the user's display currency is NGN. When true the amount
    /// field is denominated in Naira (the exact NGN they want credited) and
    /// the backend debits the precise USDsui from Linq's locked rate; when
    /// false (USD or any other display currency) the field stays in USDsui.
    /// Branch on this everywhere rather than hardcoding NGN.
    private var isNgnInput: Bool { CurrencySettings.shared.current.code == "NGN" }

    /// Raw numeric value the user typed (NGN when `isNgnInput`, else USDsui).
    private var amountValue: Double { Double(amount) ?? 0 }

    /// The USDsui amount this input *implies* — only meaningful for the
    /// USD path or for gating "can continue". For the NGN path the exact
    /// debit comes from the server quote/create, never this estimate.
    private var usdsuiAmount: Double { Double(amount) ?? 0 }

    /// The account must be NAME-RESOLVED before we'll let the user move on —
    /// a wrong/unverifiable account can't proceed.
    private var canContinue: Bool {
        amountValue > 0
            && selectedBank != nil
            && accountNumber.count == 10
            && resolvedName != nil
            && resolveError == nil
            && !resolving
    }

    var body: some View {
        Group {
            switch step {
            case .form: formView
            case .review: reviewView
            case .sending, .done: statusView
            }
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .navigationTitle("Withdraw to Bank")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(TaliseColor.bg, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .sheet(isPresented: $showBankPicker) {
            BankPickerSheet(banks: banks, selected: selectedBank) { bank in
                selectedBank = bank
                scheduleResolve()
            }
        }
        .task { await loadRate() }
        .onChange(of: accountNumber) { _, _ in scheduleResolve() }
    }

    // MARK: Form

    private var formView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    fieldLabel(isNgnInput ? "Amount in Naira" : "Amount in USDsui")
                    amountField
                    estimateLine
                }

                VStack(alignment: .leading, spacing: 6) {
                    fieldLabel("Bank")
                    bankPickerRow
                }

                VStack(alignment: .leading, spacing: 8) {
                    fieldLabel("Receiver's account")
                    accountField
                    resolvedNameLine
                }

                if let error {
                    Text(error)
                        .font(TaliseFont.body(12, weight: .light))
                        .foregroundStyle(TaliseColor.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 4)
                }

                Spacer(minLength: 8)

                continueButton.padding(.top, 4)
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
        }
    }

    private func fieldLabel(_ s: String) -> some View {
        Text(s)
            .font(TaliseFont.mono(10, weight: .light))
            .kerning(1.3)
            .foregroundStyle(TaliseColor.fgDim)
    }

    private var amountField: some View {
        HStack(spacing: 8) {
            Text(isNgnInput ? "₦" : "$")
                .font(TaliseFont.heading(20, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
            TextField("", text: $amount, prompt: Text("0").foregroundColor(TaliseColor.fgDim))
                .keyboardType(.decimalPad)
                .font(TaliseFont.heading(20, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .fieldSurface()
    }

    /// Live estimate under the amount. Display-only — the locked figures
    /// still come from the quote at review.
    ///   - NGN input → "≈ {ngn / rate} USDsui" (what will be debited).
    ///   - USD input → "≈ ₦{usdsui × rate}" (what the recipient receives).
    @ViewBuilder private var estimateLine: some View {
        if let rate = displayRate, rate > 0, amountValue > 0 {
            Text(isNgnInput
                 ? "≈ \(TaliseFormat.usd2(amountValue / rate)) USDsui"
                 : "≈ ₦\(ngnGrouped(amountValue * rate))")
                .font(TaliseFont.mono(12, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .padding(.leading, 2)
                .contentTransition(.numericText())
                .animation(.snappy(duration: 0.18), value: amountValue)
        }
    }

    private var accountField: some View {
        TextField("", text: $accountNumber, prompt: Text("10-digit account number").foregroundColor(TaliseColor.fgDim))
            .keyboardType(.numberPad)
            .font(TaliseFont.body(15))
            .foregroundStyle(TaliseColor.fg)
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
            .fieldSurface()
            .onChange(of: accountNumber) { _, new in
                let cleaned = new.filter { $0.isNumber }
                let trimmed = String(cleaned.prefix(10))
                if trimmed != new { accountNumber = trimmed }
            }
    }

    /// Inline detected-name feedback under the account field: resolving →
    /// success (green check + holder name) → failure (red line).
    @ViewBuilder private var resolvedNameLine: some View {
        if resolving {
            HStack(spacing: 7) {
                ProgressView().controlSize(.mini).tint(TaliseColor.fgMuted)
                Text("Checking account…")
                    .font(TaliseFont.body(12, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
            .padding(.leading, 2)
        } else if let name = resolvedName {
            HStack(spacing: 7) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(TaliseColor.accent)
                Text(name)
                    .font(TaliseFont.body(13, weight: .medium))
                    .foregroundStyle(TaliseColor.accent)
                    .lineLimit(1)
            }
            .padding(.leading, 2)
        } else if let resolveError {
            Text(resolveError)
                .font(TaliseFont.body(12, weight: .light))
                .foregroundStyle(TaliseColor.danger)
                .lineLimit(2)
                .padding(.leading, 2)
        }
    }

    /// Tappable row that opens the searchable bank-picker sheet.
    private var bankPickerRow: some View {
        Button { showBankPicker = true } label: {
            HStack(spacing: 12) {
                if let bank = selectedBank {
                    BankAvatar(bankCode: bank.bankCode, bankName: bank.name, size: 34, cornerRadius: 9)
                }
                Text(selectedBank?.name ?? "Select bank")
                    .font(TaliseFont.body(15))
                    .foregroundStyle(selectedBank == nil ? TaliseColor.fgDim : TaliseColor.fg)
                Spacer()
                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .fieldSurface()
        }
        .buttonStyle(.plain)
    }

    private var continueButton: some View {
        Button(action: { Task { await getQuote() } }) {
            HStack(spacing: 8) {
                if quoting { ProgressView().tint(TaliseColor.bg) }
                Text(quoting ? "Checking…" : "Continue")
                    .font(TaliseFont.heading(16, weight: .medium))
                    .foregroundStyle(TaliseColor.bg)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(canContinue && !quoting ? TaliseColor.fg : TaliseColor.fg.opacity(0.35))
            .clipShape(Capsule())
        }
        .disabled(!canContinue || quoting)
    }

    // MARK: Review (quote)

    @ViewBuilder private var reviewView: some View {
        if let q = quote {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        Text("Review withdrawal")
                            .font(TaliseFont.heading(24, weight: .medium))
                            .kerning(-0.5)
                            .foregroundStyle(TaliseColor.fg)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 4)

                        // Summary card — headline receive amount, then details.
                        VStack(spacing: 0) {
                            VStack(spacing: 6) {
                                Eyebrow(text: "You receive")
                                Text("₦\(ngnGrouped(q.amountNgn))")
                                    .font(TaliseFont.heading(40, weight: .medium))
                                    .kerning(-1)
                                    .foregroundStyle(TaliseColor.fg)
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.6)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 20)

                            divider

                            VStack(spacing: 0) {
                                reviewRow("To", q.accountName)
                                divider
                                reviewRow("Bank", q.bankName.isEmpty ? (selectedBank?.name ?? "—") : q.bankName)
                                divider
                                reviewRow("Account", maskAccount(accountNumber))
                                divider
                                reviewRow("You send", "\(TaliseFormat.usd2(q.amountUsdsui)) USDsui")
                                divider
                                reviewRow("Rate", "$1 = ₦\(ngnGrouped(q.rate))")
                            }
                            .padding(.horizontal, 16)
                        }
                        .background(
                            RoundedRectangle(cornerRadius: 22, style: .continuous)
                                .fill(TaliseColor.surface)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))

                        HStack(spacing: 6) {
                            Image(systemName: "checkmark.seal.fill")
                                .font(.system(size: 11))
                                .foregroundStyle(TaliseColor.greenMint)
                            Text("No network fee — sponsored by Talise.")
                                .font(TaliseFont.mono(11, weight: .light))
                                .foregroundStyle(TaliseColor.fgMuted)
                        }
                        .frame(maxWidth: .infinity)

                        if let error {
                            Text(error)
                                .font(TaliseFont.body(12))
                                .foregroundStyle(TaliseColor.danger)
                                .frame(maxWidth: .infinity, alignment: .center)
                                .multilineTextAlignment(.center)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .padding(.bottom, 20)
                }

                VStack(spacing: 12) {
                    SlideToConfirm(title: "Slide to withdraw", tint: TaliseColor.greenMint) {
                        await confirm()
                    }
                    .disabled(confirming)
                    .opacity(confirming ? 0.5 : 1)

                    Button("Edit") { step = .form; quote = nil; error = nil }
                        .font(TaliseFont.body(14))
                        .foregroundStyle(TaliseColor.fgMuted)
                        .disabled(confirming)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 18)
            }
        }
    }

    private func reviewRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(TaliseFont.body(13, weight: .light)).foregroundStyle(TaliseColor.fgMuted)
            Spacer()
            Text(value).font(TaliseFont.body(14, weight: .medium)).foregroundStyle(TaliseColor.fg)
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 13)
    }

    private var divider: some View { Rectangle().fill(TaliseColor.line).frame(height: 1) }

    // MARK: Status

    private var statusView: some View {
        VStack(spacing: 18) {
            Spacer()
            statusIcon
            Text(statusHeadline)
                .font(TaliseFont.heading(24, weight: .medium))
                .kerning(-0.5)
                .foregroundStyle(TaliseColor.fg)
            Text(statusText)
                .font(TaliseFont.body(14, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 30)
            Spacer()
            if step == .done {
                VStack(spacing: 12) {
                    if finalStatus == "failed" {
                        Button(action: { step = .review; error = nil }) {
                            Text("Try again")
                                .font(TaliseFont.heading(16, weight: .medium))
                                .foregroundStyle(TaliseColor.bg)
                                .frame(maxWidth: .infinity).frame(height: 56)
                                .background(TaliseColor.fg).clipShape(Capsule())
                        }
                        Button("Close") { dismiss() }
                            .font(TaliseFont.body(14))
                            .foregroundStyle(TaliseColor.fgMuted)
                    } else {
                        Button(action: { dismiss() }) {
                            Text("Done")
                                .font(TaliseFont.heading(16, weight: .medium))
                                .foregroundStyle(TaliseColor.bg)
                                .frame(maxWidth: .infinity).frame(height: 56)
                                .background(TaliseColor.fg).clipShape(Capsule())
                        }
                    }
                }
                .padding(.horizontal, 20).padding(.bottom, 24)
            }
        }
    }

    @ViewBuilder private var statusIcon: some View {
        if step == .sending {
            // Clean comet-tail ring in the brand mint — no grey backdrop.
            TaliseLoadingRing(size: 64, lineWidth: 3.5)
        } else if finalStatus == "completed" {
            Image(systemName: paidOut ? "checkmark.seal.fill" : "clock.fill")
                .font(.system(size: paidOut ? 56 : 50)).foregroundStyle(TaliseColor.greenMint)
                .frame(width: 96, height: 96)
                .background(Circle().fill(TaliseColor.greenMint.opacity(0.16)))
        } else {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 52)).foregroundStyle(TaliseColor.danger)
                .frame(width: 96, height: 96)
                .background(Circle().fill(TaliseColor.danger.opacity(0.16)))
        }
    }

    /// True once Linq confirms the payout landed; false while it's in flight
    /// (poll timed out) — drives "Paid out" vs "On its way" copy + icon.
    @State private var paidOut = false

    private var statusHeadline: String {
        if step == .sending { return "Paying your bank…" }
        if finalStatus == "failed" { return "Withdrawal failed" }
        return paidOut ? "Paid out" : "On its way"
    }

    @Environment(\.dismiss) private var dismiss

    // MARK: Networking

    /// Load the public display rate for the live "≈ ₦X" estimate. Silent —
    /// the estimate just doesn't render if it's unavailable.
    private func loadRate() async {
        guard displayRate == nil else { return }
        do {
            let r: LinqRateResp = try await APIClient.shared.get("/api/offramp/linq/rate")
            displayRate = r.rate
        } catch { /* display-only — ignore */ }
    }

    /// Debounce (~0.4s) then resolve the account name whenever the bank or
    /// account number changes. Cancels any in-flight resolve first so only
    /// the latest (bank, account) pair is name-enquired.
    private func scheduleResolve() {
        resolveTask?.cancel()
        // Clear stale state immediately so a changed field never shows a
        // name that belongs to the previous input.
        resolvedName = nil
        resolveError = nil

        guard let bank = selectedBank, accountNumber.count == 10 else {
            resolving = false
            return
        }

        resolving = true
        let bankCode = bank.bankCode
        let account = accountNumber
        resolveTask = Task {
            try? await Task.sleep(nanoseconds: 400_000_000)
            if Task.isCancelled { return }
            await resolveAccount(bankCode: bankCode, accountNumber: account)
        }
    }

    private func resolveAccount(bankCode: String, accountNumber: String) async {
        struct Body: Encodable { let bankCode: String; let accountNumber: String }
        do {
            let r: LinqResolveResp = try await APIClient.shared.post(
                "/api/offramp/linq/resolve",
                body: Body(bankCode: bankCode, accountNumber: accountNumber)
            )
            // Guard against a late response landing after the user edited the
            // field again (state moved on while we were in flight).
            guard !Task.isCancelled,
                  self.accountNumber == accountNumber,
                  self.selectedBank?.bankCode == bankCode else { return }
            resolvedName = r.accountName
            resolveError = nil
            resolving = false
        } catch APIError.unauthorized {
            guard self.accountNumber == accountNumber,
                  self.selectedBank?.bankCode == bankCode else { return }
            resolveError = "Sign in to continue."
            resolvedName = nil
            resolving = false
        } catch APIError.status(let code, let msg) {
            guard !Task.isCancelled,
                  self.accountNumber == accountNumber,
                  self.selectedBank?.bankCode == bankCode else { return }
            resolveError = code == 422
                ? "We couldn't verify that account. Check the number and bank."
                : friendlyOfframpError(code: code, message: msg)
            resolvedName = nil
            resolving = false
        } catch {
            if APIError.isCancellation(error) { return }
            guard self.accountNumber == accountNumber,
                  self.selectedBank?.bankCode == bankCode else { return }
            resolveError = "Couldn't check that account right now."
            resolvedName = nil
            resolving = false
        }
    }

    private func getQuote() async {
        guard canContinue, let bank = selectedBank else { return }
        quoting = true; error = nil
        defer { quoting = false }
        // The backend accepts either amountNgn (NGN display currency — debits
        // the exact USDsui from Linq's locked rate) or amountUsdsui (USD/other
        // display currencies). Send whichever the user entered; leave the
        // other nil so it's omitted from the JSON body.
        struct Body: Encodable {
            let amountNgn: Double?
            let amountUsdsui: Double?
            let bankCode: String
            let accountNumber: String
        }
        do {
            let q: LinqQuoteResp = try await APIClient.shared.post(
                "/api/offramp/linq/quote",
                body: Body(
                    amountNgn: isNgnInput ? amountValue : nil,
                    amountUsdsui: isNgnInput ? nil : amountValue,
                    bankCode: bank.bankCode,
                    accountNumber: accountNumber
                )
            )
            quote = q
            withAnimation { step = .review }
        } catch APIError.status(let code, let msg) {
            error = friendlyOfframpError(code: code, message: msg)
        } catch {
            if APIError.isCancellation(error) { return }
            self.error = "Couldn't get a quote right now."
        }
    }

    private func confirm() async {
        guard let q = quote, let bank = selectedBank else { return }
        confirming = true; error = nil
        defer { confirming = false }
        do {
            // 1. Create the Linq order — returns the deposit wallet to fund.
            //    For NGN we send amountNgn (the exact credit) and trust the
            //    response's amountUsdsui as the EXACT amount to debit; for
            //    USD/other we send the quoted amountUsdsui. Send only the
            //    field that matches the input so the other is omitted.
            struct CreateBody: Encodable {
                let amountNgn: Double?
                let amountUsdsui: Double?
                let bankCode: String
                let accountNumber: String
                let accountName: String
                let bankName: String?
            }
            let order: LinqCreateResp = try await APIClient.shared.post(
                "/api/offramp/linq/create",
                body: CreateBody(
                    amountNgn: isNgnInput ? q.amountNgn : nil,
                    amountUsdsui: isNgnInput ? nil : q.amountUsdsui,
                    bankCode: bank.bankCode,
                    accountNumber: accountNumber,
                    accountName: q.accountName,
                    bankName: q.bankName.isEmpty ? bank.name : q.bankName
                )
            )

            // 2. Send exactly the quoted USDsui to Linq's deposit wallet
            //    (sponsored/gasless — same rail as a normal send).
            // sponsorFallback: a cash-out is fee-free to the user ("No network
            // fee — sponsored by Talise" on the review screen). Try the
            // gasless rail first (free for Talise when the user's USDsui is in
            // the accumulator); if it can't build (funds in Coin objects — the
            // common case, and the cause of the prior "Couldn't complete the
            // withdrawal" error) the server sponsors it so the cash-out still
            // lands.
            let sent = try await ZkLoginCoordinator.shared.signAndSubmitSend(
                to: order.walletAddress, amountUsd: order.amountUsdsui,
                intent: "Bank withdrawal", sponsorFallback: true
            )
            NotificationCenter.default.post(name: .taliseTxCompleted, object: TaliseTxEvent(
                digest: sent.digest, direction: "sent", amountUsdsui: order.amountUsdsui,
                counterparty: order.walletAddress, counterpartyName: "Bank withdrawal", venue: nil))

            statusText = "Sending the money to \(order.amountNgn > 0 ? "₦\(ngnGrouped(order.amountNgn))" : "your bank")…"
            withAnimation { step = .sending }
            await pollStatus(order.orderId)
        } catch APIError.status(let code, let msg) {
            error = friendlyOfframpError(code: code, message: msg)
        } catch APIError.unauthorized {
            error = "Please sign in again."
        } catch {
            if APIError.isCancellation(error) { return }
            self.error = APIError.honestMoneyError(
                error, fallback: "Couldn't complete the withdrawal right now.")
        }
    }

    /// Poll the Linq order until it completes or fails (or we time out and
    /// leave it "processing" — the payout still completes server-side).
    private func pollStatus(_ id: String) async {
        for _ in 0..<20 {
            do {
                let s: LinqStatusResp = try await APIClient.shared.get("/api/offramp/linq/status/\(id)")
                switch s.phase {
                case "completed":
                    finalStatus = "completed"
                    paidOut = true
                    statusText = "₦\(ngnGrouped(s.amountNgn)) has landed in the bank account."
                    withAnimation { step = .done }
                    return
                case "failed":
                    finalStatus = "failed"
                    statusText = "The payout couldn't be completed — your USDsui has been returned."
                    withAnimation { step = .done }
                    return
                default:
                    break   // initiated / processing — keep polling
                }
            } catch {
                if APIError.isCancellation(error) { return }
            }
            try? await Task.sleep(nanoseconds: 3_000_000_000)
        }
        // Timed out waiting — payout is in flight; let the user move on.
        finalStatus = "completed"
        paidOut = false
        statusText = "Your transfer is on its way. It can take a few minutes to land in the bank account."
        withAnimation { step = .done }
    }

    private func maskAccount(_ a: String) -> String {
        a.count <= 4 ? "****" : "****\(a.suffix(4))"
    }

    /// Grouped NGN figure (no currency symbol — we prefix ₦ at the call site).
    private func ngnGrouped(_ v: Double) -> String {
        let fmt = NumberFormatter()
        fmt.numberStyle = .decimal
        fmt.locale = Locale(identifier: "en_US")
        fmt.minimumFractionDigits = 0
        fmt.maximumFractionDigits = v < 100 ? 2 : 0
        return fmt.string(from: NSNumber(value: v)) ?? String(format: "%.0f", v)
    }

    /// Map rollout / config errors to reassuring copy; pass real ones through.
    private func friendlyOfframpError(code: Int, message: String?) -> String {
        let lower = (message ?? "").lowercased()
        if code == 503 || lower.contains("not configured") || lower.contains("fx_unavailable") {
            return "Bank withdrawals are rolling out — check back soon."
        }
        if code == 422 && lower.contains("verify") {
            return "We couldn't verify that bank account. Check the number and bank."
        }
        if lower.contains("\"error\"") {
            // Body is JSON like {"error":"…"} — pull the message out.
            if let data = message?.data(using: .utf8),
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let e = obj["error"] as? String, !e.isEmpty {
                return e
            }
        }
        if code == 404 { return "Bank withdrawals aren't available yet." }
        // Only surface a server message if it's short and not an HTML error
        // page — never dump a raw body/stack into the UI.
        if let msg = message, !msg.isEmpty, msg.count <= 120,
           !lower.contains("<html"), !lower.contains("<!doctype") {
            return msg
        }
        return "Something went wrong. Please try again."
    }
}

// MARK: - Searchable bank picker

/// Clean, searchable bank list presented as a sheet. Each row = a
/// letter-avatar (the bank's first initial in a rounded square,
/// `accentSoft` bg / `accent` text) + the bank name, with a checkmark on
/// the selected one. Tapping a row selects it and dismisses.
private struct BankPickerSheet: View {
    let banks: [OfframpBank]
    let selected: OfframpBank?
    let onSelect: (OfframpBank) -> Void

    @State private var query = ""
    @Environment(\.dismiss) private var dismiss

    private var filtered: [OfframpBank] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return banks }
        return banks.filter { $0.name.lowercased().contains(q) }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Grabber + title.
            HStack {
                Text("Select bank")
                    .font(TaliseFont.heading(18, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                        .frame(width: 30, height: 30)
                        .background(Circle().fill(TaliseColor.surface2))
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 12)

            // Search field.
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(TaliseColor.fgMuted)
                TextField("", text: $query, prompt: Text("Search banks").foregroundColor(TaliseColor.fgDim))
                    .font(TaliseFont.body(15))
                    .foregroundStyle(TaliseColor.fg)
                    .autocorrectionDisabled()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .fieldSurface()
            .padding(.horizontal, 20)
            .padding(.bottom, 8)

            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(filtered) { bank in
                        Button {
                            onSelect(bank)
                            dismiss()
                        } label: {
                            HStack(spacing: 12) {
                                BankAvatar(bankCode: bank.bankCode, bankName: bank.name, size: 36, cornerRadius: 10)
                                Text(bank.name)
                                    .font(TaliseFont.body(15))
                                    .foregroundStyle(TaliseColor.fg)
                                Spacer()
                                if bank.bankCode == selected?.bankCode {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundStyle(TaliseColor.accent)
                                }
                            }
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, 4)
            }
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

// MARK: - Flat field treatment

/// Flat input-field surface for the bank-form fields: a solid
/// `TaliseColor.surface` plate with a 1px `TaliseColor.line` hairline and
/// continuous corners — no material, no blur, no gradient. Keeps every
/// field visually identical without repeating the recipe at each call site.
private struct FieldSurface: ViewModifier {
    var cornerRadius: CGFloat = 16

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        return content
            .background(shape.fill(TaliseColor.surface))
            .overlay(shape.strokeBorder(TaliseColor.line, lineWidth: 1))
            .clipShape(shape)
    }
}

private extension View {
    func fieldSurface(cornerRadius: CGFloat = 16) -> some View {
        modifier(FieldSurface(cornerRadius: cornerRadius))
    }
}

/// Clean, brand-mint loading ring — a comet-tail arc that fades from
/// transparent into solid mint and spins smoothly. No grey backdrop, no
/// system `ProgressView` dashes. Reusable across money flows.
struct TaliseLoadingRing: View {
    var size: CGFloat = 64
    var lineWidth: CGFloat = 3.5
    /// Active arc colour — defaults to the mint accent that reads on dark.
    var color: Color = TaliseColor.greenMint

    @State private var spinning = false

    var body: some View {
        ZStack {
            // Faint full-circle track — adapts to the surface (light on dark,
            // dark on light) without any filled grey disc behind it.
            Circle()
                .stroke(TaliseColor.fg.opacity(0.08), lineWidth: lineWidth)

            // Comet-tail arc: angular gradient from clear → solid mint so the
            // leading edge is crisp and the tail dissolves.
            Circle()
                .trim(from: 0, to: 0.92)
                .stroke(
                    AngularGradient(
                        gradient: Gradient(colors: [color.opacity(0), color]),
                        center: .center
                    ),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(spinning ? 360 : 0))
        }
        .frame(width: size, height: size)
        .onAppear {
            withAnimation(.linear(duration: 1.0).repeatForever(autoreverses: false)) {
                spinning = true
            }
        }
    }
}
