import SwiftUI
import UIKit

/// Create a payment request — "ask anyone for $X". Enter an amount and an
/// optional note, mint a shareable link (talise.io/req/<id>), then share it as
/// a link / QR / system share sheet. Whoever opens it pays you directly.
///
/// Presented inside the parent NavigationStack (no stack of its own), like the
/// Payroll editor. On create we flip to a "share" screen with the link + QR.
struct RequestCreateView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var amount: String = ""
    @State private var note: String = ""

    @State private var creating = false
    @State private var error: String?

    // Post-create.
    @State private var created: RequestCreateResponse?
    @State private var copied = false

    private var amountValue: Double { Double(amount.trimmingCharacters(in: .whitespaces)) ?? 0 }
    private var trimmedNote: String { note.trimmingCharacters(in: .whitespaces) }
    private var canCreate: Bool { amountValue > 0 && !creating }

    var body: some View {
        if let created {
            shareView(created)
        } else {
            form
        }
    }

    // MARK: - Form

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                amountCard
                noteCard

                if let error {
                    Text(error)
                        .font(TaliseFont.body(13, weight: .light))
                        .foregroundStyle(TaliseColor.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }

                createButton

                Text("You'll get a link anyone can open to pay you — no app required.")
                    .font(TaliseFont.mono(11, weight: .regular))
                    .foregroundStyle(TaliseColor.fgMuted)

                Color.clear.frame(height: 24)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .scrollDismissesKeyboard(.interactively)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("REQUEST")
                .font(TaliseFont.mono(10, weight: .regular)).kerning(1.4)
                .foregroundStyle(TaliseColor.fgDim)
            Text("Request money")
                .font(TaliseFont.heading(26, weight: .medium)).kerning(-0.6)
                .foregroundStyle(TaliseColor.fg)
            Text("Ask anyone for a set amount. Share a link or QR — they pay you straight to your wallet.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 4)
    }

    private var amountCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("AMOUNT")
                .font(TaliseFont.mono(10, weight: .regular)).kerning(0.6)
                .foregroundStyle(TaliseColor.fgDim)
            HStack(spacing: 4) {
                Text("$").font(TaliseFont.heading(22, weight: .medium)).foregroundStyle(TaliseColor.fgMuted)
                TextField("", text: $amount, prompt: Text("20.00").foregroundColor(TaliseColor.fgDim))
                    .font(TaliseFont.heading(22, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                    .keyboardType(.decimalPad)
            }
            .padding(.horizontal, 14).frame(height: 54)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(TaliseColor.surface2))
        }
        .padding(16)
        .rampCard()
    }

    private var noteCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("NOTE (OPTIONAL)")
                .font(TaliseFont.mono(10, weight: .regular)).kerning(0.6)
                .foregroundStyle(TaliseColor.fgDim)
            TextField("", text: $note, prompt: Text("e.g. Dinner last night").foregroundColor(TaliseColor.fgDim), axis: .vertical)
                .font(TaliseFont.body(15, weight: .regular))
                .foregroundStyle(TaliseColor.fg)
                .lineLimit(1...4)
                .padding(.horizontal, 14).padding(.vertical, 14)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(TaliseColor.surface2))
        }
        .padding(16)
        .rampCard()
    }

    private var createButton: some View {
        Button {
            Task { await create() }
        } label: {
            HStack(spacing: 8) {
                if creating { ProgressView().tint(.black) }
                Text(creating ? "Creating…" : "Create request")
            }
            .font(TaliseFont.body(16, weight: .semibold)).foregroundStyle(.black)
            .frame(maxWidth: .infinity).frame(height: 54)
            .background(Capsule().fill(canCreate ? TaliseColor.greenMint : TaliseColor.surface2))
        }
        .buttonStyle(.plain)
        .disabled(!canCreate)
        .opacity(canCreate ? 1 : 0.6)
    }

    // MARK: - Share

    private func shareView(_ res: RequestCreateResponse) -> some View {
        ScrollView {
            VStack(spacing: 18) {
                VStack(spacing: 6) {
                    Text("Requesting")
                        .font(TaliseFont.mono(10, weight: .regular)).kerning(1.4)
                        .foregroundStyle(TaliseColor.fgDim)
                    Text(TaliseFormat.usd2(res.request.amountUsd))
                        .font(TaliseFont.heading(40, weight: .medium)).kerning(-1)
                        .foregroundStyle(TaliseColor.fg)
                    if let n = res.request.requesterNote, !n.isEmpty {
                        Text(n)
                            .font(TaliseFont.body(14, weight: .light))
                            .foregroundStyle(TaliseColor.fgMuted)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(.top, 16)

                // QR card — the payable link, encoded.
                VStack(spacing: 16) {
                    QRView(content: res.payUrl)
                        .frame(width: 220, height: 220)
                        .padding(18)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    Text(prettyLink(res.payUrl))
                        .font(TaliseFont.mono(12.5, weight: .light))
                        .foregroundStyle(TaliseColor.fg)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .padding(.vertical, 26)
                .frame(maxWidth: .infinity)
                .background(RoundedRectangle(cornerRadius: 28, style: .continuous).fill(TaliseColor.surface))
                .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))

                HStack(spacing: 12) {
                    actionButton(
                        icon: copied ? "checkmark" : "doc.on.doc",
                        label: copied ? "Copied" : "Copy link",
                        primary: false
                    ) {
                        UIPasteboard.general.string = res.payUrl
                        withAnimation(.easeInOut(duration: 0.15)) { copied = true }
                        Task {
                            try? await Task.sleep(nanoseconds: 1_500_000_000)
                            await MainActor.run { copied = false }
                        }
                    }
                    actionButton(icon: "square.and.arrow.up", label: "Share", primary: true) {
                        share(text: res.payUrl)
                    }
                }

                Button { dismiss() } label: {
                    Text("Done")
                        .font(TaliseFont.body(14))
                        .foregroundStyle(TaliseColor.fgMuted)
                }
                .buttonStyle(.plain)
                .padding(.top, 4)

                Color.clear.frame(height: 24)
            }
            .padding(.horizontal, 20)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func actionButton(icon: String, label: String, primary: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 13, weight: .medium))
                Text(label).font(TaliseFont.heading(14, weight: .medium))
            }
            .foregroundStyle(primary ? TaliseColor.bg : TaliseColor.fg)
            .frame(maxWidth: .infinity).frame(height: 48)
            .background(Capsule().fill(primary ? TaliseColor.fg : TaliseColor.surface2))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Actions

    private func create() async {
        guard canCreate else { return }
        creating = true; error = nil
        defer { creating = false }
        do {
            let res = try await RequestsAPI.create(
                amountUsd: amountValue,
                currency: nil,
                note: trimmedNote.isEmpty ? nil : trimmedNote
            )
            withAnimation { created = res }
        } catch {
            if APIError.isCancellation(error) { return }
            self.error = APIError.honestMoneyError(error, fallback: "Couldn't create that request. Please try again.")
        }
    }

    /// Drop the scheme for a tidy on-card label ("talise.io/req/…").
    private func prettyLink(_ url: String) -> String {
        url.replacingOccurrences(of: "https://", with: "")
            .replacingOccurrences(of: "http://", with: "")
            .replacingOccurrences(of: "www.", with: "")
    }

    private func share(text: String) {
        let activity = UIActivityViewController(activityItems: [text], applicationActivities: nil)
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }?
            .rootViewController?
            .present(activity, animated: true)
    }
}
