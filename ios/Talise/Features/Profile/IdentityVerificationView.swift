import SwiftUI

/// Identity verification (Bridge KYC), surfaced from Profile.
///
/// Flow:
///   1. Load current status (GET /api/kyc/bridge/status).
///   2. "Verify identity" → POST /api/kyc/bridge/start, then open the hosted
///      KYC + Terms-of-Service links in Safari.
///   3. Poll status while it's in review; flip to a success state on approval.
///
/// Verifying here unlocks USD/EUR cash-out — one Bridge customer covers both
/// directions. No PII flows through Talise; Bridge runs the whole flow.
struct IdentityVerificationView: View {
    @Environment(\.openURL) private var openURL

    @State private var loading = true
    @State private var working = false           // start() in flight
    @State private var status: KYCStatus = .unverified
    @State private var kycUrl: String?
    @State private var tosUrl: String?
    @State private var error: String?
    @State private var polling = false
    /// The Bridge/Persona URL presented in-app via SFSafariViewController.
    @State private var safariLink: KYCLink?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header
                if loading {
                    loadingCard
                } else {
                    statusCard
                    switch status {
                    case .approved:
                        approvedCard
                    case .pending:
                        pendingCard
                    case .rejected, .expired:
                        actionCard(retry: true)
                    case .unverified:
                        actionCard(retry: false)
                    }
                    if let error {
                        Text(error)
                            .font(TaliseFont.body(13, weight: .light))
                            .foregroundStyle(Color(hex: 0xFF6B6B))
                            .fixedSize(horizontal: false, vertical: true)
                    }
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
        // Run Bridge/Persona identity verification IN-APP (SFSafariViewController
        // = Safari's process → full WebKit + camera). Bouncing to the external
        // browser via openURL left the inquiry sections unresponsive. On dismiss
        // we re-check status so an approval flips the card immediately.
        .fullScreenCover(item: $safariLink, onDismiss: { Task { await refresh() } }) { link in
            SafariView(url: link.url).ignoresSafeArea()
        }
    }

    // MARK: - Sections

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Identity verification")
                .font(TaliseFont.heading(22, weight: .medium))
                .kerning(-0.4)
                .foregroundStyle(TaliseColor.fg)
            Text("A one-time check that unlocks cashing out to your bank. Your details go straight to our payments partner — Talise never stores them.")
                .font(TaliseFont.body(13.5, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 4)
    }

    private var loadingCard: some View {
        HStack(spacing: 12) {
            ProgressView().tint(TaliseColor.greenMint)
            Text("Checking your status…")
                .font(TaliseFont.body(14, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
            Spacer(minLength: 0)
        }
        .padding(18)
        .rampCard()
    }

    /// A status chip row, always shown once loaded.
    private var statusCard: some View {
        HStack(spacing: 12) {
            Image(systemName: statusIcon)
                .font(.system(size: 20, weight: .regular))
                .foregroundStyle(statusColor)
            VStack(alignment: .leading, spacing: 2) {
                Text("STATUS")
                    .font(TaliseFont.mono(10, weight: .regular)).kerning(1)
                    .foregroundStyle(TaliseColor.fgDim)
                Text(status.label)
                    .font(TaliseFont.heading(17, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
            }
            Spacer(minLength: 0)
            if polling { ProgressView().tint(TaliseColor.greenMint) }
        }
        .padding(18)
        .rampCard()
    }

    private var approvedCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("You're verified", systemImage: "checkmark.seal.fill")
                .font(TaliseFont.heading(16, weight: .semibold))
                .foregroundStyle(TaliseColor.greenMint)
            Text("Cash-out to your bank is unlocked. You can withdraw from any supported corridor.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .rampCard()
    }

    private var pendingCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("We're reviewing your details. This usually takes a few minutes. You can close this screen — we'll keep checking.")
                .font(TaliseFont.body(13.5, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
            if kycUrl != nil || tosUrl != nil {
                openLinksRow
            }
            Button { Task { await refresh() } } label: {
                Text("Refresh status")
                    .font(TaliseFont.body(15, weight: .semibold)).foregroundStyle(.black)
                    .frame(maxWidth: .infinity).frame(height: 50)
                    .background(Capsule().fill(TaliseColor.greenMint))
            }
            .buttonStyle(.plain)
        }
        .padding(18)
        .rampCard()
    }

    /// The "start (or retry) verification" call-to-action.
    private func actionCard(retry: Bool) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(retry
                 ? "Your last attempt didn't go through. You can try again — make sure your name matches your government ID."
                 : "You'll verify your identity and accept the terms with our payments partner. Two quick steps in your browser.")
                .font(TaliseFont.body(13.5, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)

            // If links already exist (start was tapped), surface them.
            if kycUrl != nil || tosUrl != nil { openLinksRow }

            Button { Task { await beginVerification() } } label: {
                HStack(spacing: 8) {
                    if working { ProgressView().tint(.black) }
                    Text(working ? "Preparing…" : (retry ? "Try again" : "Verify identity"))
                }
                .font(TaliseFont.body(16, weight: .semibold)).foregroundStyle(.black)
                .frame(maxWidth: .infinity).frame(height: 54)
                .background(Capsule().fill(TaliseColor.greenMint))
            }
            .buttonStyle(.plain)
            .disabled(working)
            .opacity(working ? 0.7 : 1)
        }
        .padding(18)
        .rampCard()
    }

    /// Re-openable KYC + ToS link buttons (shown once `start` returns them).
    private var openLinksRow: some View {
        VStack(spacing: 10) {
            if let kycUrl, let url = URL(string: kycUrl) {
                linkButton("Verify identity", system: "person.text.rectangle") { safariLink = KYCLink(url: url) }
            }
            if let tosUrl, let url = URL(string: tosUrl) {
                linkButton("Review & accept terms", system: "doc.text") { safariLink = KYCLink(url: url) }
            }
        }
    }

    private func linkButton(_ title: String, system: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: system).font(.system(size: 13, weight: .medium))
                Text(title).font(TaliseFont.body(14.5, weight: .medium))
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.right").font(.system(size: 11, weight: .semibold))
            }
            .foregroundStyle(TaliseColor.fg)
            .padding(.horizontal, 16).frame(height: 48)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(TaliseColor.surface2))
        }
        .buttonStyle(.plain)
    }

    private var statusIcon: String {
        switch status {
        case .approved: return "checkmark.seal.fill"
        case .pending:  return "clock.fill"
        case .rejected, .expired: return "exclamationmark.triangle.fill"
        case .unverified: return "person.crop.circle.badge.questionmark"
        }
    }
    private var statusColor: Color {
        switch status {
        case .approved: return TaliseColor.greenMint
        case .pending:  return TaliseColor.fgMuted
        case .rejected, .expired: return Color(hex: 0xFF6B6B)
        case .unverified: return TaliseColor.fgMuted
        }
    }

    // MARK: - Actions

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let s = try await BridgeKYCAPI.status()
            status = KYCStatus(s.status)
            if status.isInFlight { startPolling() }
        } catch APIError.status(let code, _) where code == 503 {
            error = "Cash-out verification isn't switched on yet."
        } catch {
            // Soft-fail to unverified; the action card lets them start.
            status = .unverified
        }
    }

    /// Kick off (or re-fetch) the hosted KYC + ToS links and open them.
    private func beginVerification() async {
        guard !working else { return }
        working = true
        error = nil
        defer { working = false }
        do {
            let r = try await BridgeKYCAPI.start()
            status = KYCStatus(r.status)
            kycUrl = r.kycUrl
            tosUrl = r.tosUrl
            // Open the identity flow straight away; the ToS button stays
            // available below for the second step.
            if let s = r.kycUrl, let url = URL(string: s) {
                safariLink = KYCLink(url: url)
            } else if let s = r.tosUrl, let url = URL(string: s) {
                safariLink = KYCLink(url: url)
            }
            startPolling()
        } catch APIError.status(let code, _) where code == 503 {
            self.error = "Cash-out verification isn't switched on yet. Please try again soon."
        } catch APIError.status(let code, _) where code == 400 {
            self.error = "Add an email to your account first, then verify your identity."
        } catch APIError.status(let code, _) where code == 429 {
            self.error = "Too many attempts — wait a moment and try again."
        } catch APIError.unauthorized {
            self.error = "Your session expired. Sign out and back in, then try again."
        } catch {
            self.error = "Couldn't start verification. Please try again."
        }
    }

    private func refresh() async {
        do {
            let s = try await BridgeKYCAPI.status()
            status = KYCStatus(s.status)
        } catch { /* keep current status */ }
    }

    /// Poll every 8s while verification is in review; stops on a terminal state
    /// or when the view goes away (the Task is cancelled by `.task` teardown).
    private func startPolling() {
        guard !polling else { return }
        polling = true
        Task {
            defer { polling = false }
            for _ in 0..<60 {            // ~8 minutes max
                try? await Task.sleep(nanoseconds: 8_000_000_000)
                if Task.isCancelled { return }
                do {
                    let s = try await BridgeKYCAPI.status()
                    status = KYCStatus(s.status)
                } catch { continue }
                if status == .approved || status == .rejected { return }
            }
        }
    }
}

/// Identifiable wrapper so a Bridge/Persona URL can drive `.fullScreenCover(item:)`.
private struct KYCLink: Identifiable {
    let id = UUID()
    let url: URL
}
