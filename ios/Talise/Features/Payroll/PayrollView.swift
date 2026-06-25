import SwiftUI

/// Payroll / Teams hub. A reusable "team" is a saved list of recipients you
/// pay all at once — one Onara-sponsored batch payout (signAndExecuteRaw),
/// no per-recipient gas, no juggling addresses.
///
/// Presented INSIDE a NavigationStack the parent provides — this view drives
/// its sub-screens (create/edit a team, pay a team) with NavigationLink, and
/// reloads its list whenever it reappears (so a save/pay upstream is reflected
/// without a callback round-trip).
struct PayrollView: View {
    @State private var teams: [TeamDTO] = []
    @State private var loading = true
    @State private var error: String?
    @State private var deletingId: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header

                NavigationLink {
                    TeamEditView(team: nil)
                } label: {
                    newTeamLabel
                }
                .buttonStyle(.plain)

                if loading {
                    loadingState
                } else if let error {
                    errorState(error)
                } else if teams.isEmpty {
                    emptyState
                } else {
                    VStack(spacing: 12) {
                        ForEach(teams) { team in teamRow(team) }
                    }
                }

                Color.clear.frame(height: 28)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        // Reload on every appearance so a save/pay on a pushed screen is
        // reflected the moment we pop back to the list.
        .task { await load() }
        .refreshable { await load() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("PAYROLL")
                .font(TaliseFont.mono(10, weight: .regular)).kerning(1.4)
                .foregroundStyle(TaliseColor.fgDim)
            Text("Pay your team")
                .font(TaliseFont.heading(26, weight: .medium)).kerning(-0.6)
                .foregroundStyle(TaliseColor.fg)
            Text("Save a team once, then pay everyone in one tap — one gasless transaction.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 4)
    }

    private var newTeamLabel: some View {
        HStack(spacing: 10) {
            Image(systemName: "plus")
                .font(.system(size: 14, weight: .semibold)).foregroundStyle(.black)
            Text("New team")
                .font(TaliseFont.body(16, weight: .semibold)).foregroundStyle(.black)
        }
        .frame(maxWidth: .infinity).frame(height: 54)
        .background(Capsule().fill(TaliseColor.greenMint))
    }

    // MARK: - Team row

    private func teamRow(_ team: TeamDTO) -> some View {
        NavigationLink {
            PayTeamView(team: team)
        } label: {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(TaliseColor.greenMint.opacity(0.12))
                        .frame(width: 46, height: 46)
                    Image(systemName: "person.3.fill")
                        .font(.system(size: 18, weight: .regular))
                        .foregroundStyle(TaliseColor.greenMint)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(team.name)
                        .font(TaliseFont.heading(16, weight: .medium))
                        .foregroundStyle(TaliseColor.fg).lineLimit(1)
                    Text(peopleLine(team))
                        .font(TaliseFont.body(12.5, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 6) {
                    Text(TaliseFormat.usd2(savedTotal(team)))
                        .font(TaliseFont.mono(14, weight: .regular))
                        .foregroundStyle(TaliseColor.fg)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(TaliseColor.fgDim)
                }
                // No inline trash button — deletion lives subtly on the team's
                // own screen (PayTeamView). Swipe + long-press stay as a bonus.
                if deletingId == team.id {
                    ProgressView().tint(TaliseColor.fgMuted).frame(width: 18, height: 18)
                }
            }
            .padding(16)
            .rampCard()
        }
        .buttonStyle(.plain)
        .disabled(deletingId == team.id)
        .opacity(deletingId == team.id ? 0.5 : 1)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive) {
                Task { await delete(team) }
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        .contextMenu {
            Button(role: .destructive) {
                Task { await delete(team) }
            } label: {
                Label("Delete team", systemImage: "trash")
            }
        }
    }

    private func peopleLine(_ team: TeamDTO) -> String {
        let n = team.members.count
        return n == 1 ? "1 person" : "\(n) people"
    }

    /// Sum of every member's saved amount (members with no saved amount
    /// count as $0 toward the at-rest total shown on the row).
    private func savedTotal(_ team: TeamDTO) -> Double {
        team.members.reduce(0) { $0 + ($1.amount ?? 0) }
    }

    // MARK: - States

    private var loadingState: some View {
        VStack(spacing: 12) {
            ForEach(0..<3, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(TaliseColor.surface).frame(height: 78)
                    .redacted(reason: .placeholder)
            }
        }
        .overlay(ProgressView().tint(TaliseColor.fgMuted))
    }

    private func errorState(_ msg: String) -> some View {
        VStack(spacing: 14) {
            Text(msg)
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .multilineTextAlignment(.center)
            Button {
                Task { await load() }
            } label: {
                Text("Try again")
                    .font(TaliseFont.body(15, weight: .semibold)).foregroundStyle(.black)
                    .padding(.horizontal, 24).frame(height: 46)
                    .background(Capsule().fill(TaliseColor.greenMint))
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity).padding(.top, 50)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.3")
                .font(.system(size: 38, weight: .light))
                .foregroundStyle(TaliseColor.fgDim)
            Text("No teams yet")
                .font(TaliseFont.heading(18, weight: .medium))
                .foregroundStyle(TaliseColor.fg)
            Text("Create one to pay a group in one transaction.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
        }
        .frame(maxWidth: .infinity).padding(.top, 44)
    }

    // MARK: - Actions

    private func load() async {
        if teams.isEmpty { loading = true }
        error = nil
        defer { loading = false }
        do {
            teams = try await PayrollAPI.listTeams()
        } catch {
            if APIError.isCancellation(error) { return }
            self.error = "Couldn't load your teams right now."
        }
    }

    private func delete(_ team: TeamDTO) async {
        deletingId = team.id
        defer { deletingId = nil }
        do {
            // Prepare: DB-only teams delete immediately; on-chain teams return
            // sponsor-ready `payroll::delete` bytes to sign, then record.
            let resp = try await PayrollAPI.prepareDeleteTeam(id: team.id)
            if resp.mode == "onchain", let bytes = resp.bytes {
                let sub = try await ZkLoginCoordinator.shared.executeSponsorReady(
                    bytesB64: bytes, intent: "Delete team"
                )
                try await PayrollAPI.recordDeleteTeam(id: team.id, digest: sub.digest)
            }
            await load()
        } catch ZkLoginCoordinator.SessionError.rebindRequired {
            self.error = "Sign in again — your session needs a refresh."
        } catch {
            if APIError.isCancellation(error) { return }
            self.error = "Couldn't delete that team. Please try again."
        }
    }
}
