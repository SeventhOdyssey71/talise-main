import SwiftUI

/// Bottom sheet that lets the user claim a `<name>.talise.sui` subname
/// after onboarding (or if the silent KYC auto-claim failed).
///
/// Flow:
///   1. Debounced GET /api/username/check?u=<input> on every keystroke
///   2. Tap "Claim" → POST /api/username/claim — operator wallet pays
///      gas + signs the SuiNS mint, user pays nothing
///   3. On success, refresh AppSession so HomeView/Profile pick up the
///      new handle from /api/me
struct ClaimHandleSheet: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var input: String = ""
    @State private var availability: AvailabilityState = .empty
    @State private var checkTask: Task<Void, Never>?
    @State private var claiming = false
    @State private var error: String?
    @State private var claimed: String?
    @FocusState private var focused: Bool

    enum AvailabilityState: Equatable {
        case empty
        case checking
        case available
        case taken
        case reserved
        case invalid
        case rpcError
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let claimed {
                successView(handle: claimed)
            } else {
                form
            }
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .presentationDragIndicator(.visible)
        .onAppear {
            if input.isEmpty, case .ready(let user) = session.phase {
                input = user.suggestedHandle()
                scheduleCheck(input)
                focused = true
            }
        }
    }

    // MARK: - Form

    private var form: some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 6) {
                MicroLabel(text: "Claim your name", color: TaliseColor.fgDim).kerning(1.5)
                Text("Pick your Talise handle")
                    .font(TaliseFont.heading(24, weight: .medium))
                    .kerning(-0.8)
                    .foregroundStyle(TaliseColor.fg)
                Text("People send to you with name@talise.sui — easier to share than a 0x address.")
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(TaliseColor.fgMuted)
                    .padding(.top, 2)
            }

            handleInput
            statusRow

            if let error {
                MicroLabel(text: error, color: TaliseColor.danger)
            }

            claimButton

            Spacer(minLength: 40)
        }
        .padding(.horizontal, 24)
        .padding(.top, 20)
    }

    private var handleInput: some View {
        HStack(spacing: 0) {
            TextField("alice", text: $input)
                .focused($focused)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .textContentType(.username)
                .keyboardType(.asciiCapable)
                .font(TaliseFont.heading(20, weight: .medium))
                .kerning(-0.4)
                .foregroundStyle(TaliseColor.fg)
                .tint(TaliseColor.accent)
                .onChange(of: input) { _, new in
                    let cleaned = sanitize(new)
                    if cleaned != new { input = cleaned }
                    scheduleCheck(cleaned)
                }

            Text("@talise.sui")
                .font(TaliseFont.body(15, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(TaliseColor.usernameCard)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private var statusRow: some View {
        HStack(spacing: 8) {
            statusIcon
            Text(statusText)
                .font(TaliseFont.body(12, weight: .light))
                .foregroundStyle(statusColor)
        }
        .frame(height: 18)
        .padding(.horizontal, 4)
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch availability {
        case .checking:
            ProgressView().controlSize(.mini).tint(TaliseColor.fgDim)
        case .available:
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(TaliseColor.accent)
        case .taken, .reserved, .invalid:
            Image(systemName: "exclamationmark.circle")
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(TaliseColor.danger)
        case .empty, .rpcError:
            Color.clear.frame(width: 12, height: 12)
        }
    }

    private var statusText: String {
        switch availability {
        case .empty:     return ""
        case .checking:  return "Checking…"
        case .available: return "\(input)@talise.sui is available."
        case .taken:     return "Someone already claimed that name."
        case .reserved:  return "That name is reserved."
        case .invalid:   return "Use 3–20 lowercase letters, digits, or underscores."
        case .rpcError:  return "Couldn't check on chain. Tap claim anyway."
        }
    }

    private var statusColor: Color {
        switch availability {
        case .available: return TaliseColor.accent
        case .taken, .reserved, .invalid: return TaliseColor.danger
        case .rpcError: return TaliseColor.fgMuted
        default: return TaliseColor.fgDim
        }
    }

    private var claimButton: some View {
        Button {
            Task { await claim() }
        } label: {
            HStack(spacing: 8) {
                if claiming {
                    ProgressView().controlSize(.small).tint(TaliseColor.bg)
                } else {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 13, weight: .medium))
                }
                Text(claiming ? "Claiming…" : "Claim \(input)@talise.sui")
                    .font(TaliseFont.heading(15, weight: .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .foregroundStyle(TaliseColor.bg)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(canClaim ? TaliseColor.fg : TaliseColor.fg.opacity(0.35))
            .clipShape(Capsule())
        }
        .disabled(!canClaim)
        .buttonStyle(.plain)
    }

    private var canClaim: Bool {
        !claiming && (availability == .available || availability == .rpcError)
    }

    // MARK: - Success

    private func successView(handle: String) -> some View {
        VStack(spacing: 16) {
            Spacer()
            ZStack {
                Circle().fill(TaliseColor.accent.opacity(0.15)).frame(width: 84, height: 84)
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 32, weight: .semibold))
                    .foregroundStyle(TaliseColor.accent)
            }
            Text("Claimed")
                .font(TaliseFont.heading(28, weight: .medium))
                .kerning(-1)
                .foregroundStyle(TaliseColor.fg)
            Text("\(handle)@talise.sui is yours.")
                .font(TaliseFont.body(14, weight: .light))
                .foregroundStyle(TaliseColor.fgMuted)
            Spacer()
            Button {
                dismiss()
                Task { await session.bootstrap() }
            } label: {
                Text("Done")
                    .font(TaliseFont.heading(15, weight: .medium))
                    .foregroundStyle(TaliseColor.bg)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(TaliseColor.fg)
                    .clipShape(Capsule())
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)
        }
    }

    // MARK: - Helpers

    private func sanitize(_ s: String) -> String {
        // Server-side normalizeHandle accepts the same character set:
        // lowercased [a-z0-9_], 3-20 chars. We mirror it client-side
        // so the input box reflects what'll actually be sent.
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789_")
        let cleaned = s.lowercased().unicodeScalars
            .filter { allowed.contains($0) }
            .map(String.init).joined()
        return String(cleaned.prefix(20))
    }

    private func scheduleCheck(_ raw: String) {
        checkTask?.cancel()
        error = nil
        let q = raw.trimmingCharacters(in: .whitespaces)
        if q.isEmpty {
            availability = .empty
            return
        }
        if q.count < 3 {
            availability = .invalid
            return
        }
        availability = .checking
        checkTask = Task {
            try? await Task.sleep(nanoseconds: 250_000_000)
            if Task.isCancelled { return }
            do {
                let encoded = q.addingPercentEncoding(
                    withAllowedCharacters: .urlQueryAllowed
                ) ?? q
                let r: UsernameCheckResponse = try await APIClient.shared.get(
                    "/api/username/check?u=\(encoded)"
                )
                if Task.isCancelled { return }
                if r.available {
                    availability = .available
                } else {
                    switch r.reason {
                    case "taken":    availability = .taken
                    case "reserved": availability = .reserved
                    case "invalid":  availability = .invalid
                    case "rpc":      availability = .rpcError
                    default:         availability = .invalid
                    }
                }
            } catch {
                if Task.isCancelled { return }
                availability = .rpcError
            }
        }
    }

    private func claim() async {
        claiming = true
        error = nil
        defer { claiming = false }
        struct Body: Encodable { let username: String }
        do {
            let _: UsernameClaimResponse = try await APIClient.shared.post(
                "/api/username/claim",
                body: Body(username: input)
            )
            claimed = input
        } catch APIError.status(let code, let msg) where code == 409 {
            error = msg ?? "That name was just taken."
            availability = .taken
        } catch APIError.status(_, let msg) {
            error = msg ?? "Couldn't claim that handle right now."
        } catch let claimErr {
            error = claimErr.localizedDescription
        }
    }
}
