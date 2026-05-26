import SwiftUI

/// Step 2: pick a recipient. Text input at the top + recent contacts
/// from /api/contacts. Tapping a contact auto-resolves and advances; the
/// "Next" button is the keyboard-only path for hand-typed addresses.
struct SendRecipientView: View {
    @Bindable var draft: SendDraft
    var onNext: () -> Void
    var onBack: () -> Void

    @State private var contacts: [ContactDTO] = []
    @State private var loadingContacts = true
    @State private var resolving = false
    @State private var resolveTask: Task<Void, Never>?
    /// Set by `pickContact` so the next `onChange(of: recipientInput)`
    /// skips its scheduleResolve call. Without this, picking a contact
    /// also fires a name-based server resolve that races the
    /// authoritative address set by the pick — typically clobbering it.
    @State private var suppressNextResolve = false
    @FocusState private var inputFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            header

            inputCard
                .padding(.horizontal, 24)
                .padding(.top, 16)

            resolveStatus
                .padding(.horizontal, 28)
                .padding(.top, 8)

            Eyebrow(text: "Recent")
                .padding(.horizontal, 28)
                .padding(.top, 26)

            contactsList

            Spacer(minLength: 0)

            nextButton
                .padding(.horizontal, 24)
                .padding(.bottom, 18)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .onAppear {
            inputFocused = true
            Task { await loadContacts() }

            // Pick up the recipient prefill (set by ContactsSheet on Home)
            // exactly once so a fresh visit doesn't accidentally re-seed.
            let key = "io.talise.send.prefillRecipient"
            if let prefill = UserDefaults.standard.string(forKey: key),
               !prefill.isEmpty,
               draft.recipientInput.isEmpty {
                draft.recipientInput = prefill
                scheduleResolve(prefill)
                UserDefaults.standard.removeObject(forKey: key)
            }
        }
        .onDisappear { resolveTask?.cancel() }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(TaliseColor.fg)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(TaliseColor.surfaceGlass))
            }
            Spacer()
            MicroLabel(text: "Send to", color: TaliseColor.fgDim).kerning(1.5)
            Spacer()
            Color.clear.frame(width: 36, height: 36)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
    }

    // MARK: - Input

    private var inputCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            MicroLabel(text: "To", color: TaliseColor.fgDim).kerning(1.5)
            TextField(
                "alice / 0x6487… / +44 7…",
                text: $draft.recipientInput
            )
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .textContentType(.username)
            .keyboardType(.asciiCapable)
            .font(TaliseFont.body(17, weight: .regular))
            .foregroundStyle(TaliseColor.fg)
            .tint(TaliseColor.accent)
            .focused($inputFocused)
            .onChange(of: draft.recipientInput) { _, new in
                // Don't re-resolve when `pickContact` programmatically
                // sets the input — it already set `draft.resolved` with
                // the authoritative address, and re-resolving on the
                // contact's *name* would either fail or return a
                // different result, clobbering the pick. `pickContact`
                // raises this flag for one onChange cycle.
                if suppressNextResolve {
                    suppressNextResolve = false
                    return
                }
                scheduleResolve(new)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .taliseGlass(cornerRadius: 20)
    }

    @ViewBuilder
    private var resolveStatus: some View {
        if resolving {
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini).tint(TaliseColor.fgDim)
                MicroLabel(text: "Resolving…", color: TaliseColor.fgDim)
                Spacer()
            }
        } else if let r = draft.resolved {
            HStack(spacing: 6) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(TaliseColor.accent)
                Text(r.displayName ?? r.address)
                    .font(TaliseFont.mono(11, weight: .light))
                    .foregroundStyle(TaliseColor.accent)
                Text(shortAddress(r.address))
                    .font(TaliseFont.mono(10, weight: .light))
                    .foregroundStyle(TaliseColor.fgDim)
                Spacer()
            }
        } else if draft.recipientInput.count >= 3 {
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.circle")
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(TaliseColor.danger)
                Text("No match yet for \"\(draft.recipientInput)\"")
                    .font(TaliseFont.mono(11, weight: .light))
                    .foregroundStyle(TaliseColor.danger)
                Spacer()
            }
        } else {
            Color.clear.frame(height: 14)
        }
    }

    // MARK: - Contacts

    private var contactsList: some View {
        Group {
            if loadingContacts {
                HStack {
                    ProgressView().controlSize(.small).tint(TaliseColor.fgDim)
                    Text("Loading contacts…")
                        .font(TaliseFont.mono(11, weight: .light))
                        .foregroundStyle(TaliseColor.fgDim)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 28)
                .padding(.top, 12)
            } else if contacts.isEmpty {
                Text("No recent recipients yet — your first send will appear here.")
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.fgDim)
                    .padding(.horizontal, 28)
                    .padding(.top, 12)
            } else {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(contacts) { c in
                            contactRow(c)
                            if c.id != contacts.last?.id {
                                Divider().background(TaliseColor.line)
                                    .padding(.leading, 70)
                            }
                        }
                    }
                    .padding(.top, 8)
                }
            }
        }
    }

    private func contactRow(_ c: ContactDTO) -> some View {
        Button {
            pickContact(c)
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(TaliseColor.surface)
                        .frame(width: 38, height: 38)
                    Text(initials(for: c))
                        .font(TaliseFont.heading(13, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(c.display)
                        .font(TaliseFont.body(15, weight: .regular))
                        .foregroundStyle(TaliseColor.fg)
                    Text(shortAddress(c.address))
                        .font(TaliseFont.mono(10, weight: .light))
                        .foregroundStyle(TaliseColor.fgDim)
                }
                Spacer()
                if c.sentCount > 0 {
                    Text("\(c.sentCount) sent")
                        .font(TaliseFont.mono(10, weight: .light))
                        .foregroundStyle(TaliseColor.fgDim)
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func initials(for c: ContactDTO) -> String {
        let src = c.name ?? c.address
        let cleaned = src.replacingOccurrences(of: "@talise.sui", with: "")
            .replacingOccurrences(of: ".sui", with: "")
        let parts = cleaned.split(separator: " ")
        if parts.count >= 2,
           let a = parts[0].first, let b = parts[1].first {
            return "\(a)\(b)".uppercased()
        }
        let trimmed = cleaned.drop(while: { $0 == "0" || $0 == "x" })
        return String(trimmed.prefix(2)).uppercased()
    }

    private func pickContact(_ c: ContactDTO) {
        // Cancel any in-flight resolve and raise the suppression flag
        // BEFORE writing recipientInput — otherwise the onChange handler
        // re-resolves on the contact's *name* and clobbers the
        // authoritative address we're about to set.
        resolveTask?.cancel()
        resolving = false
        suppressNextResolve = true

        draft.recipientInput = c.name ?? c.address
        draft.resolved = RecipientResolution(
            address: c.address,
            displayName: c.name ?? shortAddress(c.address),
            display: nil,
            source: "contact"
        )
        draft.previousSendsToRecipient = c.sentCount
        #if canImport(UIKit)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        #endif
        onNext()
    }

    // MARK: - Next button

    private var nextButton: some View {
        Button(action: { if canAdvance { onNext() } }) {
            Text("Next")
                .font(TaliseFont.heading(16, weight: .medium))
                .foregroundStyle(TaliseColor.bg)
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .background(canAdvance ? TaliseColor.fg : TaliseColor.fg.opacity(0.35))
                .clipShape(Capsule())
        }
        .disabled(!canAdvance)
    }

    private var canAdvance: Bool {
        draft.resolved != nil
    }

    // MARK: - Resolve

    private func scheduleResolve(_ input: String) {
        resolveTask?.cancel()
        draft.resolved = nil
        let q = input.trimmingCharacters(in: .whitespaces)
        guard q.count >= 3 else { resolving = false; return }
        if let addr = SuiAddress(q) {
            draft.resolved = RecipientResolution(
                address: addr.raw,
                displayName: addr.short,
                display: nil,
                source: "address"
            )
            resolving = false
            return
        }
        resolving = true
        resolveTask = Task {
            try? await Task.sleep(nanoseconds: 250_000_000)
            if Task.isCancelled { return }
            do {
                let encoded = q.addingPercentEncoding(
                    withAllowedCharacters: .urlQueryAllowed
                ) ?? q
                let r: RecipientResolution = try await APIClient.shared.get(
                    "/api/recipient/resolve?q=\(encoded)"
                )
                if Task.isCancelled { return }
                draft.resolved = r
                // Carry over historical sent-count if this address is in
                // our contacts list — keeps the "N previous sends" hint
                // working for typed addresses, not just contact picks.
                if let match = contacts.first(where: { $0.address == r.address }) {
                    draft.previousSendsToRecipient = match.sentCount
                } else {
                    draft.previousSendsToRecipient = nil
                }
            } catch {
                if Task.isCancelled { return }
                draft.resolved = nil
            }
            resolving = false
        }
    }

    private func loadContacts() async {
        do {
            let r: ContactsResponse = try await APIClient.shared.get("/api/contacts")
            contacts = r.contacts
        } catch {
            contacts = []
        }
        loadingContacts = false
    }

    private func shortAddress(_ a: String) -> String {
        guard a.count > 14 else { return a }
        return String(a.prefix(8)) + "…" + String(a.suffix(6))
    }
}
