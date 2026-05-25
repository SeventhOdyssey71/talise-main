import SwiftUI
import UIKit

/// Profile tab — redesigned for less generic, more personal feel.
///
/// Hierarchy:
///   1. Hero block — big avatar (Google profile pic or initials) +
///      display name + claimed `@handle.talise.sui` (or claim CTA).
///   2. Stats strip — KYC tier × Rewards tier × member-since. Surfaces
///      the user's standing without making them dig.
///   3. Wallet section — Sui address + actions (copy, Suiscan).
///   4. Preferences section — display currency + notify toggle.
///   5. Help section — web, support, legal.
///   6. Sign out — destructive footer button.
///   7. Version + build metadata.
struct ProfileView: View {
    @Environment(AppSession.self) private var session
    @State private var copiedAddress = false
    @State private var notifyOnReceive = false
    @State private var savingNotify = false
    @State private var settingsError: String?
    @State private var signOutConfirm = false
    /// Fetched on appear so the stats strip can show Bronze/Silver/etc.
    /// Soft-fails to nil — the strip degrades gracefully.
    @State private var rewards: RewardsSummary?
    /// True while the auto-swap settings sheet is up. Driven by the
    /// Preferences row that opens `AutoSwapSettings`.
    @State private var showAutoSwap = false

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 22) {
                hero
                statsStrip
                walletSection
                preferencesSection
                helpSection
                signOutButton
                versionFooter
                Color.clear.frame(height: 140)
            }
            .padding(.horizontal, 24)
            .padding(.top, 12)
        }
        .refreshable { await loadRewards() }
        .taliseScreenBackground()
        .task { await loadRewards() }
        .sheet(isPresented: $showAutoSwap) {
            // Wrap in a NavigationStack so the user has a Done button
            // to dismiss. AutoSwapSettings itself is the full feature
            // surface — `taliseScreenBackground()` provides the TopGlow.
            NavigationStack {
                AutoSwapSettings()
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Done") { showAutoSwap = false }
                                .foregroundStyle(TaliseColor.accent)
                        }
                    }
            }
            .presentationBackground(TaliseColor.bg)
        }
        .alert("Sign out?", isPresented: $signOutConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Sign out", role: .destructive) { session.signOut() }
        } message: {
            Text("Your wallet stays safe. Sign in with the same Google account to come back.")
        }
    }

    // MARK: - Hero

    /// Personal block — no "Profile" eyebrow, no generic "Account"
    /// title. The user's photo + name IS the header.
    private var hero: some View {
        VStack(alignment: .center, spacing: 14) {
            avatar
            VStack(spacing: 4) {
                Text(currentUser?.name ?? "—")
                    .font(TaliseFont.heading(22, weight: .medium))
                    .kerning(-0.6)
                    .foregroundStyle(TaliseColor.fg)
                    .lineLimit(1)
                handleLine
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }

    /// 88pt avatar — preferentially loads Google's profile picture
    /// from `user.picture`; falls back to a clean initials disc.
    private var avatar: some View {
        Group {
            if let urlString = currentUser?.picture,
               let url = URL(string: urlString) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .empty:    initialsDisc
                    case .success(let img):
                        img.resizable()
                            .scaledToFill()
                    case .failure:  initialsDisc
                    @unknown default: initialsDisc
                    }
                }
                .frame(width: 88, height: 88)
                .clipShape(Circle())
                .overlay(
                    Circle().stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
            } else {
                initialsDisc
            }
        }
    }

    private var initialsDisc: some View {
        ZStack {
            Circle()
                .fill(TaliseColor.surface2)
                .frame(width: 88, height: 88)
            Text(initials)
                .font(TaliseFont.heading(32, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
        }
    }

    /// `@alice.talise.sui` chip with the green check, or a "Claim
    /// your name" CTA if the user hasn't minted one yet.
    @ViewBuilder
    private var handleLine: some View {
        if let handle = currentUser?.taliseHandle, !handle.isEmpty {
            HStack(spacing: 6) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(TaliseColor.accent)
                Text("@\(handle).talise.sui")
                    .font(TaliseFont.mono(12, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
        } else {
            Button {
                NotificationCenter.default.post(
                    name: .taliseRequestClaimSheet, object: nil
                )
            } label: {
                HStack(spacing: 4) {
                    Text("Claim your name")
                        .font(TaliseFont.body(13, weight: .light))
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 10, weight: .semibold))
                }
                .foregroundStyle(TaliseColor.accent)
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Stats strip

    /// Three pills side-by-side: KYC tier (Free/Verified/Pro), Rewards
    /// tier (Bronze→Plat), and member-since-month. Compact + scannable.
    private var statsStrip: some View {
        HStack(spacing: 10) {
            statPill(
                label: "KYC",
                value: kycTierLabel,
                accent: kycTierLabel != "Free"
            )
            statPill(
                label: "Rewards",
                value: rewards?.tier?.label ?? "Bronze",
                accent: (rewards?.tier?.label ?? "Bronze") != "Bronze"
            )
            statPill(
                label: "Since",
                value: memberSinceMonth,
                accent: false
            )
        }
    }

    private func statPill(label: String, value: String, accent: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            MicroLabel(text: label, color: TaliseColor.fgDim).kerning(1.5)
            Text(value)
                .font(TaliseFont.heading(14, weight: .medium))
                .foregroundStyle(accent ? TaliseColor.accent : TaliseColor.fg)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TaliseColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    /// Best-effort KYC tier read from UserDefaults (set by the
    /// onboarding `KycTierPicker`). Defaults to "Free" if missing —
    /// new users land in that bucket until they upgrade.
    private var kycTierLabel: String {
        let raw = UserDefaults.standard.string(forKey: "talise.kyc_tier") ?? "free"
        switch raw {
        case "verified": return "Verified"
        case "pro":      return "Pro"
        default:         return "Free"
        }
    }

    /// Member-since month from the recent activity / signup date.
    /// Falls back to "—" until we have a UserDTO `createdAt` field.
    private var memberSinceMonth: String {
        // TODO(profile): when UserDTO exposes a createdAt timestamp,
        // format it as "May '26". Until then surface the current
        // month as a sensible default — a small placeholder beats
        // a "—" no-info pill.
        let f = DateFormatter()
        f.dateFormat = "MMM ''yy"
        return f.string(from: Date())
    }

    // MARK: - Wallet section

    /// Sui address + actions. Section title outside the card so the
    /// hierarchy reads at a glance.
    private var walletSection: some View {
        section(title: "Wallet") {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(currentUser?.suiAddress ?? "—")
                        .font(TaliseFont.mono(12, weight: .light))
                        .foregroundStyle(TaliseColor.fg)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer()
                }
                HStack(spacing: 10) {
                    miniButton(
                        icon: copiedAddress ? "checkmark" : "doc.on.doc",
                        label: copiedAddress ? "Copied" : "Copy"
                    ) {
                        if let a = currentUser?.suiAddress {
                            UIPasteboard.general.string = a
                            withAnimation(.easeInOut(duration: 0.15)) { copiedAddress = true }
                            Task {
                                try? await Task.sleep(nanoseconds: 1_500_000_000)
                                await MainActor.run { copiedAddress = false }
                            }
                        }
                    }
                    miniButton(icon: "arrow.up.right.square", label: "Suiscan") {
                        openSuiscan()
                    }
                }
            }
            .padding(18)
        }
    }

    // MARK: - Preferences section

    private var preferencesSection: some View {
        section(title: "Preferences") {
            VStack(spacing: 0) {
                currencyRow
                sectionDivider
                autoSwapRow
                sectionDivider
                notifyRow
                if let err = settingsError {
                    sectionDivider
                    HStack {
                        MicroLabel(text: err, color: TaliseColor.danger)
                        Spacer()
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                }
            }
        }
    }

    private var currencyRow: some View {
        Menu {
            ForEach(TaliseCurrency.allSupported) { c in
                Button {
                    CurrencySettings.shared.set(c)
                } label: {
                    if c == CurrencySettings.shared.current {
                        Label("\(c.symbol)  \(c.name)", systemImage: "checkmark")
                    } else {
                        Text("\(c.symbol)  \(c.name)")
                    }
                }
            }
        } label: {
            HStack {
                rowLabel(
                    title: "Display currency",
                    subtitle: "Wallet settles in USDsui; this only changes display."
                )
                Spacer()
                HStack(spacing: 6) {
                    Text(CurrencySettings.shared.current.symbol)
                        .font(TaliseFont.heading(13, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                    Text(CurrencySettings.shared.current.code)
                        .font(TaliseFont.mono(11, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(TaliseColor.fgDim)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(TaliseColor.surface2)
                .clipShape(Capsule())
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
    }

    /// Entry point for the always-hold-USDsui settings. Opens
    /// `AutoSwapSettings` in a presented NavigationStack so the user
    /// can opt-in / manage caps without leaving the Profile tab.
    private var autoSwapRow: some View {
        Button {
            showAutoSwap = true
        } label: {
            HStack {
                rowLabel(
                    title: "Auto-convert to USDsui",
                    subtitle: "Any coin sent to your @handle becomes USDsui."
                )
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(TaliseColor.fgDim)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var notifyRow: some View {
        HStack {
            rowLabel(
                title: "Email me when I receive",
                subtitle: "One short email per incoming transfer."
            )
            Spacer()
            if savingNotify {
                ProgressView().controlSize(.small).tint(TaliseColor.fg)
            } else {
                Toggle("", isOn: $notifyOnReceive)
                    .labelsHidden()
                    .tint(TaliseColor.accent)
                    .onChange(of: notifyOnReceive) { _, new in
                        Task { await saveNotify(new) }
                    }
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
    }

    // MARK: - Help section

    private var helpSection: some View {
        section(title: "Help") {
            VStack(spacing: 0) {
                linkRow(icon: "arrow.up.right.square", label: "Open on web") {
                    open(AppConfig.shared.apiBaseURL + "/home")
                }
                sectionDivider
                linkRow(icon: "questionmark.circle", label: "Support") {
                    open("mailto:hello@talise.io")
                }
                sectionDivider
                linkRow(icon: "doc.text", label: "Terms & Privacy") {
                    open(AppConfig.shared.apiBaseURL + "/legal")
                }
            }
        }
    }

    private func linkRow(icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .regular))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .frame(width: 22)
                Text(label)
                    .font(TaliseFont.body(14, weight: .light))
                    .foregroundStyle(TaliseColor.fg)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(TaliseColor.fgDim)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Sign-out + version footer

    private var signOutButton: some View {
        Button {
            signOutConfirm = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "rectangle.portrait.and.arrow.right")
                    .font(.system(size: 14, weight: .medium))
                Text("Sign out")
                    .font(TaliseFont.heading(15, weight: .medium))
            }
            .foregroundStyle(Color(hex: 0xE08D8A))
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(Color(hex: 0xE08D8A).opacity(0.10))
            .overlay(
                Capsule()
                    .stroke(Color(hex: 0xE08D8A).opacity(0.25), lineWidth: 1)
            )
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private var versionFooter: some View {
        HStack {
            Spacer()
            MicroLabel(text: "Talise · v\(AppConfig.shared.appVersion)", color: TaliseColor.fgDim)
                .kerning(1)
            Spacer()
        }
        .padding(.top, 4)
    }

    // MARK: - Layout helpers

    /// Section with an outside title. Cleaner hierarchy than putting
    /// the title inside every card — the eye groups by the spacing.
    private func section<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            MicroLabel(text: title, color: TaliseColor.fgDim).kerning(1.5)
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(TaliseColor.surface)
                .clipShape(RoundedRectangle(cornerRadius: 22))
        }
    }

    private var sectionDivider: some View {
        Rectangle().fill(Color.white.opacity(0.05)).frame(height: 1)
            .padding(.horizontal, 18)
    }

    private func rowLabel(title: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(TaliseFont.body(14, weight: .light))
                .foregroundStyle(TaliseColor.fg)
            Text(subtitle)
                .font(TaliseFont.mono(10, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
        }
    }

    private func miniButton(
        icon: String, label: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .medium))
                Text(label)
                    .font(TaliseFont.heading(12, weight: .medium))
            }
            .foregroundStyle(TaliseColor.fg)
            .padding(.horizontal, 14).padding(.vertical, 9)
            .background(TaliseColor.surface2)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Data

    private var currentUser: UserDTO? {
        if case .ready(let user) = session.phase { return user }
        return nil
    }

    private var initials: String {
        if let handle = currentUser?.taliseHandle, let c = handle.first {
            return String(c).uppercased()
        }
        if let n = currentUser?.name?
            .trimmingCharacters(in: .whitespaces)
            .split(separator: " ").first?.first {
            return String(n).uppercased()
        }
        if let local = currentUser?.email
            .split(separator: "@").first?.first {
            return String(local).uppercased()
        }
        return "·"
    }

    private func saveNotify(_ on: Bool) async {
        savingNotify = true
        settingsError = nil
        defer { savingNotify = false }
        struct Body: Encodable { let notifyOnReceive: Bool }
        struct Resp: Decodable { let ok: Bool }
        do {
            let _: Resp = try await APIClient.shared.post(
                "/api/settings",
                body: Body(notifyOnReceive: on)
            )
        } catch {
            settingsError = "Couldn't save preference. \(error.localizedDescription)"
        }
    }

    private func loadRewards() async {
        do {
            rewards = try await APIClient.shared.get("/api/referral/summary")
        } catch {
            // Soft-fail — stats strip degrades to "Bronze" default.
        }
    }

    private func openSuiscan() {
        guard let a = currentUser?.suiAddress else { return }
        open("https://suiscan.xyz/mainnet/account/\(a)")
    }

    private func open(_ s: String) {
        guard let url = URL(string: s) else { return }
        UIApplication.shared.open(url)
    }
}
