import Foundation
import Observation

/// Drives the Trade screen: loads markets / quote / candles / account, and runs
/// the write flows (create account, deposit, order, close, withdraw) over the
/// existing Onara-sponsored zkLogin rail — the server hands back sponsor-ready
/// bytes and `ZkLoginCoordinator.executeSponsorReady` signs + submits them.
@MainActor
@Observable
final class TradeService {
    // Market data
    var markets: [PerpMarket] = []
    var selected: String = "SUIUSD"
    var quote: MarketQuote?
    var quotes: [String: Double] = [:]   // live spot per ticker (picker prices)
    var candles: [Candle] = []
    var interval: String = "15m"

    // Account
    var account: PerpAccount?
    var history: [TradeLogEntry] = []

    // UI state
    var loadingMarkets = true
    var loadingChart = false
    var busy: String?          // non-nil label while a write is in flight
    var error: String?
    var disabled = false       // FEATURE_PERPS off / 503

    var market: PerpMarket? { markets.first { $0.symbol == selected } }
    /// Markets we can actually price (live quote or on-chain ref). Drops the
    /// ones that only ever show "—" (e.g. WTI/BRENT with no Pyth feed).
    var tradableMarkets: [PerpMarket] { markets.filter { priceFor($0.symbol) > 0 } }
    var positions: [PerpPosition] { account?.positions ?? [] }
    var availableUsd: Double { account?.availableUsd ?? 0 }
    var accountId: String? { account?.accountId }

    static let intervals = ["1m", "5m", "15m", "1h", "4h", "1d"]

    /// Live price: freshest quote spot, else the market ref price.
    var price: Double {
        if let s = quote?.spot, s > 0 { return s }
        if let s = quotes[selected], s > 0 { return s }
        return market?.refPriceUsd ?? 0
    }
    static let intervalSecs: [String: Double] = ["1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400]

    /// 24h change: the dedicated quote value when present, else derived from the
    /// loaded candles (~24h back vs latest close) so the header is never stuck
    /// at 0 when the single-quote fetch lags the batch price.
    var change24h: Double {
        if let c = quote?.change24h, abs(c) > 0.0001 { return c }
        guard candles.count >= 2 else { return 0 }
        let secs = Self.intervalSecs[interval] ?? 3600
        let barsBack = max(1, min(candles.count - 1, Int(86400 / secs)))
        let prev = candles[candles.count - 1 - barsBack].close
        let last = candles[candles.count - 1].close
        return prev > 0 ? (last - prev) / prev * 100 : 0
    }

    // MARK: - Loads

    func loadMarkets() async {
        do {
            let r: MarketsResponse = try await APIClient.shared.get("/api/markets")
            markets = r.markets
            disabled = false
            // Keep the selection on a priced, unpaused market.
            let priced = tradableMarkets
            if !priced.contains(where: { $0.symbol == selected }),
               let first = priced.first(where: { !$0.paused }) ?? priced.first {
                selected = first.symbol
            }
        } catch {
            if isDisabled(error) { disabled = true }
            else if !APIError.isCancellation(error) { self.error = APIError.honestMoneyError(error, fallback: "Couldn't load markets.") }
        }
        loadingMarkets = false
    }

    func loadQuote() async {
        do {
            quote = try await APIClient.shared.get("/api/markets/quote?symbol=\(selected)")
        } catch { /* soft: keep last quote */ }
    }

    /// Live spot for every market, for the picker (the on-chain refPrice lags).
    func loadQuotes() async {
        struct R: Decodable { let quotes: [String: Double] }
        do {
            let r: R = try await APIClient.shared.get("/api/markets/quotes")
            if !r.quotes.isEmpty { quotes = r.quotes }
        } catch { /* soft */ }
    }

    /// Best price for a market: live spot if we have it, else the on-chain ref.
    func priceFor(_ symbol: String) -> Double {
        if let s = quotes[symbol], s > 0 { return s }
        return markets.first { $0.symbol == symbol }?.refPriceUsd ?? 0
    }

    func loadChart() async {
        loadingChart = true
        defer { loadingChart = false }
        do {
            let r: CandlesResponse = try await APIClient.shared.get(
                "/api/markets/candles?symbol=\(selected)&interval=\(interval)")
            candles = r.candles
        } catch { /* soft: keep last candles */ }
    }

    func loadAccount() async {
        do {
            account = try await APIClient.shared.get("/api/markets/account")
        } catch {
            if !APIError.isCancellation(error) { /* soft */ }
        }
    }

    func loadHistory() async {
        do {
            let r: HistoryResponse = try await APIClient.shared.get("/api/markets/history")
            history = r.trades
        } catch { /* soft */ }
    }

    /// Full refresh of the currently-selected market + account.
    func refreshSelected() async {
        async let q: () = loadQuote()
        async let c: () = loadChart()
        async let a: () = loadAccount()
        async let qs: () = loadQuotes()
        _ = await (q, c, a, qs)
    }

    // MARK: - Writes (Onara-sponsored)

    private struct EmptyBody: Encodable {}

    /// Sign + submit sponsor-ready bytes, or accept a locally-executed digest.
    /// Returns the settled digest.
    @discardableResult
    private func settle(_ resp: SponsorPrepareResponse, intent: String,
                        rewards: ZkLoginCoordinator.RewardsMeta?) async throws -> String {
        if resp.mode == "executed", let d = resp.digest { return d }
        guard let bytes = resp.bytes else {
            throw TradeError(msg: "The server did not return a transaction to sign.")
        }
        let out = try await ZkLoginCoordinator.shared.executeSponsorReady(
            bytesB64: bytes, intent: intent, rewards: rewards)
        return out.digest
    }

    /// Create a trading account if missing, returning its object id. Web mints
    /// the account then `op:"link"`s the digest to resolve the new id.
    func ensureAccount() async throws -> String {
        if let id = accountId { return id }
        struct Create: Encodable { let op = "create"; let alias = "Talise" }
        let resp: SponsorPrepareResponse = try await APIClient.shared.post(
            "/api/markets/account", body: Create())
        if let id = resp.accountId { await loadAccount(); return id }   // local mode
        let digest = try await settle(resp, intent: "Create trading account",
                                      rewards: .init(kind: "invest", amountUsd: 0))
        struct Link: Encodable { let op = "link"; let digest: String }
        let linked: PerpAccount = try await APIClient.shared.post(
            "/api/markets/account", body: Link(digest: digest))
        account = linked
        guard let id = linked.accountId else {
            throw TradeError(msg: "Account created but could not be resolved. Pull to refresh.")
        }
        return id
    }

    func deposit(usd: Double) async throws {
        busy = "deposit"; error = nil; defer { busy = nil }
        let id = try await ensureAccount()
        struct Body: Encodable { let op = "deposit"; let accountId: String; let amountUsd: Double }
        let resp: SponsorPrepareResponse = try await APIClient.shared.post(
            "/api/markets/account", body: Body(accountId: id, amountUsd: usd))
        _ = try await settle(resp, intent: "Fund trading account",
                             rewards: .init(kind: "invest", amountUsd: usd))
        try? await Task.sleep(nanoseconds: 600_000_000)
        await loadAccount()
        await record(type: "deposit", collateralUsd: usd)
    }

    func withdraw(usd: Double) async throws {
        busy = "withdraw"; error = nil; defer { busy = nil }
        guard let id = accountId else { throw TradeError(msg: "No trading account yet.") }
        struct Body: Encodable { let op = "withdraw"; let accountId: String; let amountUsd: Double }
        let resp: SponsorPrepareResponse = try await APIClient.shared.post(
            "/api/markets/account", body: Body(accountId: id, amountUsd: usd))
        _ = try await settle(resp, intent: "Withdraw from trading account",
                             rewards: .init(kind: "withdraw", amountUsd: usd))
        try? await Task.sleep(nanoseconds: 600_000_000)
        await loadAccount()
        await record(type: "withdraw", collateralUsd: usd)
    }

    struct OrderInput {
        let isLong: Bool
        let sizeTokens: Double
        let collateralUsd: Double
        let acceptablePriceUsd: Double
        let tpPriceUsd: Double?
        let slPriceUsd: Double?
    }

    func placeOrder(_ o: OrderInput) async throws {
        busy = "order"; error = nil; defer { busy = nil }
        let id = try await ensureAccount()
        struct Body: Encodable {
            let ticker: String; let accountId: String; let isLong: Bool
            let sizeTokens: Double; let collateralUsd: Double; let acceptablePriceUsd: Double
            let tpPriceUsd: Double?; let slPriceUsd: Double?
        }
        let body = Body(ticker: selected, accountId: id, isLong: o.isLong,
                        sizeTokens: o.sizeTokens, collateralUsd: o.collateralUsd,
                        acceptablePriceUsd: o.acceptablePriceUsd,
                        tpPriceUsd: o.tpPriceUsd, slPriceUsd: o.slPriceUsd)
        let resp: SponsorPrepareResponse = try await APIClient.shared.post(
            "/api/markets/order/prepare", body: body)
        _ = try await settle(resp, intent: "\(o.isLong ? "Long" : "Short") \(market?.sym ?? selected)",
                             rewards: .init(kind: "invest", amountUsd: o.collateralUsd))
        try? await Task.sleep(nanoseconds: 700_000_000)
        await loadAccount()
        await record(type: "open", ticker: selected, side: o.isLong ? "long" : "short",
                     sizeTokens: o.sizeTokens, priceUsd: o.acceptablePriceUsd,
                     collateralUsd: o.collateralUsd)
    }

    /// Close a position. Returns realized PnL so the UI can show a result card.
    @discardableResult
    func close(_ p: PerpPosition) async throws -> Double {
        busy = "close:\(p.positionId)"; error = nil; defer { busy = nil }
        guard let id = accountId else { throw TradeError(msg: "No trading account.") }
        struct Body: Encodable {
            let ticker: String; let accountId: String; let positionId: String; let isLong: Bool
        }
        let resp: SponsorPrepareResponse = try await APIClient.shared.post(
            "/api/markets/close",
            body: Body(ticker: p.ticker, accountId: id, positionId: p.positionId, isLong: p.isLong))
        _ = try await settle(resp, intent: "Close \(p.ticker)",
                             rewards: .init(kind: "withdraw", amountUsd: max(0, p.pnlUsd)))
        try? await Task.sleep(nanoseconds: 700_000_000)
        await loadAccount()
        await record(type: "close", ticker: p.ticker, side: p.isLong ? "long" : "short",
                     sizeTokens: p.sizeTokens, priceUsd: p.markPriceUsd,
                     pnlUsd: p.pnlUsd, feeUsd: resp.feeUsd)
        return p.pnlUsd
    }

    // MARK: - History recording

    private func record(type: String, ticker: String? = nil, side: String? = nil,
                        sizeTokens: Double? = nil, priceUsd: Double? = nil,
                        collateralUsd: Double? = nil, pnlUsd: Double? = nil,
                        feeUsd: Double? = nil) async {
        struct Body: Encodable {
            let type: String; let ticker: String?; let side: String?
            let sizeTokens: Double?; let priceUsd: Double?; let collateralUsd: Double?
            let pnlUsd: Double?; let feeUsd: Double?
        }
        struct Ack: Decodable { let ok: Bool? }
        _ = try? await APIClient.shared.post("/api/markets/history",
            body: Body(type: type, ticker: ticker, side: side, sizeTokens: sizeTokens,
                       priceUsd: priceUsd, collateralUsd: collateralUsd,
                       pnlUsd: pnlUsd, feeUsd: feeUsd)) as Ack
        await loadHistory()
    }

    private func isDisabled(_ error: Error) -> Bool {
        if case APIError.status(let status, _) = error, status == 503 { return true }
        return false
    }
}
