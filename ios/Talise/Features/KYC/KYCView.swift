import SwiftUI

struct KYCView: View {
    let userId: String
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
                                    Divider().background(TaliseColor.line)
                                }
                            }
                        }
                        .background(TaliseColor.surface)
                        .overlay(
                            RoundedRectangle(cornerRadius: TaliseRadius.lg)
                                .stroke(TaliseColor.line, lineWidth: 1)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: TaliseRadius.lg))
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

                    TaliseButton(
                        title: "Continue",
                        variant: .primary,
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
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(TaliseFont.heading(15))
                    .foregroundStyle(selected ? TaliseColor.bg : TaliseColor.fg)
                Text(sub)
                    .font(TaliseFont.body(12))
                    .foregroundStyle(selected ? TaliseColor.bg.opacity(0.7) : TaliseColor.fgMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(selected ? TaliseColor.fg : TaliseColor.surface)
            .overlay(
                RoundedRectangle(cornerRadius: TaliseRadius.md)
                    .stroke(selected ? TaliseColor.fg : TaliseColor.line, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: TaliseRadius.md))
        }
        .buttonStyle(.plain)
    }

    private func submit() async {
        submitting = true
        defer { submitting = false }
        struct Body: Encodable {
            let country: String
            let accountType: String
        }
        do {
            struct Resp: Decodable { let ok: Bool }
            let _: Resp = try await APIClient.shared.post(
                "/api/onboarding",
                body: Body(country: country, accountType: accountType.rawValue)
            )
            await session.bootstrap()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
