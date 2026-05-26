import SwiftUI

struct KYCView: View {
    let user: UserDTO
    @Environment(AppSession.self) private var session
    @State private var country: String = "NG"
    @State private var accountType: AccountType = .personal
    @State private var submitting = false
    @State private var error: String?

    private let countries: [(String, String)] = [
        ("NG", "Nigeria"),
        ("US", "United States"),
        ("GB", "United Kingdom"),
        ("OTHER", "Other"),
    ]

    var body: some View {
        ZStack {
            TaliseColor.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 32) {
                    VStack(alignment: .leading, spacing: 12) {
                        Eyebrow(text: "Verify · 1 of 1")
                        Text("Finish setting up your account")
                            .font(TaliseFont.heading(28))
                            .foregroundStyle(TaliseColor.fg)
                        Text("We verified your Google account. One last step: tell us where you'll be using Talise, and whether this is for you or your business.")
                            .font(TaliseFont.body(14))
                            .foregroundStyle(TaliseColor.fgMuted)
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Eyebrow(text: "Country")
                        VStack(spacing: 0) {
                            ForEach(countries, id: \.0) { code, name in
                                row(code: code, name: name)
                                if code != countries.last?.0 {
                                    LiquidGlassDivider()
                                }
                            }
                        }
                        .taliseGlass(cornerRadius: TaliseRadius.lg)
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Eyebrow(text: "Account type")
                        HStack(spacing: 12) {
                            typeTile(.personal, title: "Personal", sub: "Send, receive, earn")
                            typeTile(.business, title: "Business", sub: "Invoices, payroll")
                        }
                    }

                    if let error {
                        Text(error)
                            .font(TaliseFont.body(12))
                            .foregroundStyle(TaliseColor.danger)
                    }

                    LiquidGlassButton(
                        title: "Continue",
                        size: .lg,
                        loading: submitting
                    ) {
                        Task { await submit() }
                    }
                    .padding(.top, 8)
                }
                .padding(24)
            }
        }
    }

    private func row(code: String, name: String) -> some View {
        Button {
            country = code
        } label: {
            HStack {
                Text(name)
                    .font(TaliseFont.body(14))
                    .foregroundStyle(TaliseColor.fg)
                Spacer()
                if country == code {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(TaliseColor.fg)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func typeTile(_ type: AccountType, title: String, sub: String) -> some View {
        let selected = accountType == type
        return Button {
            accountType = type
        } label: {
            tileLabel(title: title, sub: sub, selected: selected)
        }
        .buttonStyle(.plain)
    }

    /// Selected = solid white pill (deliberate picker affordance, keep
    /// as-is). Unselected = neutral glass — backdrop refresh from the
    /// previous flat `TaliseColor.surface`.
    @ViewBuilder
    private func tileLabel(title: String, sub: String, selected: Bool) -> some View {
        let content = VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(TaliseFont.heading(15))
                .foregroundStyle(selected ? TaliseColor.bg : TaliseColor.fg)
            Text(sub)
                .font(TaliseFont.body(12))
                .foregroundStyle(selected ? TaliseColor.bg.opacity(0.7) : TaliseColor.fgMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        if selected {
            content
                .background(TaliseColor.fg)
                .clipShape(RoundedRectangle(cornerRadius: TaliseRadius.md))
        } else {
            content.taliseGlass(cornerRadius: TaliseRadius.md)
        }
    }

    private func submit() async {
        submitting = true
        defer { submitting = false }
        struct OnboardBody: Encodable {
            let country: String
            let accountType: String
        }
        struct OnboardResp: Decodable { let ok: Bool }
        do {
            let _: OnboardResp = try await APIClient.shared.post(
                "/api/onboarding",
                body: OnboardBody(country: country, accountType: accountType.rawValue)
            )

            // Sponsored SuiNS subname mint — the talise.sui operator wallet
            // signs + pays gas, so the user is never asked to fund or sign
            // this transaction. Best-effort: if the handle is taken or the
            // operator is misconfigured, we still proceed to the dashboard
            // (the user can claim later from /settings).
            await claimTaliseHandle()

            await session.bootstrap()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Derives a candidate handle from the user's Google name (falling back
    /// to the email local-part), then POSTs /api/username/claim. On a
    /// collision (HTTP 409), we append a 4-digit suffix and retry up to
    /// three times.
    private func claimTaliseHandle() async {
        let base = candidateHandle()
        guard !base.isEmpty else { return }

        struct ClaimBody: Encodable { let username: String }
        var attempt = 0
        var handle = base
        while attempt < 3 {
            do {
                let _: UsernameClaimResponse = try await APIClient.shared.post(
                    "/api/username/claim",
                    body: ClaimBody(username: handle)
                )
                return
            } catch APIError.status(let code, _) where code == 409 {
                // Taken — append a short numeric suffix and try again.
                let suffix = String(Int.random(in: 100...9999))
                handle = String((base + suffix).prefix(20))
                attempt += 1
            } catch {
                // Operator down / RPC flake — fail silently. User keeps
                // the wallet, just no on-chain handle yet.
                return
            }
        }
    }

    private func candidateHandle() -> String {
        // Prefer first word of display name; fall back to the email local-part.
        let source: String = {
            let name = (user.name ?? "").trimmingCharacters(in: .whitespaces)
            if !name.isEmpty,
               let first = name.split(separator: " ").first {
                return String(first)
            }
            if let local = user.email.split(separator: "@").first {
                return String(local)
            }
            return ""
        }()
        // Normalize to what SuiNS accepts: [a-z0-9_] 3-20 chars.
        let normalized = source
            .lowercased()
            .unicodeScalars
            .filter { CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789_").contains($0) }
            .map(String.init)
            .joined()
        return String(normalized.prefix(20))
    }
}
