import SwiftUI
import UIKit

/// My requests — the list of payment links I've minted, with status (open /
/// paid / cancelled / expired) and a cancel action for open ones. A prominent
/// "New request" button pushes the create flow.
///
/// Presented inside the parent NavigationStack (no stack of its own), like
/// PayrollView: it pushes RequestCreateView and reloads on every appearance.
struct RequestsListView: View {
    @State private var requests: [RequestDTO] = []
    @State private var loading = true
    @State private var loaded = false
    @State private var error: String?
    @State private var busyId: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header

                NavigationLink {
                    RequestCreateView()
                } label: {
                    newRequestLabel
                }
                .buttonStyle(.plain)

                if loading && !loaded {
                    loadingState
                } else if let error {
                    errorState(error)
                } else if requests.isEmpty {
                    emptyState
                } else {
                    VStack(spacing: 12) {
                        ForEach(requests) { req in requestRow(req) }
                    }
                }

                Color.clear.frame(height: 28)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("REQUESTS")
                .font(TaliseFont.mono(10, weight: .regular)).kerning(1.4)
                .foregroundStyle(TaliseColor.fgDim)
            Text("Request money")
                .font(TaliseFont.heading(26, weight: .medium)).kerning(-0.6)
                .foregroundStyle(TaliseColor.fg)
            Text("Mint a link to ask anyone for a set amount — share it, and they pay you straight to your wallet.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 4)
    }

    private var newRequestLabel: some View {
        HStack(spacing: 10) {
            Image(systemName: "plus")
                .font(.system(size: 14, weight: .semibold)).foregroundStyle(.black)
            Text("New request")
                .font(TaliseFont.body(16, weight: .semibold)).foregroundStyle(.black)
        }
        .frame(maxWidth: .infinity).frame(height: 54)
        .background(Capsule().fill(TaliseColor.greenMint))
    }

    // MARK: - Request row

    private func requestRow(_ req: RequestDTO) -> some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(statusTint(req).opacity(0.12))
                    .frame(width: 46, height: 46)
                Image(systemName: statusIcon(req))
                    .font(.system(size: 17, weight: .regular))
                    .foregroundStyle(statusTint(req))
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(TaliseFormat.usd2(req.amountUsd))
                    .font(TaliseFont.heading(16, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                if let n = req.requesterNote, !n.isEmpty {
                    Text(n)
                        .font(TaliseFont.body(12.5, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted).lineLimit(1)
                } else {
                    Text(req.payUrl.replacingOccurrences(of: "https://www.", with: ""))
                        .font(TaliseFont.mono(11, weight: .regular))
                        .foregroundStyle(TaliseColor.fgDim).lineLimit(1).truncationMode(.middle)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 6) {
                Text(statusLabel(req))
                    .font(TaliseFont.mono(10, weight: .regular)).kerning(0.8)
                    .foregroundStyle(statusTint(req))
                if req.isOpen {
                    Button {
                        share(text: req.payUrl)
                    } label: {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(TaliseColor.fg)
                            .frame(width: 34, height: 34)
                            .background(Circle().fill(TaliseColor.surface2))
                    }
                    .buttonStyle(.plain)
                }
            }
            if busyId == req.id {
                ProgressView().tint(TaliseColor.fgMuted).frame(width: 18, height: 18)
            }
        }
        .padding(16)
        .rampCard()
        .opacity(busyId == req.id ? 0.5 : 1)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            if req.isOpen {
                Button(role: .destructive) {
                    Task { await cancel(req) }
                } label: {
                    Label("Cancel", systemImage: "xmark.circle")
                }
            }
        }
        .contextMenu {
            Button {
                UIPasteboard.general.string = req.payUrl
            } label: {
                Label("Copy link", systemImage: "doc.on.doc")
            }
            if req.isOpen {
                Button(role: .destructive) {
                    Task { await cancel(req) }
                } label: {
                    Label("Cancel request", systemImage: "xmark.circle")
                }
            }
        }
    }

    private func statusLabel(_ req: RequestDTO) -> String { req.status.uppercased() }

    private func statusTint(_ req: RequestDTO) -> Color {
        switch req.status {
        case "paid": return TaliseColor.greenMint
        case "open": return TaliseColor.accent
        default: return TaliseColor.fgDim   // cancelled / expired
        }
    }

    private func statusIcon(_ req: RequestDTO) -> String {
        switch req.status {
        case "paid": return "checkmark.seal.fill"
        case "open": return "link"
        case "cancelled": return "xmark.circle"
        default: return "clock.badge.xmark"  // expired
        }
    }

    // MARK: - States

    private var loadingState: some View {
        VStack(spacing: 12) {
            ForEach(0..<3, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(TaliseColor.surface).frame(height: 78)
                    .redacted(reason: .placeholder)
            }
        }
        .overlay(ProgressView().tint(TaliseColor.fgMuted))
    }

    private func errorState(_ msg: String) -> some View {
        VStack(spacing: 14) {
            Text(msg)
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .multilineTextAlignment(.center)
            Button {
                Task { await load() }
            } label: {
                Text("Try again")
                    .font(TaliseFont.body(15, weight: .semibold)).foregroundStyle(.black)
                    .padding(.horizontal, 24).frame(height: 46)
                    .background(Capsule().fill(TaliseColor.greenMint))
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity).padding(.top, 50)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "qrcode")
                .font(.system(size: 38, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
            Text("No requests yet")
                .font(TaliseFont.heading(18, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
            Text("Create one to ask someone for a set amount.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
        }
        .frame(maxWidth: .infinity).padding(.top, 44)
    }

    // MARK: - Actions

    private func load() async {
        if requests.isEmpty { loading = true }
        error = nil
        defer { loading = false; loaded = true }
        do {
            requests = try await RequestsAPI.list()
        } catch {
            if APIError.isCancellation(error) { return }
            self.error = "Couldn't load your requests right now."
        }
    }

    private func cancel(_ req: RequestDTO) async {
        busyId = req.id
        defer { busyId = nil }
        do {
            try await RequestsAPI.cancel(id: req.id)
            await load()
        } catch {
            if APIError.isCancellation(error) { return }
            self.error = "Couldn't cancel that request. Please try again."
        }
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
