import SwiftUI

struct RewardsView: View {
    @State private var summary: RewardsSummary?
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    PageHeader(eyebrow: "Rewards", title: "Refer & earn")

                    HStack(spacing: 12) {
                        StatCard(eyebrow: "Points", value: "\(summary?.pointsTotal ?? 0)")
                        StatCard(eyebrow: "Referrals", value: "\(summary?.referralCount ?? 0)")
                    }

                    if let code = summary?.code {
                        VStack(alignment: .leading, spacing: 8) {
                            Eyebrow(text: "Your code")
                            HStack {
                                Text(code)
                                    .font(TaliseFont.mono(15))
                                    .foregroundStyle(TaliseColor.fg)
                                Spacer()
                                TaliseButton(title: "Share", variant: .secondary, size: .sm, icon: "square.and.arrow.up") {
                                    share(text: "Join me on Talise: https://talise.io/r/\(code)")
                                }
                            }
                            .padding(14)
                            .background(TaliseColor.surface)
                            .overlay(
                                RoundedRectangle(cornerRadius: TaliseRadius.md)
                                    .stroke(TaliseColor.line, lineWidth: 1)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: TaliseRadius.md))
                        }
                    }

                    if let events = summary?.recentEvents, !events.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader(title: "Recent")
                            ForEach(events) { event in
                                HStack {
                                    Text(event.kind.replacingOccurrences(of: "_", with: " ").capitalized)
                                        .font(TaliseFont.body(14))
                                        .foregroundStyle(TaliseColor.fg)
                                    Spacer()
                                    Text("+\(event.points)")
                                        .font(TaliseFont.heading(14))
                                        .foregroundStyle(TaliseColor.success)
                                }
                                .padding(.vertical, 10)
                                Divider().background(TaliseColor.line)
                            }
                        }
                        .padding(.horizontal, 16)
                        .background(TaliseColor.surface)
                        .overlay(
                            RoundedRectangle(cornerRadius: TaliseRadius.lg)
                                .stroke(TaliseColor.line, lineWidth: 1)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: TaliseRadius.lg))
                    }

                    if let error {
                        Text(error)
                            .font(TaliseFont.body(12))
                            .foregroundStyle(TaliseColor.danger)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
            .navigationBarHidden(true)
            .background(TaliseColor.bg)
            .task { await load() }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            summary = try await APIClient.shared.get("/api/referral/summary")
        } catch {
            self.error = error.localizedDescription
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
