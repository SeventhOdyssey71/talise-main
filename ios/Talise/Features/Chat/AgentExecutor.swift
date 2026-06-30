import Foundation

/// One executed step's outcome: a human line plus the structured bits needed to
/// render a shareable receipt (amount, who, on-chain digest). `Codable` so a
/// completed turn persists with its conversation — reopening a saved chat shows
/// the receipt again instead of re-prompting to confirm.
struct AgentActionResult: Identifiable, Hashable, Codable {
    var id = UUID()
    let line: String
    var kind: String = ""
    var amountUsd: Double? = nil
    var recipient: String? = nil
    var venue: String? = nil
    var digest: String? = nil
}

/// Runs a confirmed Talise Agent plan — the ONLY place the agent path moves
/// money. Read-only steps fetch + format inline (no signature); write steps
/// (`ok` only) call the same prepare + sign endpoints the manual flows use, so
/// every guardrail (caps, screening, gasless minimum) is already enforced
/// server-side. Posts `.taliseTxCompleted` per executed money step exactly like
/// `PayTeamView` / `EarnView` so Home reconciles optimistically.
@MainActor
enum AgentExecutor {
    /// Run the read-only steps of an intent and return one display line each.
    /// Never signs. Used for "what's my balance / show my activity" turns.
    static func runReadOnly(_ steps: [AgentStep]) async throws -> [String] {
        var lines: [String] = []
        for step in steps where step.isReadOnly {
            switch step.kind {
            case "check_balance":
                let b: BalancesDTO = try await APIClient.shared.get("/api/balances")
                lines.append("Available: \(TaliseFormat.usd2(b.usdsui)) · Total \(TaliseFormat.usd2(b.totalUsd))")
            case "check_yield":
                let cmp: YieldComparison = try await APIClient.shared.get("/api/yield/comparison")
                let supplied = cmp.venues.compactMap { $0.supplied }.reduce(0, +)
                let earned = cmp.venues.compactMap { $0.earned }.reduce(0, +)
                if supplied > 0 {
                    var s = "Saved \(TaliseFormat.usd2(supplied)) earning"
                    if let best = cmp.best { s += " up to \(String(format: "%.1f", best.apy))% APY" }
                    if earned > 0 { s += " · \(TaliseFormat.usd2(earned)) earned so far" }
                    lines.append(s)
                } else if let best = cmp.best {
                    lines.append("Nothing saved yet. Best rate is \(String(format: "%.1f", best.apy))% APY.")
                } else {
                    lines.append("Nothing saved yet.")
                }
            case "show_activity":
                let n = max(1, min(step.limit ?? 8, 25))
                let r: ActivityResponse = try await APIClient.shared.get("/api/activity?limit=\(n)")
                if r.entries.isEmpty {
                    lines.append("No recent activity.")
                } else {
                    for e in r.entries.prefix(n) { lines.append(activityLine(e)) }
                }
            default:
                break
            }
        }
        return lines
    }

    /// Execute every `ok` write step of a validated plan, in order. `intent` is
    /// the original proposal (same length + order as `plan.steps`) — we read
    /// the venue / recipient fallback from it since the plan response doesn't
    /// echo those. Returns one confirmation line per executed step. Throws on
    /// the first failure (the card surfaces it via `honestMoneyError`).
    static func execute(plan: AgentPlanDTO, intent: AgentIntent) async throws -> [AgentActionResult] {
        var results: [AgentActionResult] = []
        let steps = intent.steps
        for (idx, planned) in plan.steps.enumerated() {
            guard planned.isOk else { continue }
            let step = idx < steps.count ? steps[idx] : nil

            switch planned.kind {
            case "send":
                // Defense-in-depth: a send executes ONLY against the
                // server-resolved, screened recipient + the server-validated
                // amount from the plan, never the model's raw proposal
                // (step.recipient / step.amount). If the server didn't resolve
                // both for an "ok" step, skip it rather than sign LLM-supplied
                // money movement.
                guard let to = planned.resolved?.address, !to.isEmpty,
                      let amount = planned.amountUsd, amount > 0 else { continue }
                let name = planned.resolved?.displayName
                let sub = try await ZkLoginCoordinator.shared.signAndSubmitSend(
                    to: to,
                    amountUsd: amount,
                    intent: "Send \(TaliseFormat.usd2(amount)) to \(name ?? to)"
                )
                postCompleted(direction: "sent", amountUsd: amount,
                              counterparty: to, counterpartyName: name, venue: nil,
                              digest: sub.digest)
                results.append(AgentActionResult(
                    line: "Sent \(TaliseFormat.usd2(amount)) to \(name ?? shortAddr(to)).",
                    kind: "send", amountUsd: amount, recipient: name ?? shortAddr(to), digest: sub.digest))

            case "save":
                let amount = planned.amountUsd ?? step?.amount ?? 0
                guard amount > 0 else { continue }
                let venue = step?.venue ?? "navi"
                struct Body: Encodable { let venue: String; let amount: Double }
                let built: BuildKindResponse = try await APIClient.shared.post(
                    "/api/earn/supply/prepare", body: Body(venue: venue, amount: amount)
                )
                let sub = try await ZkLoginCoordinator.shared.signAndSubmit(
                    transactionKindB64: built.transactionKindB64,
                    intent: "Save \(TaliseFormat.usd2(amount))",
                    rewards: .init(kind: "invest", amountUsd: amount, venue: venue)
                )
                postCompleted(direction: "invest", amountUsd: amount,
                              counterparty: nil, counterpartyName: nil, venue: venue,
                              digest: sub.digest)
                results.append(AgentActionResult(
                    line: "Saved \(TaliseFormat.usd2(amount)) into \(displayVenue(venue)).",
                    kind: "save", amountUsd: amount, recipient: displayVenue(venue), digest: sub.digest))

            case "withdraw":
                let amount = planned.amountUsd ?? step?.amount ?? 0
                guard amount > 0 else { continue }
                let venue = step?.venue ?? "navi"
                struct Body: Encodable { let venue: String; let amount: Double? }
                let built: BuildKindResponse = try await APIClient.shared.post(
                    "/api/earn/withdraw/prepare", body: Body(venue: venue, amount: amount)
                )
                let sub = try await ZkLoginCoordinator.shared.signAndSubmit(
                    transactionKindB64: built.transactionKindB64,
                    intent: "Withdraw \(TaliseFormat.usd2(amount))",
                    rewards: .init(kind: "withdraw", amountUsd: amount, venue: venue)
                )
                postCompleted(direction: "withdraw", amountUsd: amount,
                              counterparty: nil, counterpartyName: nil, venue: venue,
                              digest: sub.digest)
                results.append(AgentActionResult(
                    line: "Withdrew \(TaliseFormat.usd2(amount)) from \(displayVenue(venue)).",
                    kind: "withdraw", amountUsd: amount, recipient: displayVenue(venue), digest: sub.digest))

            case "claim_rewards":
                let venue = step?.venue ?? "navi"
                struct Body: Encodable { let venue: String }
                let built: BuildKindResponse = try await APIClient.shared.post(
                    "/api/earn/withdraw-earned/prepare", body: Body(venue: venue)
                )
                let sub = try await ZkLoginCoordinator.shared.signAndSubmit(
                    transactionKindB64: built.transactionKindB64,
                    intent: "Claim rewards",
                    rewards: .init(kind: "withdraw", amountUsd: 0, venue: venue)
                )
                postCompleted(direction: "withdraw", amountUsd: 0,
                              counterparty: nil, counterpartyName: nil, venue: venue,
                              digest: sub.digest)
                results.append(AgentActionResult(
                    line: "Claimed your \(displayVenue(venue)) rewards.",
                    kind: "claim_rewards", digest: sub.digest))

            case "cash_out":
                // Server loads the user's linked bank, creates the Linq order,
                // and hands back the deposit wallet + exact amount to send. We
                // sign a normal sponsored send to it; Linq pays the bank.
                guard let amount = planned.amountUsd, amount > 0 else { continue }
                struct CashoutBody: Encodable { let amountUsd: Double }
                struct CashoutPrep: Decodable {
                    let walletAddress: String
                    let amountUsdsui: Double
                    let amountNgn: Double?
                    let bankLast4: String?
                }
                let prep: CashoutPrep = try await APIClient.shared.post(
                    "/api/agent/cashout/prepare", body: CashoutBody(amountUsd: amount)
                )
                let sub = try await ZkLoginCoordinator.shared.signAndSubmitSend(
                    to: prep.walletAddress,
                    amountUsd: prep.amountUsdsui,
                    intent: "Cash out \(TaliseFormat.usd2(prep.amountUsdsui)) to your bank"
                )
                postCompleted(direction: "sent", amountUsd: prep.amountUsdsui,
                              counterparty: prep.walletAddress, counterpartyName: "Bank cash-out",
                              venue: nil, digest: sub.digest)
                let dest = prep.bankLast4.map { "your bank ••\($0)" } ?? "your bank"
                results.append(AgentActionResult(
                    line: "Cashed out \(TaliseFormat.usd2(prep.amountUsdsui)) to \(dest).",
                    kind: "cash_out", amountUsd: prep.amountUsdsui, recipient: dest, digest: sub.digest))

            default:
                // swap and any future kinds aren't executable from chat yet,
                // skip rather than fail the whole plan.
                break
            }
        }
        return results
    }

    // MARK: - Helpers

    private static func postCompleted(
        direction: String, amountUsd: Double,
        counterparty: String?, counterpartyName: String?, venue: String?,
        digest: String
    ) {
        NotificationCenter.default.post(
            name: .taliseTxCompleted,
            object: TaliseTxEvent(
                digest: digest,
                direction: direction,
                amountUsdsui: amountUsd,
                counterparty: counterparty,
                counterpartyName: counterpartyName,
                venue: venue
            )
        )
    }

    private static func activityLine(_ e: ActivityEntryDTO) -> String {
        let amt = TaliseFormat.usd2(abs(e.amountUsdsui ?? 0))
        let who = e.counterpartyName ?? e.counterparty.map(shortAddr) ?? ""
        switch e.direction {
        case "received": return "Received \(amt)" + (who.isEmpty ? "" : " from \(who)")
        case "invest":   return "Saved \(amt)" + (e.venue.map { " into \(displayVenue($0))" } ?? "")
        case "withdraw": return "Withdrew \(amt)" + (e.venue.map { " from \(displayVenue($0))" } ?? "")
        default:         return "Sent \(amt)" + (who.isEmpty ? "" : " to \(who)")
        }
    }

    private static func displayVenue(_ v: String) -> String {
        switch v.lowercased() {
        case "deepbook": return "DeepBook"
        case "navi": return "NAVI"
        default: return v.capitalized
        }
    }

    private static func shortAddr(_ a: String) -> String {
        if a.hasPrefix("0x"), a.count > 12 { return "\(a.prefix(6))…\(a.suffix(4))" }
        return a
    }
}
