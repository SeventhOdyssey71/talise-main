import SwiftUI

// MARK: - DTOs

private struct StreamEscrowResp: Decodable { let escrowAddress: String }
private struct StreamRecordResp: Decodable { let id: String? }
struct StreamDTO: Decodable, Identifiable {
    let id: String
    let state: String
    let role: String?
    let recipientHandle: String?
    let recipientAddress: String?
    let totalUsd: Double?
    let releasedUsd: Double?
    let remainingUsd: Double?
    let tranchesDone: Int?
    let numTranches: Int?
    let nextTrancheAt: Double?
}
private struct StreamsResp: Decodable { let streams: [StreamDTO] }

// MARK: - Setup flow

struct StreamSetupView: View {
    var onDone: () -> Void
    @State private var recipientQuery = ""
    @State private var resolved: RecipientResolution?
    @State private var resolving = false
    @State private var amountText = ""
    @State private var durationMin = 60      // default: 1 hour
    @State private var intervalMin = 10      // default: every 10 minutes
    @State private var starting = false
    @State private var error: String?
    @State private var started = false
    @State private var resolveFailed = false
    @State private var resolveTask: Task<Void, Never>?

    private let durations: [(String, Int)] = [("1 hour", 60), ("1 day", 1440), ("1 week", 10080), ("30 days", 43200)]
    private let intervals: [(String, Int)] = [("1 min", 1), ("10 min", 10), ("1 hour", 60), ("1 day", 1440)]

    private var totalUsd: Double { Double(amountText) ?? 0 }
    private var numTranches: Int { max(1, durationMin / max(1, intervalMin)) }
    private var trancheUsd: Double { numTranches > 0 ? totalUsd / Double(numTranches) : 0 }
    private var validSchedule: Bool {
        totalUsd > 0 && trancheUsd >= 0.01 && resolved != nil && numTranches >= 1 && numTranches <= 5000
    }

    var body: some View {
        if started {
            startedView
        } else {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 22) {
                    header
                    recipientField
                    amountField
                    scheduleCard
                    statusSection
                    if let error { Text(error).font(TaliseFont.body(12)).foregroundStyle(TaliseColor.danger) }
                    Color.clear.frame(height: 90)
                }
                .padding(.horizontal, 22).padding(.top, 18)
            }
            .background(TaliseColor.bg.ignoresSafeArea())
            .overlay(alignment: .bottom) { startBar }
            .presentationDragIndicator(.visible)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Eyebrow(text: "Stream a payment")
            Text("Money over time")
                .font(TaliseFont.heading(24, weight: .medium)).kerning(-0.8).foregroundStyle(TaliseColor.fg)
            Text("Drip a salary, an allowance, a payout — free, because gas is free.")
                .font(TaliseFont.body(13, weight: .light)).foregroundStyle(TaliseColor.fgMuted)
        }
    }

    private var recipientField: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("TO").font(TaliseFont.mono(9)).tracking(1.5).foregroundStyle(TaliseColor.fgDim)
            HStack {
                TextField("@handle or 0x address", text: $recipientQuery)
                    .font(TaliseFont.body(15)).foregroundStyle(TaliseColor.fg)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .onSubmit { scheduleResolve(debounce: false) }
                if resolving { ProgressView().controlSize(.small) }
                else if resolved != nil { Image(systemName: "checkmark.circle.fill").foregroundStyle(TaliseColor.accent) }
                else if resolveFailed { Image(systemName: "xmark.circle.fill").foregroundStyle(TaliseColor.danger) }
            }
            Rectangle().fill(TaliseColor.line).frame(height: 1)
            if resolving {
                Text("Looking up recipient…").font(TaliseFont.mono(10)).foregroundStyle(TaliseColor.fgDim)
            } else if let r = resolved {
                Text("Resolved: \(r.displayString)").font(TaliseFont.mono(10)).foregroundStyle(TaliseColor.accent)
            } else if resolveFailed {
                Text("Couldn't find that recipient. Check the @handle or address.")
                    .font(TaliseFont.mono(10)).foregroundStyle(TaliseColor.danger)
            }
        }
        .onChange(of: recipientQuery) { _, _ in
            resolved = nil; resolveFailed = false
            scheduleResolve(debounce: true)
        }
    }

    private var amountField: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("TOTAL (USDsui)").font(TaliseFont.mono(9)).tracking(1.5).foregroundStyle(TaliseColor.fgDim)
            HStack {
                Text("$").font(TaliseFont.heading(18)).foregroundStyle(TaliseColor.fgMuted)
                TextField("0.00", text: $amountText).keyboardType(.decimalPad)
                    .font(TaliseFont.display(22, weight: .medium)).foregroundStyle(TaliseColor.fg)
            }
            Rectangle().fill(TaliseColor.line).frame(height: 1)
        }
    }

    private var scheduleCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            picker("OVER", value: $durationMin, options: durations)
            picker("EVERY", value: $intervalMin, options: intervals)
        }
        .padding(18).taliseGlass(cornerRadius: 20)
    }

    private func picker(_ label: String, value: Binding<Int>, options: [(String, Int)]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(TaliseFont.mono(9)).tracking(1.5).foregroundStyle(TaliseColor.fgDim)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(options, id: \.1) { opt in
                        let on = value.wrappedValue == opt.1
                        Button { value.wrappedValue = opt.1 } label: {
                            Text(opt.0).font(TaliseFont.body(13, weight: on ? .medium : .light))
                                .foregroundStyle(on ? Color(hex: 0x0A130D) : TaliseColor.fg)
                                .padding(.horizontal, 14).padding(.vertical, 8)
                                .background(Capsule().fill(on ? TaliseColor.greenMint : TaliseColor.surfaceGlass))
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
    }

    /// Always-visible block under the schedule. When the stream isn't
    /// startable it explains exactly why (no recipient / no amount /
    /// tranche below the gasless minimum); when valid it shows the
    /// existing preview card. The screen never looks empty or dead.
    @ViewBuilder private var statusSection: some View {
        if validSchedule {
            previewCard
        } else {
            statusLine(statusMessage)
        }
    }

    private var statusMessage: String {
        if recipientQuery.trimmingCharacters(in: .whitespaces).isEmpty {
            return "Enter a recipient — an @handle or a 0x address."
        }
        if resolving { return "Looking up that recipient…" }
        if resolved == nil {
            return "Enter a recipient we can find before streaming."
        }
        if totalUsd <= 0 { return "Enter an amount to stream." }
        if trancheUsd < 0.01 {
            return "Each payment works out to \(TaliseFormat.usd(trancheUsd)) — below the $0.01 minimum. Raise the total or stream less often."
        }
        if numTranches > 5000 {
            return "That's \(numTranches) payments — too many. Stream less often or over a shorter window."
        }
        return "Set a recipient, amount and schedule to start."
    }

    private func statusLine(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "info.circle").font(.system(size: 12)).foregroundStyle(TaliseColor.fgMuted)
            Text(text)
                .font(TaliseFont.body(12, weight: .light)).foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .taliseGlass(cornerRadius: 16)
    }

    private var previewCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "bolt.fill").font(.system(size: 12)).foregroundStyle(TaliseColor.accent)
                Text("\(numTranches) payments of \(TaliseFormat.usd2(trancheUsd))")
                    .font(TaliseFont.heading(15, weight: .medium)).foregroundStyle(TaliseColor.fg)
            }
            Text("one every \(intervalLabel), finishing in \(durationLabel). First payment fires now.")
                .font(TaliseFont.body(12, weight: .light)).foregroundStyle(TaliseColor.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
            Text("Every payment is gasless — \(TaliseFormat.usd2(totalUsd)) total, $0 in fees.")
                .font(TaliseFont.mono(9)).foregroundStyle(TaliseColor.accent)
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .taliseGlass(cornerRadius: 18)
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(TaliseColor.accent.opacity(0.2), lineWidth: 1))
    }

    private var startBar: some View {
        SlideToConfirm(title: starting ? "Starting…" : "Slide to start streaming") {
            await start()
        }
        .disabled(!validSchedule || starting)
        .opacity(!validSchedule || starting ? 0.5 : 1)
        .padding(.horizontal, 22).padding(.top, 12).padding(.bottom, 24)
        .background(LinearGradient(colors: [TaliseColor.bg.opacity(0), TaliseColor.bg], startPoint: .top, endPoint: .bottom).ignoresSafeArea())
    }

    private var startedView: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "dot.radiowaves.left.and.right").font(.system(size: 52)).foregroundStyle(TaliseColor.accent)
            Text("Streaming started").font(TaliseFont.heading(22, weight: .medium)).foregroundStyle(TaliseColor.fg)
            Text("\(TaliseFormat.usd2(totalUsd)) to \(resolved?.displayString ?? "recipient") · \(numTranches) payments")
                .font(TaliseFont.body(13)).foregroundStyle(TaliseColor.fgMuted).multilineTextAlignment(.center).padding(.horizontal, 30)
            Spacer()
            Button(action: onDone) {
                Text("Done").font(TaliseFont.heading(16, weight: .medium)).foregroundStyle(Color(hex: 0x0A130D))
                    .frame(maxWidth: .infinity).frame(height: 52).background(Capsule().fill(TaliseColor.greenMint))
            }.buttonStyle(.plain).padding(.horizontal, 22).padding(.bottom, 24)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
    }

    private var intervalLabel: String { intervals.first { $0.1 == intervalMin }?.0 ?? "\(intervalMin) min" }
    private var durationLabel: String { durations.first { $0.1 == durationMin }?.0 ?? "\(durationMin) min" }

    /// Resolve the recipient automatically as the user types (debounced)
    /// and immediately on submit. Cancels any in-flight lookup so the
    /// latest query always wins and the inline state never lies.
    private func scheduleResolve(debounce: Bool) {
        resolveTask?.cancel()
        let q = recipientQuery.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { resolving = false; return }
        resolveTask = Task {
            if debounce {
                try? await Task.sleep(nanoseconds: 400_000_000) // ~0.4s
                if Task.isCancelled { return }
            }
            await resolve(q)
        }
    }

    private func resolve(_ query: String) async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        resolving = true; resolveFailed = false
        defer { resolving = false }
        do {
            let r: RecipientResolution = try await APIClient.shared.get(
                "/api/recipient/resolve?q=\(q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? q)"
            )
            if Task.isCancelled { return }
            // Guard against a stale response landing after the field changed.
            guard q == recipientQuery.trimmingCharacters(in: .whitespaces) else { return }
            resolved = r; resolveFailed = false
        } catch {
            if Task.isCancelled || APIError.isCancellation(error) { return }
            guard q == recipientQuery.trimmingCharacters(in: .whitespaces) else { return }
            resolved = nil; resolveFailed = true
        }
    }

    private func start() async {
        guard let to = resolved?.address, validSchedule else { return }
        starting = true; error = nil; defer { starting = false }
        let totalMicros = Int((totalUsd * 1_000_000).rounded())
        let trancheMicros = totalMicros / numTranches
        let intervalMs = intervalMin * 60_000
        do {
            let escrow: StreamEscrowResp = try await APIClient.shared.get("/api/streams/escrow")
            let sent = try await ZkLoginCoordinator.shared.signAndSubmitSend(
                to: escrow.escrowAddress, amountUsd: totalUsd, intent: "Start stream"
            )
            struct RecordBody: Encodable {
                let fundingDigest: String; let recipientAddress: String; let recipientHandle: String?
                let totalMicros: String; let trancheMicros: String; let numTranches: Int
                let startMs: Int; let intervalMs: Int
            }
            let now = Int(Date().timeIntervalSince1970 * 1000)
            let _: StreamRecordResp = try await APIClient.shared.post(
                "/api/streams/record",
                body: RecordBody(fundingDigest: sent.digest, recipientAddress: to,
                                 recipientHandle: resolved?.displayName,
                                 totalMicros: String(totalMicros), trancheMicros: String(trancheMicros),
                                 numTranches: numTranches, startMs: now, intervalMs: intervalMs)
            )
            NotificationCenter.default.post(name: .taliseTxCompleted, object: TaliseTxEvent(
                digest: sent.digest, direction: "sent", amountUsdsui: totalUsd,
                counterparty: to, counterpartyName: "Stream", venue: nil))
            withAnimation { started = true }
        } catch APIError.status(let code, let msg) {
            self.error = Self.friendlyStreamError(code: code, message: msg)
        } catch {
            if APIError.isCancellation(error) { return }
            self.error = "Couldn't start the stream right now."
        }
    }

    /// Map "backend isn't live yet" responses (404 / 503 / "not
    /// configured" / "disabled") to reassuring copy. Real, actionable
    /// server messages still pass through verbatim.
    static func friendlyStreamError(code: Int, message: String?) -> String {
        let lower = (message ?? "").lowercased()
        let rolloutPhrase = lower.contains("not configured") || lower.contains("disabled")
            || lower.contains("not found") || lower.contains("unavailable")
        if code == 404 || code == 503 || rolloutPhrase {
            return "Streaming is rolling out — check back soon."
        }
        if let msg = message, !msg.isEmpty { return msg }
        return "Couldn't start the stream right now."
    }
}

// MARK: - Active streams list

struct StreamsListView: View {
    var onDone: () -> Void
    @State private var streams: [StreamDTO] = []
    @State private var loading = true

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 14) {
                Eyebrow(text: "Your streams")
                if loading {
                    ProgressView().tint(TaliseColor.fg).frame(maxWidth: .infinity).padding(.top, 40)
                } else if streams.isEmpty {
                    VStack(spacing: 6) {
                        Text("No streams yet").font(TaliseFont.body(14)).foregroundStyle(TaliseColor.fg)
                        Text("Start one to drip money over time.").font(TaliseFont.mono(10)).foregroundStyle(TaliseColor.fgDim)
                    }.frame(maxWidth: .infinity).padding(.top, 40)
                } else {
                    ForEach(streams) { s in streamRow(s) }
                }
            }
            .padding(.horizontal, 22).padding(.top, 18).padding(.bottom, 30)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .presentationDragIndicator(.visible)
        .task { await load() }
    }

    private func streamRow(_ s: StreamDTO) -> some View {
        let total = s.totalUsd ?? 0
        let released = s.releasedUsd ?? 0
        let progress = total > 0 ? min(1, released / total) : 0
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(s.role == "recipient" ? "Streaming in" : "Streaming out")
                        .font(TaliseFont.mono(9)).tracking(1).foregroundStyle(TaliseColor.fgDim)
                    Text(s.recipientHandle ?? shortAddr(s.recipientAddress))
                        .font(TaliseFont.heading(15, weight: .medium)).foregroundStyle(TaliseColor.fg).lineLimit(1)
                }
                Spacer()
                Text(s.state.capitalized).font(TaliseFont.mono(9))
                    .foregroundStyle(s.state == "active" ? TaliseColor.accent : TaliseColor.fgMuted)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Capsule().fill(TaliseColor.surfaceGlass))
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(TaliseColor.surfaceGlass).frame(height: 6)
                    Capsule().fill(TaliseColor.greenMint).frame(width: geo.size.width * progress, height: 6)
                }
            }.frame(height: 6)
            HStack {
                Text("\(TaliseFormat.usd2(released)) of \(TaliseFormat.usd2(total))")
                    .font(TaliseFont.mono(10)).foregroundStyle(TaliseColor.fgMuted)
                Spacer()
                Text("\(s.tranchesDone ?? 0)/\(s.numTranches ?? 0) payments")
                    .font(TaliseFont.mono(10)).foregroundStyle(TaliseColor.fgDim)
            }
        }
        .padding(16).taliseGlass(cornerRadius: 18)
    }

    private func shortAddr(_ a: String?) -> String {
        guard let a, a.count > 10 else { return a ?? "—" }
        return "\(a.prefix(6))…\(a.suffix(4))"
    }

    private func load() async {
        loading = true; defer { loading = false }
        do {
            let r: StreamsResp = try await APIClient.shared.get("/api/streams")
            streams = r.streams
        } catch { streams = [] }
    }
}
