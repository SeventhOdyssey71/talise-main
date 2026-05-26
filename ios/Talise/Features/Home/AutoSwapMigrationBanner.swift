import SwiftUI

/// Home-tab upgrade nudge for users who pre-date the auto-swap feature.
///
/// Polls `GET /api/vault/migration-status` on `task` (so the banner
/// reflects current state on cold load, foreground refresh, and pull-
/// to-refresh through the parent's `.refreshable`). Shows a glass card
/// only when `needsMigration == true`, with one of two CTAs depending
/// on the backend's `reason`:
///
///   • `no-vault` → "Upgrade to USDsui-native wallet" — opens
///     `AutoSwapSettings`, where the vault-create CTA in its top card
///     drives stage A of the two-stage migration.
///   • `subname-not-repointed` → "Point @username at your vault" —
///     same destination; the settings sheet exposes a one-tap repoint
///     when the vault already exists.
///
/// The banner is intentionally non-blocking: a user who dismisses it
/// (by ignoring it) keeps seeing it on next foreground. We don't
/// persist a per-user "snooze" because the upgrade is meaningfully
/// load-bearing once auto-swap is live — without it, incoming SUI /
/// USDC / USDT just sits as untouched coins in the user's wallet.
@MainActor
struct AutoSwapMigrationBanner: View {
    @State private var status: VaultMigrationStatus?
    @State private var sheetVisible = false

    var body: some View {
        Group {
            if let s = status, s.needsMigration {
                bannerCard(reason: s.reason)
            } else {
                EmptyView()
            }
        }
        .task { await refresh() }
        .sheet(isPresented: $sheetVisible) {
            NavigationStack {
                AutoSwapSettings()
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Done") { sheetVisible = false }
                                .foregroundStyle(TaliseColor.fg)
                        }
                    }
            }
            .presentationBackground(TaliseColor.bg)
            .task {
                // When the sheet closes, refetch in case the user
                // completed (or partially completed) the migration.
            }
            .onDisappear { Task { await refresh() } }
        }
    }

    // MARK: - Banner card

    private func bannerCard(reason: String) -> some View {
        let copy = displayCopy(for: reason)
        return Button {
            sheetVisible = true
        } label: {
            HStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill(
                            TaliseColor.accent
                                .opacity(0.18)
                        )
                    Image(systemName: "arrow.triangle.2.circlepath.circle.fill")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(TaliseColor.accent)
                }
                .frame(width: 36, height: 36)
                VStack(alignment: .leading, spacing: 3) {
                    Text(copy.title)
                        .font(TaliseFont.body(13, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                    Text(copy.subtitle)
                        .font(TaliseFont.body(11, weight: .regular))
                        .foregroundStyle(TaliseColor.fgMuted)
                        .lineLimit(2)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(TaliseColor.fgDim)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .taliseGlass(cornerRadius: 18)
            // Layered accent ring on top of the glass strokes so the
            // migration banner reads as the green-tinted nudge it always
            // has — same accent halo over the new material backdrop.
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(
                        TaliseColor.accent.opacity(0.28),
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Copy

    private func displayCopy(for reason: String) -> (title: String, subtitle: String) {
        switch reason {
        case "no-vault":
            return (
                title: "Upgrade to USDsui-native wallet",
                subtitle:
                    "Any coin sent to your handle auto-converts to USDsui. Sponsored, on-chain, one tap."
            )
        case "subname-not-repointed":
            return (
                title: "Point your handle at your vault",
                subtitle:
                    "One more signature — re-target your @username so incoming coins land in the vault."
            )
        default:
            return (
                title: "Upgrade your wallet",
                subtitle: "Take one minute to enable auto-swap."
            )
        }
    }

    // MARK: - Networking

    private func refresh() async {
        do {
            status = try await VaultAPI.migrationStatus()
        } catch {
            // Swallow — the banner is purely additive UI; if the
            // endpoint is unreachable we just don't show it. Special-
            // case cancellation: when the parent HomeView fires its
            // pull-to-refresh while this `.task` is still in flight,
            // SwiftUI cancels us. Clearing `status` in that path would
            // make the banner flicker out and back in on every refresh
            // (and even racier — the optimistic clobber + the second
            // fetch repopulating it would shuffle z-order). Preserve
            // the last-known status on cancel; APIClient's in-flight
            // dedup means the two .task fires will share one round-
            // trip anyway.
            if !APIError.isCancellation(error) {
                status = nil
            }
        }
    }
}
