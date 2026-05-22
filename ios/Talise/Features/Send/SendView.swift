import SwiftUI

/// End-to-end Send: resolve recipient (SuiNS or 0x address) → server-side
/// PTB build → ZkLoginCoordinator sponsored sign + submit. Presented as
/// a sheet from HomeView's paperplane action.
struct SendView: View {
    var onDone: (() -> Void)? = nil
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var recipient = ""
    @State private var amount = ""
    @State private var asset = "USDsui"
    @State private var resolved: RecipientResolution?
    @State private var resolveTask: Task<Void, Never>?
    @State private var resolving = false
    @State private var sending = false
    @State private var error: String?
    @State private var success: SendSuccess?

    private let supportedAssets = ["USDsui", "SUI"]

    var body: some View {
        ZStack {
            TaliseColor.bg.ignoresSafeArea()
            if let success {
                successView(success)
            } else {
                form
            }
        }
        .presentationDragIndicator(.visible)
    }

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header

                fieldBlock(title: "To") {
                    TextField("name.talise or 0x…", text: $recipient)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .font(TaliseFont.body(16, weight: .regular))
                        .foregroundStyle(TaliseColor.fg)
                        .tint(TaliseColor.accent)
                        .onChange(of: recipient) { _, new in
                            scheduleResolve(new)
                        }
                    resolveStatus
                }

                fieldBlock(title: "Amount") {
                    HStack(alignment: .firstTextBaseline) {
                        TextField("0.00", text: $amount)
                            .keyboardType(.decimalPad)
                            .font(TaliseFont.heading(34, weight: .medium))
                            .foregroundStyle(TaliseColor.fg)
                            .tint(TaliseColor.accent)
                        Spacer()
                        assetPicker
                    }
                }

                if let error {
                    Text(error)
                        .font(TaliseFont.body(12, weight: .light))
                        .foregroundStyle(TaliseColor.danger)
                        .padding(.horizontal, 4)
                }

                primaryButton

                Spacer(minLength: 80)
            }
            .padding(.horizontal, 24)
            .padding(.top, 16)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            MicroLabel(text: "Send", color: TaliseColor.fgDim).kerning(1.5)
            Text("Send money")
                .font(TaliseFont.heading(28, weight: .medium))
                .kerning(-1)
                .foregroundStyle(TaliseColor.fg)
        }
    }

    private func fieldBlock<C: View>(title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            MicroLabel(text: title, color: TaliseColor.fgDim).kerning(1.5)
            VStack(alignment: .leading, spacing: 8) {
                content()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(TaliseColor.usernameCard)
            .clipShape(RoundedRectangle(cornerRadius: 20))
        }
    }

    private var resolveStatus: some View {
        Group {
            if resolving {
                MicroLabel(text: "Resolving…", color: TaliseColor.fgDim)
            } else if let resolved {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(TaliseColor.accent)
                    Text(resolved.displayString)
                        .font(TaliseFont.mono(11, weight: .light))
                        .foregroundStyle(TaliseColor.accent)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            } else if recipient.count >= 3 {
                MicroLabel(text: "Not found", color: TaliseColor.danger)
            } else {
                Color.clear.frame(height: 14)
            }
        }
    }

    private var assetPicker: some View {
        Menu {
            ForEach(supportedAssets, id: \.self) { a in
                Button(a) { asset = a }
            }
        } label: {
            HStack(spacing: 4) {
                Text(asset)
                    .font(TaliseFont.heading(14, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(TaliseColor.surface2)
            .clipShape(Capsule())
        }
    }

    private var canSend: Bool {
        resolved != nil && (Double(amount) ?? 0) > 0 && !sending
    }

    private var primaryButton: some View {
        Button(action: { Task { await send() } }) {
            HStack(spacing: 10) {
                if sending {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(TaliseColor.bg)
                } else {
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 14, weight: .medium))
                        .rotationEffect(.degrees(-30))
                }
                Text(sending ? "Sending…" : sendLabel)
                    .font(TaliseFont.heading(15, weight: .medium))
            }
            .foregroundStyle(TaliseColor.bg)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(canSend ? TaliseColor.fg : TaliseColor.fg.opacity(0.35))
            .clipShape(Capsule())
        }
        .disabled(!canSend)
    }

    private var sendLabel: String {
        guard let amt = Double(amount), amt > 0 else { return "Send" }
        return "Send \(amount) \(asset)"
    }

    // MARK: - Success

    private struct SendSuccess {
        let digest: String
        let amount: String
        let asset: String
        let recipient: String
    }

    private func successView(_ s: SendSuccess) -> some View {
        VStack(spacing: 16) {
            Spacer()
            ZStack {
                Circle()
                    .fill(TaliseColor.accent.opacity(0.15))
                    .frame(width: 84, height: 84)
                Image(systemName: "checkmark")
                    .font(.system(size: 32, weight: .semibold))
                    .foregroundStyle(TaliseColor.accent)
            }
            Text("Sent")
                .font(TaliseFont.heading(28, weight: .medium))
                .kerning(-1)
                .foregroundStyle(TaliseColor.fg)
            Text("\(s.amount) \(s.asset) → \(short(s.recipient))")
                .font(TaliseFont.body(14, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
            MicroLabel(text: s.digest.prefix(20) + "…", color: TaliseColor.fgDim)
                .kerning(0.5)
            Spacer()
            Button(action: { onDone?(); dismiss() }) {
                Text("Done")
                    .font(TaliseFont.heading(15, weight: .medium))
                    .foregroundStyle(TaliseColor.bg)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(TaliseColor.fg)
                    .clipShape(Capsule())
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)
        }
    }

    private func short(_ a: String) -> String {
        guard a.count > 14 else { return a }
        return String(a.prefix(8)) + "…" + String(a.suffix(6))
    }

    // MARK: - Resolve

    private func scheduleResolve(_ input: String) {
        resolveTask?.cancel()
        resolved = nil
        let q = input.trimmingCharacters(in: .whitespaces)
        guard q.count >= 3 else { resolving = false; return }
        // Bare 0x addresses don't need a server round-trip.
        if let addr = SuiAddress(q) {
            resolved = RecipientResolution(
                address: addr.raw, displayName: addr.short,
                display: nil, source: "address"
            )
            resolving = false
            return
        }
        resolving = true
        resolveTask = Task {
            try? await Task.sleep(nanoseconds: 250_000_000)
            if Task.isCancelled { return }
            do {
                let encoded = q.addingPercentEncoding(
                    withAllowedCharacters: .urlQueryAllowed
                ) ?? q
                let r: RecipientResolution = try await APIClient.shared.get(
                    "/api/recipient/resolve?q=\(encoded)"
                )
                if Task.isCancelled { return }
                resolved = r
            } catch {
                if Task.isCancelled { return }
                resolved = nil
            }
            resolving = false
        }
    }

    // MARK: - Send

    private func send() async {
        guard let resolved, let amt = Double(amount), amt > 0 else { return }
        sending = true
        error = nil
        defer { sending = false }
        do {
            // 1. Build PTB kind bytes server-side.
            struct Body: Encodable {
                let to: String; let amount: Double; let asset: String
            }
            let built: BuildKindResponse = try await APIClient.shared.post(
                "/api/send/prepare",
                body: Body(to: resolved.address, amount: amt, asset: asset)
            )

            // 2. Sponsored sign + submit.
            let result = try await ZkLoginCoordinator.shared.signAndSubmit(
                transactionKindB64: built.transactionKindB64,
                intent: "Send \(amount) \(asset)"
            )

            success = SendSuccess(
                digest: result.digest,
                amount: amount,
                asset: asset,
                recipient: resolved.displayString
            )
        } catch {
            self.error = error.localizedDescription
        }
    }
}
