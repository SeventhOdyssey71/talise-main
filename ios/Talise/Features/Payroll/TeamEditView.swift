import SwiftUI

/// Create (team == nil) or edit a reusable payout team. A team is a name plus
/// a list of members; each member is a recipient (@handle, name.talise.sui or
/// 0x address) with an OPTIONAL default amount + label. Amounts are confirmed
/// (and editable) later on the pay screen, so they're optional here.
///
/// On save we drop blank-recipient rows, persist via `PayrollAPI.saveTeam`,
/// then `dismiss()`. The Payroll list reloads on appearance, so popping back
/// reflects the change without an explicit callback (though `onSaved` is
/// offered for callers that keep this view mounted).
struct TeamEditView: View {
    let team: TeamDTO?
    /// Optional hook for parents that don't reload-on-appear.
    var onSaved: () -> Void = {}

    @Environment(\.dismiss) private var dismiss

    @State private var name: String = ""
    @State private var rows: [MemberRow] = []
    @State private var saving = false
    @State private var error: String?

    private var trimmedName: String { name.trimmingCharacters(in: .whitespaces) }
    private var namedRows: [MemberRow] {
        rows.filter { !$0.recipient.trimmingCharacters(in: .whitespaces).isEmpty }
    }
    private var canSave: Bool {
        !trimmedName.isEmpty && !namedRows.isEmpty && !saving
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                nameCard
                membersSection

                Button {
                    rows.append(MemberRow())
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "plus.circle")
                            .font(.system(size: 14, weight: .medium))
                        Text("Add person")
                            .font(TaliseFont.body(15, weight: .medium))
                    }
                    .foregroundStyle(TaliseColor.fg)
                    .frame(maxWidth: .infinity).frame(height: 48)
                    .background(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .fill(TaliseColor.surface2)
                    )
                }
                .buttonStyle(.plain)

                if let error {
                    Text(error)
                        .font(TaliseFont.body(13, weight: .light))
                        .foregroundStyle(TaliseColor.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }

                saveButton
                Color.clear.frame(height: 24)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .scrollDismissesKeyboard(.interactively)
        .onAppear(perform: hydrateOnce)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(team == nil ? "NEW TEAM" : "EDIT TEAM")
                .font(TaliseFont.mono(10, weight: .regular)).kerning(1.4)
                .foregroundStyle(TaliseColor.fgDim)
            Text(team == nil ? "Create a team" : (team?.name ?? "Edit team"))
                .font(TaliseFont.heading(24, weight: .medium)).kerning(-0.5)
                .foregroundStyle(TaliseColor.fg)
            Text("Add the people you pay together. You'll set or confirm amounts when you pay.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 4)
    }

    private var nameCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("TEAM NAME")
                .font(TaliseFont.mono(10, weight: .regular)).kerning(0.6)
                .foregroundStyle(TaliseColor.fgDim)
            TextField("", text: $name, prompt: Text("e.g. Design team").foregroundColor(TaliseColor.fgDim))
                .font(TaliseFont.body(16, weight: .regular))
                .foregroundStyle(TaliseColor.fg)
                .textInputAutocapitalization(.words)
                .padding(.horizontal, 14).frame(height: 48)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(TaliseColor.surface2)
                )
        }
        .padding(16)
        .rampCard()
    }

    private var membersSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("PEOPLE")
                .font(TaliseFont.mono(10, weight: .regular)).kerning(0.6)
                .foregroundStyle(TaliseColor.fgDim)
            if rows.isEmpty {
                Text("No one added yet — tap \u{201C}Add person\u{201D} to start.")
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
            } else {
                ForEach($rows) { $row in
                    MemberRowView(row: $row) { remove(row.id) }
                }
            }
        }
    }

    private var saveButton: some View {
        Button {
            Task { await save() }
        } label: {
            HStack(spacing: 8) {
                if saving { ProgressView().tint(.black) }
                Text(saving ? "Saving…" : "Save team")
            }
            .font(TaliseFont.body(16, weight: .semibold)).foregroundStyle(.black)
            .frame(maxWidth: .infinity).frame(height: 54)
            .background(Capsule().fill(canSave ? TaliseColor.greenMint : TaliseColor.surface2))
        }
        .buttonStyle(.plain)
        .disabled(!canSave)
        .opacity(canSave ? 1 : 0.6)
    }

    // MARK: - Lifecycle / actions

    /// Seed the editor from the existing team once (a fresh team gets one
    /// blank row so the form never looks empty).
    @State private var hydrated = false
    private func hydrateOnce() {
        guard !hydrated else { return }
        hydrated = true
        if let team {
            name = team.name
            rows = team.members.map {
                MemberRow(
                    recipient: $0.recipient,
                    amount: $0.amount.map { String(format: "%g", $0) } ?? "",
                    label: $0.label ?? ""
                )
            }
        }
        if rows.isEmpty { rows = [MemberRow()] }
    }

    private func remove(_ id: UUID) {
        rows.removeAll { $0.id == id }
    }

    private func save() async {
        guard canSave else { return }
        saving = true; error = nil
        defer { saving = false }

        let members: [TeamMemberDTO] = namedRows.map { row in
            let amt = Double(row.amount.trimmingCharacters(in: .whitespaces))
            let lbl = row.label.trimmingCharacters(in: .whitespaces)
            return TeamMemberDTO(
                recipient: row.recipient.trimmingCharacters(in: .whitespaces),
                amount: (amt ?? 0) > 0 ? amt : nil,
                label: lbl.isEmpty ? nil : lbl
            )
        }

        do {
            _ = try await PayrollAPI.saveTeam(name: trimmedName, members: members)
            onSaved()
            dismiss()
        } catch {
            if APIError.isCancellation(error) { return }
            self.error = "Couldn't save your team. Please try again."
        }
    }
}

/// A locally-editable member row. `id` keeps SwiftUI identity stable as rows
/// are added/removed; the text fields are plain strings (amount is parsed only
/// at save time).
struct MemberRow: Identifiable {
    let id = UUID()
    var recipient: String = ""
    var amount: String = ""
    var label: String = ""
}

/// One person in the team editor. Owns its own live recipient resolution: as
/// you type a @handle / name.talise.sui / 0x address, it debounces (~0.4s) then
/// hits `/api/recipient/resolve` (the same path Send + Stream use) and shows
/// the matched identity — so a typo is caught here, not at pay time.
private struct MemberRowView: View {
    @Binding var row: MemberRow
    var onRemove: () -> Void

    @State private var resolved: RecipientResolution?
    @State private var resolving = false
    @State private var resolveFailed = false

    private var trimmedRecipient: String {
        row.recipient.trimmingCharacters(in: .whitespaces)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                TextField("", text: $row.recipient,
                          prompt: Text("@handle, name.talise.sui or 0x…").foregroundColor(TaliseColor.fgDim))
                    .font(TaliseFont.body(15, weight: .regular))
                    .foregroundStyle(TaliseColor.fg)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(.horizontal, 12).frame(height: 46)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(TaliseColor.surface2)
                    )
                Button(action: onRemove) {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(TaliseColor.fgMuted)
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(TaliseColor.surface2))
                }
                .buttonStyle(.plain)
            }

            resolutionLine

            HStack(spacing: 10) {
                HStack(spacing: 4) {
                    Text("$").font(TaliseFont.body(15, weight: .regular)).foregroundStyle(TaliseColor.fgMuted)
                    TextField("", text: $row.amount,
                              prompt: Text("Amount").foregroundColor(TaliseColor.fgDim))
                        .font(TaliseFont.body(15, weight: .regular))
                        .foregroundStyle(TaliseColor.fg)
                        .keyboardType(.decimalPad)
                }
                .padding(.horizontal, 12).frame(height: 46).frame(maxWidth: .infinity)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(TaliseColor.surface2)
                )
                TextField("", text: $row.label,
                          prompt: Text("Label (optional)").foregroundColor(TaliseColor.fgDim))
                    .font(TaliseFont.body(15, weight: .regular))
                    .foregroundStyle(TaliseColor.fg)
                    .padding(.horizontal, 12).frame(height: 46).frame(maxWidth: .infinity)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(TaliseColor.surface2)
                    )
            }
        }
        .padding(14)
        .rampCard()
        // Re-resolve whenever the typed recipient changes (debounced inside).
        .task(id: trimmedRecipient) { await resolve() }
    }

    @ViewBuilder private var resolutionLine: some View {
        if resolving {
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini).tint(TaliseColor.fgMuted)
                Text("Finding…")
                    .font(TaliseFont.body(12, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
            }
        } else if let resolved {
            HStack(spacing: 6) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(TaliseColor.greenMint)
                Text(resolved.displayString)
                    .font(TaliseFont.body(12.5, weight: .regular))
                    .foregroundStyle(TaliseColor.fg).lineLimit(1)
            }
        } else if resolveFailed {
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.circle")
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(TaliseColor.danger)
                Text("No one found by that name")
                    .font(TaliseFont.body(12, weight: .light))
                    .foregroundStyle(TaliseColor.danger)
            }
        }
    }

    private func resolve() async {
        let q = trimmedRecipient
        guard !q.isEmpty else {
            resolved = nil; resolveFailed = false; resolving = false
            return
        }
        // Debounce — coalesce fast typing into one request.
        try? await Task.sleep(nanoseconds: 400_000_000)
        if Task.isCancelled { return }

        resolving = true; resolveFailed = false
        defer { resolving = false }
        do {
            let r: RecipientResolution = try await APIClient.shared.get(
                "/api/recipient/resolve?q=\(q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? q)"
            )
            if Task.isCancelled || q != trimmedRecipient { return }
            resolved = r; resolveFailed = false
        } catch {
            if Task.isCancelled || APIError.isCancellation(error) { return }
            if q != trimmedRecipient { return }
            resolved = nil; resolveFailed = true
        }
    }
}
