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
    /// Mirror of `BiometricGate.isRequired` so the toggle re-renders.
    @State private var requireBiometric = BiometricGate.isRequired
    /// Drives the `RetargetHandleSheet` presentation. Tapping the
    /// "Update handle target" row flips this on; the sheet handles
    /// probe → diff → submit on its own.
    @State private var showRetarget = false
    /// Drives the `CurrencyPocketsView` presentation — a non-invasive
    /// entry into the multi-currency pockets surface (master plan §8).
    @State private var showPockets = false
    /// Drives the `BankAccountsView` presentation — off-ramp Phase 2
    /// "link a bank account to your @handle" management screen.
    @State private var showBankAccounts = false
    /// Account deletion (App Store Guideline 5.1.1(v)) — confirmation
    /// alert flag, in-flight spinner, and a failure message surfaced in
    /// its own alert so the user knows the account is still live.
    @State private var deleteConfirm = false
    @State private var deletingAccount = false
    @State private var deleteError: String?

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 22) {
                hero
                statsStrip
                walletSection
                bankAccountsSection
                preferencesSection
                securitySection
                helpSection
                signOutButton
                deleteAccountButton
                versionFooter
                Color.clear.frame(height: 140)
            }
            .padding(.horizontal, 24)
            .padding(.top, 12)
        }
        .refreshable { await loadRewards() }
        .taliseScreenBackground()
        .task { await loadRewards() }
        // AutoSwapSettings archived 2026-05-29 — sheet removed alongside
        // the autoswap system. The Preferences row that opened it has been
        // neutralized to a no-op (search showAutoSwap below).
        .alert("Sign out?", isPresented: $signOutConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Sign out", role: .destructive) { session.signOut() }
        } message: {
            Text("Your wallet stays safe. Sign in with the same Google account to come back.")
        }
        // Account deletion (Guideline 5.1.1(v)). A confirm alert is the
        // gate; the message spells out what deletion does and does NOT do
        // (the wallet is self-custodial — Talise never holds the funds).
        .alert("Delete your account?", isPresented: $deleteConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Delete account", role: .destructive) {
                Task { await deleteAccount() }
            }
        } message: {
            Text(Self.deleteConfirmMessage)
        }
        .alert("Couldn't delete account", isPresented: deleteErrorVisible) {
            Button("OK", role: .cancel) { deleteError = nil }
        } message: {
            Text(deleteError ?? "")
        }
        .sheet(isPresented: $showRetarget) {
            RetargetHandleSheet()
                .environment(session)
        }
        .sheet(isPresented: $showPockets) {
            NavigationStack {
                CurrencyPocketsView()
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Done") { showPockets = false }
                                .foregroundStyle(TaliseColor.accent)
                        }
                    }
            }
            .environment(session)
        }
        .sheet(isPresented: $showBankAccounts) {
            NavigationStack {
                BankAccountsView()
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Done") { showBankAccounts = false }
                                .foregroundStyle(TaliseColor.accent)
                        }
                    }
            }
            .environment(session)
        }
    }

    // MARK: - Bank accounts section
    //
    // Off-ramp Phase 2 entry — a single row that opens the bank-account
    // management screen (link / list / remove). Sits between Wallet and
    // Preferences so it reads as a money-rails affordance, not a setting.

    private var bankAccountsSection: some View {
        section(title: "Cash out") {
            Button {
                showBankAccounts = true
            } label: {
                HStack {
                    Image(systemName: "building.columns")
                        .font(.system(size: 14, weight: .regular))
                        .foregroundStyle(TaliseColor.fgMuted)
                        .frame(width: 22)
                    rowLabel(title: "Bank accounts")
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
    }

    // MARK: - Hero

    /// Hero CARD (2026-06-10 restyle, reference profile-header layout in
    /// Talise greens): one solid forest card with the avatar centered, the
    /// name, the handle chip, and the account email — identity at a glance.
    private var hero: some View {
        VStack(alignment: .center, spacing: 12) {
            avatar
                .overlay(Circle().strokeBorder(Color.white.opacity(0.25), lineWidth: 2))
            VStack(spacing: 5) {
                Text(currentUser?.name ?? "—")
                    .font(TaliseFont.heading(21, weight: .semibold))
                    .kerning(-0.5)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                handleLine
                Text(currentUser?.email ?? "")
                    .font(TaliseFont.mono(11, weight: .light))
                    .foregroundStyle(Color.white.opacity(0.6))
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 26)
        .padding(.horizontal, 20)
        .background(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [Color(hex: 0x3A6E2A), Color(hex: 0x224417)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
        )
        .padding(.top, 4)
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
            } else {
                initialsDisc
            }
        }
    }

    /// Avatar fallback — a flat solid disc carrying the user's initials.
    private var initialsDisc: some View {
        ZStack {
            Circle().fill(TaliseColor.surface2)
            Text(initials)
                .font(TaliseFont.heading(32, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
        }
        .frame(width: 88, height: 88)
        .clipShape(Circle())
    }

    /// `@alice.talise.sui` chip with the green check, or a "Claim
    /// your name" CTA if the user hasn't minted one yet.
    @ViewBuilder
    private var handleLine: some View {
        if let handle = currentUser?.taliseHandle, !handle.isEmpty {
            // Talise names are `name@talise` — distinct from bare SuiNS
            // `.sui` names (caleb@talise ≠ caleb.sui), so the chip says so.
            HStack(spacing: 6) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(TaliseColor.greenMint)
                Text("\(handle)@talise")
                    .font(TaliseFont.mono(12, weight: .regular))
                    .foregroundStyle(.white.opacity(0.9))
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 5)
            .background(Capsule().fill(Color.white.opacity(0.12)))
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
                .foregroundStyle(TaliseColor.greenMint)
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Stats strip
    //
    // A single card divided into three equal columns by 1pt hairlines.
    // Using one shared `background` + `clipShape` means all three stat
    // cells share the same corner radius and visual weight — they read
    // as ONE component, not three orphaned tiles.

    private var statsStrip: some View {
        HStack(spacing: 0) {
            statCell(label: "KYC", value: kycTierLabel, accent: kycTierLabel != "Free")
            statDivider
            statCell(label: "Rewards", value: rewards?.tier?.label ?? "Bronze",
                     accent: (rewards?.tier?.label ?? "Bronze") != "Bronze")
            statDivider
            statCell(label: "Since", value: memberSinceMonth, accent: false)
        }
        .frame(maxWidth: .infinity)
        // Flat solid card carrying the user's KYC + Rewards standing.
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(TaliseColor.surface)
        )
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    /// One column of the stats strip. `maxWidth: .infinity` gives all
    /// three cells equal widths regardless of content length.
    private func statCell(label: String, value: String, accent: Bool) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Eyebrow(text: label)
            Text(value)
                .font(TaliseFont.heading(14, weight: .medium))
                .foregroundStyle(accent ? TaliseColor.accent : TaliseColor.fg)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Full-height hairline between stat cells. Vertical sibling of
    /// `LiquidGlassDivider`; uses the same `TaliseColor.line` opacity so
    /// the stat strip's internal dividers match the row dividers in the
    /// other cards below.
    private var statDivider: some View {
        Rectangle()
            .fill(TaliseColor.line)
            .frame(width: 1 / UIScreen.main.scale)
            .padding(.vertical, 12)
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
    //
    // Address in a full-width row with monospace truncation; Copy +
    // Suiscan actions sit in a dedicated row below a hairline so there
    // is clear breathing room between the address text and the buttons.

    private var walletSection: some View {
        section(title: "Wallet") {
            VStack(spacing: 0) {
                // Address row — mono truncated in the middle so both
                // the 0x prefix and the last 4 chars are always visible.
                HStack {
                    Text(currentUser?.suiAddress ?? "—")
                        .font(TaliseFont.mono(12, weight: .light))
                        .foregroundStyle(TaliseColor.fg)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 14)

                sectionDivider

                // Actions row — left-aligned `LiquidGlassPill`s so the
                // pills carry the same frosted-glass quality as the rest
                // of the screen (replaces the old flat `surface2` capsules).
                HStack(spacing: 10) {
                    LiquidGlassPill(
                        title: copiedAddress ? "Copied" : "Copy",
                        icon: copiedAddress ? "checkmark" : "doc.on.doc"
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
                    LiquidGlassPill(title: "Suiscan", icon: "arrow.up.right.square") {
                        openSuiscan()
                    }
                    Spacer()
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
            }
        }
    }

    // MARK: - Preferences section

    private var preferencesSection: some View {
        section(title: "Preferences") {
            VStack(spacing: 0) {
                currencyRow
                sectionDivider
                pocketsRow
                sectionDivider
                // autoSwapRow removed 2026-05-29 alongside the autoswap archive.
                notifyRow
                sectionDivider
                retargetHandleRow
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
                rowLabel(title: "Display currency", icon: "dollarsign.circle")
                Spacer()
                // Glass capsule — same recipe as `LiquidGlassPill` so the
                // inline currency chooser doesn't read as a flat chip
                // floating inside a frosted card.
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
                .background(Capsule().fill(TaliseColor.surface2))
                .clipShape(Capsule())
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
    }

    /// Entry into the multi-currency pockets surface (master plan §8).
    /// Non-invasive — presents `CurrencyPocketsView` as a sheet so the
    /// core balance display on Home is untouched.
    private var pocketsRow: some View {
        Button {
            showPockets = true
        } label: {
            HStack {
                rowLabel(title: "Currency pockets", icon: "tray.2")
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
            rowLabel(title: "Email me when I receive", icon: "bell")
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

    /// Opens `RetargetHandleSheet` so the user can point every
    /// `*.talise.sui` subname they own at their current wallet. Replaces
    /// the manual `scripts/fix-suins-targets.mjs` operator runbook —
    /// runs as an Onara-sponsored PTB, the user pays nothing.
    private var retargetHandleRow: some View {
        Button {
            showRetarget = true
        } label: {
            HStack {
                rowLabel(title: "Update handle target", icon: "arrow.uturn.right")
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

    // MARK: - Security section

    /// Security toggles. Default ON; user can opt out, in which case
    /// `BiometricGate.requireUserPresence` becomes a no-op. The label
    /// mirrors what the system prompt will ask for so users aren't
    /// surprised at tap time.
    private var securitySection: some View {
        section(title: "Security") {
            HStack {
                rowLabel(title: "Require PIN for transactions", icon: "lock.shield")
                Spacer()
                Toggle("", isOn: $requireBiometric)
                    .labelsHidden()
                    .tint(TaliseColor.accent)
                    .onChange(of: requireBiometric) { _, new in
                        BiometricGate.setRequired(new)
                    }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
        }
    }

    // MARK: - Help section

    private var helpSection: some View {
        section(title: "Help") {
            VStack(spacing: 0) {
                // The product web app lives on app.talise.io (host-routed);
                // www.talise.io/home does not exist, so link the app host
                // directly rather than apiBaseURL + a dead path.
                linkRow(icon: "arrow.up.right.square", label: "Open on web") {
                    open("https://app.talise.io")
                }
                sectionDivider
                linkRow(icon: "questionmark.circle", label: "Support") {
                    open("mailto:hello@talise.io")
                }
                sectionDivider
                // App Review requires Privacy Policy + Terms reachable
                // in-app as distinct destinations (Guidelines 5.1.1 / 5.1.2).
                linkRow(icon: "hand.raised", label: "Privacy Policy") {
                    open("https://talise.io/privacy")
                }
                sectionDivider
                linkRow(icon: "doc.text", label: "Terms of Service") {
                    open("https://talise.io/terms")
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
            .background(Capsule().fill(TaliseColor.surface2))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    /// Confirmation copy for account deletion — extracted to a constant so
    /// the `body` modifier chain stays cheap for the type-checker.
    private static let deleteConfirmMessage =
        "This permanently deletes your Talise profile, releases your @handle, and removes linked bank accounts. Your wallet is self-custodial — withdraw or transfer your balance FIRST, because you'll need to create a new account to use it here again. Some transaction records are retained where required by law. This can't be undone."

    /// Bool binding over the optional `deleteError` for the failure alert.
    /// Extracted from `body` (an inline `Binding(get:set:)` there pushed
    /// the expression past the type-checker's budget).
    private var deleteErrorVisible: Binding<Bool> {
        Binding(
            get: { deleteError != nil },
            set: { if !$0 { deleteError = nil } }
        )
    }

    /// "Delete account" — quieter than Sign out (plain text row, no card)
    /// but unmistakably destructive. Required in-app entry point for full
    /// account deletion (App Store Guideline 5.1.1(v)).
    private var deleteAccountButton: some View {
        Button {
            deleteConfirm = true
        } label: {
            HStack(spacing: 8) {
                Spacer()
                if deletingAccount {
                    ProgressView()
                        .controlSize(.small)
                        .tint(TaliseColor.danger)
                } else {
                    Image(systemName: "trash")
                        .font(.system(size: 12, weight: .medium))
                    Text("Delete account")
                        .font(TaliseFont.body(13, weight: .regular))
                }
                Spacer()
            }
            .foregroundStyle(TaliseColor.danger)
            .frame(height: 36)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(deletingAccount)
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

    /// Section with an outside eyebrow title sitting 8pt above the card.
    /// Using `Eyebrow` (uppercase + 2pt tracking) matches `AutoSwapSettings`
    /// and `ContactsSheet` — consistent across all list-style screens.
    private func section<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow(text: title)
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
                // Flat solid section card — clean opaque panel, no material.
                .background(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(TaliseColor.surface)
                )
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
    }

    /// Inter-row hairline used inside section cards. Uses the design-system
    /// `LiquidGlassDivider` so it speaks the same visual language as the
    /// dividers in HistoryRow / EarnView (1 device pixel, glass-tinted
    /// white).
    private var sectionDivider: some View {
        LiquidGlassDivider(inset: 18)
    }

    /// Row label — single line (the subtitle clutter was dropped in the
    /// 2026-06-10 restyle; pass one only where it genuinely informs), with
    /// an optional leading icon so rows read like the reference design.
    private func rowLabel(title: String, subtitle: String? = nil, icon: String? = nil) -> some View {
        HStack(spacing: 12) {
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .regular))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .frame(width: 22)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(TaliseFont.body(14, weight: .light))
                    .foregroundStyle(TaliseColor.fg)
                if let subtitle {
                    Text(subtitle)
                        .font(TaliseFont.mono(10, weight: .light))
                        .foregroundStyle(TaliseColor.fgDim)
                        .lineLimit(1)
                }
            }
        }
    }

    // `miniButton` removed — Copy / Suiscan are now `LiquidGlassPill`s
    // which carry the BottomNavPill glass recipe (material + dark tint +
    // specular hairline + shadow) instead of a flat `surface2` capsule.

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

    /// POST /api/account/delete → server redacts the profile, releases the
    /// @handle mapping, deletes linked bank accounts / push tokens, and
    /// revokes every mobile bearer. On success we run the same local wipe
    /// as sign-out (bearer, ephemeral zk keys, proof cache, snapshots) and
    /// land on the sign-in screen.
    private func deleteAccount() async {
        guard !deletingAccount else { return }
        deletingAccount = true
        defer { deletingAccount = false }
        struct EmptyBody: Encodable {}
        struct Resp: Decodable { let ok: Bool }
        do {
            let resp: Resp = try await APIClient.shared.post(
                "/api/account/delete",
                body: EmptyBody()
            )
            guard resp.ok else {
                deleteError = "The server couldn't delete your account. Please try again."
                return
            }
            session.signOut()
        } catch APIError.unauthorized {
            // Session already dead server-side — locally the account is
            // unreachable; finish the sign-out so the user isn't stuck.
            session.signOut()
        } catch {
            deleteError = "Couldn't reach Talise to delete your account. Check your connection and try again."
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
