import SwiftUI
import UIKit

struct RewardsView: View {
    @State private var summary: RewardsSummary?
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 22) {
                header
                statsRow
                referralCard
                recentSection
                if let error {
                    Text(error)
                        .font(TaliseFont.body(12, weight: .light))
                        .foregroundStyle(TaliseColor.danger)
                }
                Spacer(minLength: 120)
            }
            .padding(.horizontal, 24)
            .padding(.top, 24)
        }
        .refreshable { await load() }
        .taliseScreenBackground()
        .task { await load() }
    }

    // MARK: - Sections

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            MicroLabel(text: "Rewards", color: TaliseColor.fgDim).kerning(1.5)
            Text("Refer & earn")
                .font(TaliseFont.heading(28, weight: .medium))
                .kerning(-1)
                .foregroundStyle(TaliseColor.fg)
        }
    }

    private var statsRow: some View {
        HStack(spacing: 12) {
            statTile(label: "Points",    value: "\(summary?.pointsTotal ?? 0)", accent: true)
            statTile(label: "Referrals", value: "\(summary?.referralCount ?? 0)")
        }
    }

    private func statTile(label: String, value: String, accent: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            MicroLabel(text: label, color: TaliseColor.fgDim).kerning(1.5)
            Text(value)
                .font(TaliseFont.heading(28, weight: .medium))
                .kerning(-1)
                .foregroundStyle(accent ? TaliseColor.accent : TaliseColor.fg)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TaliseColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 22))
    }

    @ViewBuilder
    private var referralCard: some View {
        if let code = summary?.code {
            VStack(alignment: .leading, spacing: 14) {
                MicroLabel(text: "Your referral code", color: TaliseColor.fgDim).kerning(1.5)
                HStack {
                    Text(code)
                        .font(TaliseFont.mono(15, weight: .light))
                        .foregroundStyle(TaliseColor.fg)
                    Spacer()
                    Button {
                        UIPasteboard.general.string = "https://talise.io/r/\(code)"
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "doc.on.doc")
                                .font(.system(size: 11, weight: .medium))
                            Text("Copy")
                                .font(TaliseFont.heading(12, weight: .medium))
                        }
                        .foregroundStyle(TaliseColor.fg)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(TaliseColor.surface2)
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
                Button {
                    share(text: "Join me on Talise: https://talise.io/r/\(code)")
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 13, weight: .medium))
                        Text("Share Talise")
                            .font(TaliseFont.heading(14, weight: .medium))
                    }
                    .foregroundStyle(TaliseColor.bg)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background(TaliseColor.fg)
                    .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
            .padding(18)
            .background(TaliseColor.usernameCard)
            .clipShape(RoundedRectangle(cornerRadius: 22))
        }
    }

    @ViewBuilder
    private var recentSection: some View {
        if let events = summary?.recentEvents, !events.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                MicroLabel(text: "Recent", color: TaliseColor.fgDim).kerning(1.5)
                VStack(spacing: 0) {
                    ForEach(Array(events.enumerated()), id: \.element.id) { idx, event in
                        eventRow(event)
                        if idx < events.count - 1 {
                            Rectangle().fill(Color.white.opacity(0.05))
                                .frame(height: 1).padding(.horizontal, 12)
                        }
                    }
                }
                .background(TaliseColor.surface)
                .clipShape(RoundedRectangle(cornerRadius: 22))
            }
        } else if !loading {
            VStack(spacing: 6) {
                Text("No referrals yet")
                    .font(TaliseFont.body(14, weight: .light))
                    .foregroundStyle(TaliseColor.fg)
                Text("Share your code — every friend you onboard earns you points.")
                    .font(TaliseFont.mono(10, weight: .light))
                    .foregroundStyle(TaliseColor.fgDim)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 24)
            .background(TaliseColor.surface)
            .clipShape(RoundedRectangle(cornerRadius: 22))
        }
    }

    private func eventRow(_ event: RewardsEvent) -> some View {
        HStack {
            Text(event.kind.replacingOccurrences(of: "_", with: " ").capitalized)
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fg)
            Spacer()
            Text("+\(event.points)")
                .font(TaliseFont.heading(14, weight: .medium))
                .foregroundStyle(TaliseColor.accent)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    // MARK: - Data

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
