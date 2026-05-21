import SwiftUI

struct SendView: View {
    @State private var recipient = ""
    @State private var amount = ""
    @State private var asset = "USDsui"
    @State private var resolved: RecipientResolution?
    @State private var resolving = false
    @State private var sending = false
    @State private var error: String?
    @State private var lastDigest: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    PageHeader(eyebrow: "Send", title: "Send money")

                    VStack(alignment: .leading, spacing: 8) {
                        Eyebrow(text: "Recipient")
                        TextField("name.talise.sui or 0x…", text: $recipient)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .font(TaliseFont.body(15))
                            .padding(14)
                            .background(TaliseColor.surface)
                            .overlay(
                                RoundedRectangle(cornerRadius: TaliseRadius.md)
                                    .stroke(TaliseColor.line, lineWidth: 1)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: TaliseRadius.md))
                            .onChange(of: recipient) { _, new in
                                Task { await resolve(new) }
                            }
                        if resolving {
                            Text("Resolving…")
                                .font(TaliseFont.body(11))
                                .foregroundStyle(TaliseColor.fgDim)
                        } else if let resolved {
                            Text(resolved.display)
                                .font(TaliseFont.mono(11))
                                .foregroundStyle(TaliseColor.success)
                        }
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Eyebrow(text: "Amount")
                        HStack {
                            TextField("0.00", text: $amount)
                                .keyboardType(.decimalPad)
                                .font(TaliseFont.heading(28))
                            Spacer()
                            Text(asset)
                                .font(TaliseFont.heading(15))
                                .foregroundStyle(TaliseColor.fgMuted)
                        }
                        .padding(14)
                        .background(TaliseColor.surface)
                        .overlay(
                            RoundedRectangle(cornerRadius: TaliseRadius.md)
                                .stroke(TaliseColor.line, lineWidth: 1)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: TaliseRadius.md))
                    }

                    if let error {
                        Text(error)
                            .font(TaliseFont.body(12))
                            .foregroundStyle(TaliseColor.danger)
                    }

                    if let lastDigest {
                        Text("Sent: \(lastDigest.prefix(12))…")
                            .font(TaliseFont.mono(11))
                            .foregroundStyle(TaliseColor.success)
                    }

                    TaliseButton(
                        title: sendable ? "Send \(amount) \(asset)" : "Send",
                        variant: .primary,
                        size: .lg,
                        icon: "arrow.up.right",
                        loading: sending
                    ) {
                        Task { await send() }
                    }
                    .disabled(!sendable)
                    .padding(.top, 8)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
            .navigationBarHidden(true)
            .background(TaliseColor.bg)
        }
    }

    private var sendable: Bool {
        resolved != nil && (Double(amount) ?? 0) > 0 && !sending
    }

    private func resolve(_ input: String) async {
        guard input.count > 2 else { resolved = nil; return }
        resolving = true
        defer { resolving = false }
        struct Body: Encodable { let query: String }
        do {
            resolved = try await APIClient.shared.post(
                "/api/recipient/resolve",
                body: Body(query: input)
            )
        } catch {
            resolved = nil
        }
    }

    private func send() async {
        guard let resolved else { return }
        sending = true
        defer { sending = false }
        // 1. Build PTB via SuiKit (transfer USDsui to resolved.address)
        // 2. POST /api/zk/sponsor → { txBytes, sponsorSignature }
        // 3. EphemeralKeyStore.signRaw(txBytes, reason: "Send \(amount) \(asset)")
        // 4. Assemble zkLogin signature with cached proof
        // 5. POST /api/zk/sponsor-execute → { digest }
        // TODO: wire to ZkLoginCoordinator once SuiKit PTB helpers are in.
        error = "Send is wired but the PTB builder is pending SuiKit integration."
        _ = resolved
    }
}
