import SwiftUI
import UIKit

/// Profile / settings tab. Surfaces the user's identity (handle, address,
/// email, country), exposes the web app's settings integrations
/// (display-name + receive-notifications via /api/settings), copy / view
/// on Suiscan helpers, and the sign-out action.
struct ProfileView: View {
    @Environment(AppSession.self) private var session
    @State private var copiedAddress = false
    @State private var notifyOnReceive = false
    @State private var savingNotify = false
    @State private var settingsError: String?
    @State private var signOutConfirm = false
    @State private var claimSheetVisible = false

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 22) {
                header
                identityCard
                addressCard
                settingsCard
                supportCard
                signOutButton
                versionFooter
                Color.clear.frame(height: 140)
            }
            .padding(.horizontal, 24)
            .padding(.top, 24)
        }
        .taliseScreenBackground()
        .sheet(isPresented: $claimSheetVisible) {
            ClaimHandleSheet()
                .presentationDetents([.medium, .large])
                .presentationBackground(TaliseColor.bg)
        }
        .alert("Sign out?", isPresented: $signOutConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Sign out", role: .destructive) { session.signOut() }
        } message: {
            Text("Your wallet stays safe. Sign in with the same Google account to come back.")
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            MicroLabel(text: "Profile", color: TaliseColor.fgDim).kerning(1.5)
            Text("Account")
                .font(TaliseFont.heading(28, weight: .medium))
                .kerning(-1)
                .foregroundStyle(TaliseColor.fg)
        }
    }

    // MARK: - Identity card (handle, name, email, country)

    private var identityCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                avatar
                VStack(alignment: .leading, spacing: 4) {
                    if let handle = currentUser?.displayHandle() {
                        Text(handle)
                            .font(TaliseFont.heading(17, weight: .medium))
                            .kerning(-0.6)
                            .foregroundStyle(TaliseColor.fg)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    } else {
                        Button {
                            claimSheetVisible = true
                        } label: {
                            HStack(spacing: 4) {
                                Text("Claim your name")
                                    .font(TaliseFont.heading(15, weight: .medium))
                                    .foregroundStyle(TaliseColor.accent)
                                Image(systemName: "arrow.up.right")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(TaliseColor.accent)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                    if let user = currentUser {
                        Text(user.email)
                            .font(TaliseFont.body(12, weight: .light))
                            .foregroundStyle(TaliseColor.fgMuted)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
                Spacer()
            }
            Divider().background(Color.white.opacity(0.05))
            HStack {
                infoCell(label: "Name", value: currentUser?.name ?? "—")
                Spacer()
                infoCell(label: "Country", value: currentUser?.country ?? "—", align: .trailing)
            }
        }
        .padding(18)
        .background(TaliseColor.usernameCard)
        .clipShape(RoundedRectangle(cornerRadius: 22))
    }

    private var avatar: some View {
        ZStack {
            Circle()
                .fill(TaliseColor.surface2)
                .frame(width: 52, height: 52)
            Text(initials)
                .font(TaliseFont.heading(18, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
        }
    }

    private func infoCell(
        label: String,
        value: String,
        align: HorizontalAlignment = .leading
    ) -> some View {
        VStack(alignment: align, spacing: 4) {
            MicroLabel(text: label, color: TaliseColor.fgDim).kerning(1.5)
            Text(value)
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fg)
                .lineLimit(1)
        }
    }

    // MARK: - Address card

    private var addressCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            MicroLabel(text: "Sui address", color: TaliseColor.fgDim).kerning(1.5)
            HStack {
                Text(currentUser?.suiAddress ?? "—")
                    .font(TaliseFont.mono(12, weight: .light))
                    .foregroundStyle(TaliseColor.fg)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
            }
            HStack(spacing: 10) {
                miniButton(icon: copiedAddress ? "checkmark" : "doc.on.doc",
                           label: copiedAddress ? "Copied" : "Copy") {
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
        .background(TaliseColor.usernameCard)
        .clipShape(RoundedRectangle(cornerRadius: 22))
    }

    // MARK: - Settings (notify-on-receive)

    private var settingsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            MicroLabel(text: "Preferences", color: TaliseColor.fgDim).kerning(1.5)
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Email me when I receive")
                        .font(TaliseFont.body(14, weight: .light))
                        .foregroundStyle(TaliseColor.fg)
                    Text("One short email per incoming transfer.")
                        .font(TaliseFont.mono(10, weight: .light))
                        .foregroundStyle(TaliseColor.fgDim)
                }
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
            if let err = settingsError {
                MicroLabel(text: err, color: TaliseColor.danger)
            }
        }
        .padding(18)
        .background(TaliseColor.usernameCard)
        .clipShape(RoundedRectangle(cornerRadius: 22))
    }

    // MARK: - Support / web links

    private var supportCard: some View {
        VStack(spacing: 0) {
            linkRow(icon: "arrow.up.right.square", label: "Open on web") {
                open(AppConfig.shared.apiBaseURL + "/home")
            }
            divider
            linkRow(icon: "questionmark.circle", label: "Support") {
                open("mailto:hello@talise.io")
            }
            divider
            linkRow(icon: "doc.text", label: "Terms & Privacy") {
                open(AppConfig.shared.apiBaseURL + "/legal")
            }
        }
        .background(TaliseColor.usernameCard)
        .clipShape(RoundedRectangle(cornerRadius: 22))
    }

    private var divider: some View {
        Rectangle().fill(Color.white.opacity(0.05)).frame(height: 1).padding(.horizontal, 18)
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

    // MARK: - Helpers

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

    private var currentUser: UserDTO? {
        if case .ready(let user) = session.phase { return user }
        return nil
    }

    /// First-letter initials for the avatar circle. Prefers a real
    /// claimed handle, falls back to the user's display name, then to
    /// the first character of the email local-part.
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

    private func openSuiscan() {
        guard let a = currentUser?.suiAddress else { return }
        open("https://suiscan.xyz/mainnet/account/\(a)")
    }

    private func open(_ s: String) {
        guard let url = URL(string: s) else { return }
        UIApplication.shared.open(url)
    }
}
