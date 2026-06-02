import SwiftUI

// MARK: - DTOs

private struct ChequeCreateResp: Decodable {
    let chequeId: String
    let escrowAddress: String
    let amountUsd: Double
    let claimUrl: String
    let secret: String
}
private struct ChequeConfirmResp: Decodable { let ok: Bool }
private struct ChequePreviewResp: Decodable {
    let id: String
    let amountUsd: Double
    let status: String
    let payeeLabel: String?
    let memo: String?
    let signatureName: String?
    let creatorDisplay: String
    let allowedCountries: [String]
    let expiresAt: Double
    let claimable: Bool
}
private struct ChequeClaimResp: Decodable { let ok: Bool; let digest: String?; let amountUsd: Double? }

// MARK: - Skeuomorphic cheque card

/// A paper-cheque visual: cream stock on the dark app surface, engraved
/// header, pay-to-the-order-of line, a boxed figure amount, the amount in
/// words, memo + signature lines, and a status stamp. Used read-only on the
/// issued/claim screens; the write screen overlays editable fields.
struct ChequeCard<Fields: View>: View {
    var amountUsd: Double
    var payee: String
    var memo: String
    var signature: String
    var chequeNo: String
    var stamp: String? = nil
    @ViewBuilder var fields: () -> Fields

    private let ink = Color(hex: 0x2A2A2A)
    private let inkSoft = Color(hex: 0x6B6357)
    private let paper = Color(hex: 0xF4EFE2)
    private let rule = Color(hex: 0x9C9486)

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(
                    LinearGradient(colors: [Color(hex: 0xF7F3E8), Color(hex: 0xEDE6D5)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                )
            VStack(alignment: .leading, spacing: 0) {
                // Header band
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("TALISE")
                            .font(.system(size: 15, weight: .heavy, design: .serif))
                            .foregroundStyle(TaliseColor.greenDeep)
                            .tracking(2)
                        Text("PAY ANYONE, ANYWHERE")
                            .font(.system(size: 6, weight: .regular, design: .monospaced))
                            .tracking(1.5)
                            .foregroundStyle(inkSoft)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 1) {
                        Text("No. \(chequeNo)")
                            .font(.system(size: 9, weight: .medium, design: .monospaced))
                            .foregroundStyle(inkSoft)
                        Text("USDsui")
                            .font(.system(size: 9, weight: .semibold, design: .serif))
                            .foregroundStyle(ink)
                    }
                }
                Rectangle().fill(rule.opacity(0.5)).frame(height: 1).padding(.top, 8)

                // Pay to the order of + figure box
                HStack(alignment: .bottom, spacing: 10) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("PAY TO THE ORDER OF")
                            .font(.system(size: 7, weight: .regular, design: .monospaced))
                            .tracking(1)
                            .foregroundStyle(inkSoft)
                        Text(payee.isEmpty ? "—" : payee)
                            .font(.system(size: 17, weight: .semibold, design: .serif))
                            .foregroundStyle(ink)
                            .lineLimit(1)
                        Rectangle().fill(rule.opacity(0.6)).frame(height: 1)
                    }
                    VStack(spacing: 2) {
                        Text(TaliseFormat.usd2(amountUsd))
                            .font(.system(size: 18, weight: .bold, design: .serif))
                            .foregroundStyle(ink)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(RoundedRectangle(cornerRadius: 6).stroke(ink.opacity(0.5), lineWidth: 1.2))
                    }
                }
                .padding(.top, 14)

                // Amount in words
                HStack(spacing: 6) {
                    Text(amountInWords(amountUsd))
                        .font(.system(size: 11, weight: .medium, design: .serif))
                        .italic()
                        .foregroundStyle(ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Rectangle().fill(rule.opacity(0.6)).frame(height: 1)
                    Text("USDsui").font(.system(size: 9, design: .serif)).foregroundStyle(inkSoft)
                }
                .padding(.top, 12)

                Spacer(minLength: 14)

                // Memo + signature
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(memo.isEmpty ? " " : memo)
                            .font(.system(size: 10, design: .serif)).foregroundStyle(ink).lineLimit(1)
                        Rectangle().fill(rule.opacity(0.5)).frame(width: 110, height: 1)
                        Text("MEMO").font(.system(size: 6, design: .monospaced)).foregroundStyle(inkSoft)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(signature.isEmpty ? " " : signature)
                            .font(.custom("SnellRoundhand-Bold", size: 18))
                            .foregroundStyle(TaliseColor.greenDeep).lineLimit(1)
                        Rectangle().fill(rule.opacity(0.5)).frame(width: 120, height: 1)
                        Text("AUTHORIZED SIGNATURE").font(.system(size: 6, design: .monospaced)).foregroundStyle(inkSoft)
                    }
                }
            }
            .padding(18)

            // Editable overlays (write screen) — laid over the paper.
            fields()

            if let stamp {
                Text(stamp)
                    .font(.system(size: 26, weight: .heavy, design: .rounded))
                    .tracking(2)
                    .foregroundStyle(Color(hex: 0xA23B2E).opacity(0.85))
                    .rotationEffect(.degrees(-14))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(Color(hex: 0xA23B2E).opacity(0.85), lineWidth: 3)
                            .padding(-8)
                    )
                    .rotationEffect(.degrees(0))
                    .opacity(0.9)
            }
        }
        .frame(height: 210)
        .shadow(color: .black.opacity(0.4), radius: 14, x: 0, y: 8)
    }
}

extension ChequeCard where Fields == EmptyView {
    init(amountUsd: Double, payee: String, memo: String, signature: String, chequeNo: String, stamp: String? = nil) {
        self.init(amountUsd: amountUsd, payee: payee, memo: memo, signature: signature,
                  chequeNo: chequeNo, stamp: stamp, fields: { EmptyView() })
    }
}

// MARK: - Write a cheque

struct ChequeWriteView: View {
    var onDone: () -> Void
    @Environment(AppSession.self) private var session
    @State private var amountText = ""
    @State private var payee = ""
    @State private var memo = ""
    @State private var gateCountry = false
    @State private var country = "NG"
    @State private var issuing = false
    @State private var error: String?
    @State private var issued: ChequeCreateResp?

    private var amountUsd: Double { Double(amountText) ?? 0 }
    private var signatureName: String {
        if case .ready(let u) = session.phase { return u.name ?? "Talise" }
        return "Talise"
    }

    var body: some View {
        if let issued {
            ChequeIssuedView(resp: issued, payee: payee, memo: memo, signature: signatureName, onDone: onDone)
        } else {
            authoring
        }
    }

    private var authoring: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 22) {
                header
                ChequeCard(amountUsd: amountUsd, payee: payee, memo: memo,
                           signature: signatureName, chequeNo: "•••••") {
                    EmptyView()
                }
                fieldsCard
                if let error {
                    Text(error).font(TaliseFont.body(12)).foregroundStyle(TaliseColor.danger)
                }
                Color.clear.frame(height: 90)
            }
            .padding(.horizontal, 22).padding(.top, 18)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .overlay(alignment: .bottom) { issueBar }
        .presentationDragIndicator(.visible)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Eyebrow(text: "Write a cheque")
            Text("Money in a link")
                .font(TaliseFont.heading(24, weight: .medium)).kerning(-0.8)
                .foregroundStyle(TaliseColor.fg)
            Text("Send it in any DM. They claim it as real money.")
                .font(TaliseFont.body(13, weight: .light)).foregroundStyle(TaliseColor.fgMuted)
        }
    }

    private var fieldsCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            labeled("AMOUNT (USDsui)") {
                HStack {
                    Text("$").font(TaliseFont.heading(18)).foregroundStyle(TaliseColor.fgMuted)
                    TextField("0.00", text: $amountText)
                        .keyboardType(.decimalPad)
                        .font(TaliseFont.display(22, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                }
            }
            labeled("PAY TO (name on the cheque)") {
                TextField("e.g. Sele", text: $payee)
                    .font(TaliseFont.body(15)).foregroundStyle(TaliseColor.fg)
            }
            labeled("MEMO (optional)") {
                TextField("What's it for?", text: $memo)
                    .font(TaliseFont.body(15)).foregroundStyle(TaliseColor.fg)
            }
            Toggle(isOn: $gateCountry) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Restrict by country").font(TaliseFont.body(14)).foregroundStyle(TaliseColor.fg)
                    Text("Only claimable from one country (IP-checked)")
                        .font(TaliseFont.mono(9)).foregroundStyle(TaliseColor.fgDim)
                }
            }
            .tint(TaliseColor.greenDeep)
            if gateCountry {
                labeled("COUNTRY (ISO code)") {
                    TextField("NG", text: $country)
                        .textInputAutocapitalization(.characters)
                        .font(TaliseFont.body(15)).foregroundStyle(TaliseColor.fg)
                }
            }
            HStack(spacing: 6) {
                Image(systemName: "checkmark.shield.fill").font(.system(size: 11)).foregroundStyle(TaliseColor.accent)
                Text("Always protected: captcha + no-VPN on claim")
                    .font(TaliseFont.mono(9)).foregroundStyle(TaliseColor.fgDim)
            }
        }
        .padding(18)
        .taliseGlass(cornerRadius: 20)
    }

    private func labeled<V: View>(_ label: String, @ViewBuilder _ content: () -> V) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label).font(TaliseFont.mono(9)).tracking(1.5).foregroundStyle(TaliseColor.fgDim)
            content()
            Rectangle().fill(TaliseColor.line).frame(height: 1)
        }
    }

    private var issueBar: some View {
        VStack(spacing: 0) {
            SlideToConfirm(title: issuing ? "Issuing…" : "Slide to sign & fund") {
                await issue()
            }
            .disabled(issuing || amountUsd < 0.01 || payee.isEmpty)
            .opacity(issuing || amountUsd < 0.01 || payee.isEmpty ? 0.5 : 1)
        }
        .padding(.horizontal, 22).padding(.top, 12).padding(.bottom, 24)
        .background(LinearGradient(colors: [TaliseColor.bg.opacity(0), TaliseColor.bg], startPoint: .top, endPoint: .bottom).ignoresSafeArea())
    }

    private func issue() async {
        guard amountUsd >= 0.01, !payee.isEmpty else { return }
        issuing = true; error = nil
        defer { issuing = false }
        struct CreateBody: Encodable { let amountUsd: Double; let payeeLabel: String; let memo: String?; let allowedCountries: [String] }
        do {
            let created: ChequeCreateResp = try await APIClient.shared.post(
                "/api/cheques/create",
                body: CreateBody(amountUsd: amountUsd, payeeLabel: payee,
                                 memo: memo.isEmpty ? nil : memo,
                                 allowedCountries: gateCountry ? [country.uppercased()] : [])
            )
            // Fund the escrow over the normal send rail (gasless / sponsored).
            let sent = try await ZkLoginCoordinator.shared.signAndSubmitSend(
                to: created.escrowAddress, amountUsd: amountUsd, intent: "Fund cheque"
            )
            struct ConfirmBody: Encodable { let digest: String }
            let _: ChequeConfirmResp = try await APIClient.shared.post(
                "/api/cheques/\(created.chequeId)/confirm-funded", body: ConfirmBody(digest: sent.digest)
            )
            NotificationCenter.default.post(name: .taliseTxCompleted, object: TaliseTxEvent(
                digest: sent.digest, direction: "sent", amountUsdsui: amountUsd,
                counterparty: created.escrowAddress, counterpartyName: "Cheque", venue: nil
            ))
            withAnimation { issued = created }
        } catch APIError.status(let code, let msg) {
            self.error = chequeError(code: code, message: msg, verb: "issue")
        } catch {
            if APIError.isCancellation(error) { return }
            self.error = "Couldn't issue the cheque right now."
        }
    }
}

/// Map "backend isn't live yet" cheque responses (404 / 503 /
/// "disabled" / "not configured") to reassuring rollout copy, instead
/// of leaking "HTTP 404". Real, actionable server messages pass through.
func chequeError(code: Int, message: String?, verb: String) -> String {
    let lower = (message ?? "").lowercased()
    let rolloutPhrase = lower.contains("not configured") || lower.contains("disabled")
        || lower.contains("not found") || lower.contains("unavailable")
    if code == 404 || code == 503 || rolloutPhrase {
        return "Cheques are rolling out — check back soon."
    }
    if let msg = message, !msg.isEmpty { return msg }
    return "Couldn't \(verb) the cheque right now."
}

// MARK: - Issued (share)

private struct ChequeIssuedView: View {
    let resp: ChequeCreateResp
    let payee: String
    let memo: String
    let signature: String
    var onDone: () -> Void
    @State private var sharing = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer(minLength: 8)
            Text("Cheque issued").font(TaliseFont.heading(22, weight: .medium)).foregroundStyle(TaliseColor.fg)
            ChequeCard(amountUsd: resp.amountUsd, payee: payee, memo: memo,
                       signature: signature, chequeNo: String(resp.chequeId.suffix(5)), stamp: "ISSUED")
                .padding(.horizontal, 22)
            Text("Send this link in any DM. They claim it as money.")
                .font(TaliseFont.body(13, weight: .light)).foregroundStyle(TaliseColor.fgMuted)
                .multilineTextAlignment(.center).padding(.horizontal, 30)
            Spacer()
            VStack(spacing: 10) {
                Button { sharing = true } label: {
                    HStack { Image(systemName: "square.and.arrow.up"); Text("Share cheque link") }
                        .font(TaliseFont.heading(16, weight: .medium))
                        .foregroundStyle(Color(hex: 0x0A130D))
                        .frame(maxWidth: .infinity).frame(height: 54)
                        .background(Capsule().fill(TaliseColor.greenMint))
                }.buttonStyle(.plain)
                Button(action: onDone) {
                    Text("Done").font(TaliseFont.body(15)).foregroundStyle(TaliseColor.fgMuted)
                        .frame(maxWidth: .infinity).frame(height: 44)
                }.buttonStyle(.plain)
            }.padding(.horizontal, 22).padding(.bottom, 24)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .sheet(isPresented: $sharing) { ShareSheet(items: [URL(string: resp.claimUrl) ?? resp.claimUrl]) }
    }
}

// MARK: - Claim a cheque

struct ChequeClaimView: View {
    var onDone: () -> Void
    @State private var linkText = ""
    @State private var preview: ChequePreviewResp?
    @State private var parsed: (id: String, secret: String)?
    @State private var loading = false
    @State private var claiming = false
    @State private var error: String?
    @State private var claimedAmount: Double?

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 20) {
                Eyebrow(text: "Cash a cheque")
                if let claimedAmount {
                    cashed(claimedAmount)
                } else if let p = preview {
                    cheque(p)
                } else {
                    paste
                }
                if let error { Text(error).font(TaliseFont.body(12)).foregroundStyle(TaliseColor.danger) }
            }
            .padding(.horizontal, 22).padding(.top, 18).padding(.bottom, 40)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .presentationDragIndicator(.visible)
    }

    private var paste: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Paste a cheque link").font(TaliseFont.heading(20, weight: .medium)).foregroundStyle(TaliseColor.fg)
            TextField("https://talise.io/c/…", text: $linkText, axis: .vertical)
                .font(TaliseFont.body(13)).foregroundStyle(TaliseColor.fg)
                .padding(14).taliseGlass(cornerRadius: 14)
            Button { Task { await load() } } label: {
                Text(loading ? "Loading…" : "Open cheque")
                    .font(TaliseFont.heading(16, weight: .medium)).foregroundStyle(Color(hex: 0x0A130D))
                    .frame(maxWidth: .infinity).frame(height: 52)
                    .background(Capsule().fill(TaliseColor.greenMint))
            }.buttonStyle(.plain).disabled(loading || linkText.isEmpty)
        }
    }

    private func cheque(_ p: ChequePreviewResp) -> some View {
        VStack(spacing: 18) {
            Text("From \(p.creatorDisplay)").font(TaliseFont.body(13)).foregroundStyle(TaliseColor.fgMuted)
            ChequeCard(amountUsd: p.amountUsd, payee: p.payeeLabel ?? "You",
                       memo: p.memo ?? "", signature: p.signatureName ?? "",
                       chequeNo: String(p.id.suffix(5)),
                       stamp: p.claimable ? nil : p.status.uppercased())
            if !p.allowedCountries.isEmpty {
                Label("Claimable only from \(p.allowedCountries.joined(separator: ", "))",
                      systemImage: "globe").font(TaliseFont.mono(10)).foregroundStyle(TaliseColor.fgDim)
            }
            if p.claimable {
                SlideToConfirm(title: claiming ? "Cashing…" : "Slide to cash this cheque") {
                    await claim()
                }
                .disabled(claiming)
                .opacity(claiming ? 0.5 : 1)
            } else {
                Text("This cheque is \(p.status).").font(TaliseFont.body(13)).foregroundStyle(TaliseColor.fgMuted)
            }
        }
    }

    private func cashed(_ amt: Double) -> some View {
        VStack(spacing: 16) {
            Spacer(minLength: 30)
            Image(systemName: "checkmark.seal.fill").font(.system(size: 56)).foregroundStyle(TaliseColor.accent)
            Text("\(TaliseFormat.local2(amt)) cashed").font(TaliseFont.heading(22, weight: .medium)).foregroundStyle(TaliseColor.fg)
            Text("It's in your Talise balance.").font(TaliseFont.body(13)).foregroundStyle(TaliseColor.fgMuted)
            Button(action: onDone) {
                Text("Done").font(TaliseFont.heading(16, weight: .medium)).foregroundStyle(Color(hex: 0x0A130D))
                    .frame(maxWidth: .infinity).frame(height: 52).background(Capsule().fill(TaliseColor.greenMint))
            }.buttonStyle(.plain).padding(.top, 10)
        }
    }

    /// Parse `…/c/<id>#<secret>` (or `talise://c/<id>#<secret>`).
    private func parse(_ s: String) -> (String, String)? {
        guard let hash = s.firstIndex(of: "#") else { return nil }
        let secret = String(s[s.index(after: hash)...])
        let beforeHash = String(s[..<hash])
        guard let slash = beforeHash.range(of: "/c/", options: .backwards) else { return nil }
        let id = String(beforeHash[slash.upperBound...])
        guard !id.isEmpty, !secret.isEmpty else { return nil }
        return (id, secret)
    }

    private func load() async {
        guard let (id, secret) = parse(linkText.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            error = "That doesn't look like a cheque link."; return
        }
        loading = true; error = nil; defer { loading = false }
        do {
            let p: ChequePreviewResp = try await APIClient.shared.get(
                "/api/cheques/\(id)/preview?s=\(secret)"
            )
            parsed = (id, secret); preview = p
        } catch APIError.status(let code, let msg) where isRollout(code, msg) {
            // Service genuinely not live yet (503 / "disabled"). A bare
            // 404 here is ambiguous — it usually means an invalid or
            // already-claimed cheque — so that keeps its own copy below.
            self.error = "Cheques are rolling out — check back soon."
        } catch {
            if APIError.isCancellation(error) { return }
            self.error = "Couldn't open this cheque — it may be invalid or already claimed."
        }
    }

    private func isRollout(_ code: Int, _ msg: String?) -> Bool {
        let lower = (msg ?? "").lowercased()
        return code == 503 || lower.contains("disabled") || lower.contains("not configured")
    }

    private func claim() async {
        guard let (id, secret) = parsed else { return }
        claiming = true; error = nil; defer { claiming = false }
        struct ClaimBody: Encodable { let secret: String; let turnstileToken: String? }
        do {
            let r: ChequeClaimResp = try await APIClient.shared.post(
                "/api/cheques/\(id)/claim/release", body: ClaimBody(secret: secret, turnstileToken: nil)
            )
            if r.ok {
                if let d = r.digest, let amt = r.amountUsd {
                    NotificationCenter.default.post(name: .taliseTxCompleted, object: TaliseTxEvent(
                        digest: d, direction: "received", amountUsdsui: amt,
                        counterparty: nil, counterpartyName: "Cheque", venue: nil))
                }
                withAnimation { claimedAmount = r.amountUsd ?? preview?.amountUsd }
            }
        } catch APIError.status(let code, let msg) {
            self.error = chequeError(code: code, message: msg, verb: "cash")
        } catch {
            if APIError.isCancellation(error) { return }
            self.error = "Couldn't cash this cheque right now."
        }
    }
}

// MARK: - Share sheet shim

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

// MARK: - Amount in words (cheque convention)

func amountInWords(_ usd: Double) -> String {
    let whole = Int(usd)
    let cents = Int((usd - Double(whole)) * 100 + 0.5)
    let dollars = whole == 0 ? "Zero" : numberToWords(whole)
    let centStr = String(format: "%02d", cents)
    return "\(dollars) and \(centStr)/100".capitalizedFirst
}

private func numberToWords(_ n: Int) -> String {
    if n == 0 { return "zero" }
    let ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
                "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
                "seventeen", "eighteen", "nineteen"]
    let tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
    func under1000(_ x: Int) -> String {
        var parts: [String] = []
        let h = x / 100, r = x % 100
        if h > 0 { parts.append("\(ones[h]) hundred") }
        if r >= 20 {
            let t = tens[r / 10]; let o = r % 10
            parts.append(o > 0 ? "\(t)-\(ones[o])" : t)
        } else if r > 0 { parts.append(ones[r]) }
        return parts.joined(separator: " ")
    }
    var out: [String] = []
    let millions = n / 1_000_000
    let thousands = (n / 1000) % 1000
    let rest = n % 1000
    if millions > 0 { out.append("\(under1000(millions)) million") }
    if thousands > 0 { out.append("\(under1000(thousands)) thousand") }
    if rest > 0 { out.append(under1000(rest)) }
    return out.joined(separator: " ")
}

private extension String {
    var capitalizedFirst: String { isEmpty ? self : prefix(1).uppercased() + dropFirst() }
}
