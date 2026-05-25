import SwiftUI
import UIKit

/// Phase 4 — Redemption catalogue.
///
/// Renders a 2-column grid of perks the user can spend `pointsTotal` on.
/// Cards: icon, label, point cost, "Redeem" button (disabled + showing
/// "X pts needed" when the user can't afford). Tap → confirm sheet →
/// `POST /api/rewards/redeem` → success haptic + parent refetch.
///
/// Sits at `// ANCHOR: redeem-section` in `RewardsView.swift`. Owns its
/// own load lifecycle (catalogue fetch is independent of the rewards
/// summary), but bubbles a successful redeem up via `onRedeemed` so the
/// parent can update its tier card / points balance.
struct RedemptionsSection: View {
    /// Current points balance, passed in from the parent so the section
    /// can render affordability before the catalogue endpoint resolves
    /// (the server also returns canAfford on each row — this is just
    /// the optimistic local hint).
    let pointsTotal: Int
    /// Fired after a successful redeem so the parent can `await load()`.
    let onRedeemed: () -> Void

    @State private var items: [RedeemSKU] = []
    @State private var loading = false
    @State private var error: String?
    @State private var confirming: RedeemSKU?
    @State private var redeemingSku: String?
    @State private var lastRedeemError: String?

    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                MicroLabel(text: "Redeem points", color: TaliseColor.fgDim).kerning(1.5)
                Spacer()
                if loading {
                    ProgressView()
                        .controlSize(.mini)
                        .tint(TaliseColor.fgMuted)
                }
            }

            if items.isEmpty && !loading && error == nil {
                emptyState
            } else {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(items) { item in
                        card(item)
                    }
                }
            }

            if let lastRedeemError {
                Text(lastRedeemError)
                    .font(TaliseFont.mono(11, weight: .light))
                    .foregroundStyle(TaliseColor.danger)
            }
        }
        .task { await loadCatalogue() }
        .sheet(item: $confirming) { sku in
            confirmSheet(sku)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
    }

    // MARK: - Card

    private func card(_ item: RedeemSKU) -> some View {
        let affordable = item.canAfford || item.pointsCost <= pointsTotal
        return VStack(alignment: .leading, spacing: 10) {
            ZStack {
                Circle()
                    .fill(affordable ? TaliseColor.accent.opacity(0.18) : TaliseColor.surface2)
                    .frame(width: 36, height: 36)
                Image(systemName: item.icon ?? "gift")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(affordable ? TaliseColor.accent : TaliseColor.fgMuted)
            }

            Text(item.label)
                .font(TaliseFont.heading(14, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
                .fixedSize(horizontal: false, vertical: true)
                .lineLimit(2)

            Text(item.description)
                .font(TaliseFont.body(11, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 4)

            Text("\(item.pointsCost) pts")
                .font(TaliseFont.mono(11, weight: .light))
                .foregroundStyle(affordable ? TaliseColor.accent : TaliseColor.fgDim)

            redeemButton(item, affordable: affordable)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 200, alignment: .topLeading)
        .background(TaliseColor.surface)
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .stroke(
                    affordable
                        ? TaliseColor.accent.opacity(0.12)
                        : Color.white.opacity(0.04),
                    lineWidth: 1
                )
        )
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .opacity(affordable ? 1.0 : 0.62)
    }

    @ViewBuilder
    private func redeemButton(_ item: RedeemSKU, affordable: Bool) -> some View {
        let busy = redeemingSku == item.sku
        if affordable {
            Button {
                confirming = item
            } label: {
                HStack(spacing: 6) {
                    if busy {
                        ProgressView().controlSize(.mini).tint(TaliseColor.bg)
                    }
                    Text(busy ? "Redeeming…" : "Redeem")
                        .font(TaliseFont.heading(12, weight: .medium))
                }
                .foregroundStyle(TaliseColor.bg)
                .frame(maxWidth: .infinity)
                .frame(height: 36)
                .background(TaliseColor.fg)
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .disabled(busy)
        } else {
            let needed = max(0, item.pointsCost - pointsTotal)
            HStack {
                Text("\(needed) pts needed")
                    .font(TaliseFont.mono(11, weight: .light))
                    .foregroundStyle(TaliseColor.fgDim)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 36)
            .background(TaliseColor.surface2)
            .clipShape(Capsule())
        }
    }

    // MARK: - Empty / error states

    private var emptyState: some View {
        VStack(spacing: 6) {
            Text(error ?? "No perks available right now")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fg)
            Text("Earn points by sending and saving — perks unlock as you go.")
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

    // MARK: - Confirm sheet

    private func confirmSheet(_ sku: RedeemSKU) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                MicroLabel(text: "Confirm redemption", color: TaliseColor.fgDim).kerning(1.5)
                Text(sku.label)
                    .font(TaliseFont.heading(22, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                Text(sku.description)
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    MicroLabel(text: "Cost", color: TaliseColor.fgDim).kerning(1.5)
                    Text("\(sku.pointsCost) pts")
                        .font(TaliseFont.heading(18, weight: .medium))
                        .foregroundStyle(TaliseColor.accent)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    MicroLabel(text: "Balance after", color: TaliseColor.fgDim).kerning(1.5)
                    Text("\(max(0, pointsTotal - sku.pointsCost)) pts")
                        .font(TaliseFont.heading(18, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                }
            }
            .padding(16)
            .background(TaliseColor.surface)
            .clipShape(RoundedRectangle(cornerRadius: 16))

            Spacer()

            Button {
                Task { await redeem(sku) }
            } label: {
                Text(redeemingSku == sku.sku ? "Redeeming…" : "Confirm redemption")
                    .font(TaliseFont.heading(14, weight: .medium))
                    .foregroundStyle(TaliseColor.bg)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(TaliseColor.fg)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .disabled(redeemingSku == sku.sku)

            Button {
                confirming = nil
            } label: {
                Text("Cancel")
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .frame(maxWidth: .infinity)
                    .frame(height: 36)
            }
            .buttonStyle(.plain)
        }
        .padding(20)
        .background(TaliseColor.bg.ignoresSafeArea())
    }

    // MARK: - Network

    private func loadCatalogue() async {
        loading = true
        defer { loading = false }
        do {
            let res: RedemptionsCatalogue = try await APIClient.shared.get(
                "/api/rewards/catalogue"
            )
            items = res.items
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func redeem(_ sku: RedeemSKU) async {
        redeemingSku = sku.sku
        lastRedeemError = nil
        defer { redeemingSku = nil }
        do {
            let _: RedemptionResponse = try await APIClient.shared.post(
                "/api/rewards/redeem",
                body: RedeemRequest(sku: sku.sku)
            )
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            confirming = nil
            // Refresh both the local catalogue (canAfford flips on
            // remaining cards) and the parent summary (tier badge +
            // points balance + recent events).
            await loadCatalogue()
            onRedeemed()
        } catch APIError.status(_, let message) {
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            lastRedeemError = parseErrorMessage(message) ?? "Couldn't redeem — try again."
        } catch {
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            lastRedeemError = error.localizedDescription
        }
    }

    /// Pull the friendly `error` field out of the server's JSON body,
    /// falling back to the raw payload string if it doesn't parse.
    private func parseErrorMessage(_ body: String?) -> String? {
        guard let body, let data = body.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return body }
        return (json["error"] as? String) ?? body
    }
}
