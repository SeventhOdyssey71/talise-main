import Foundation
import SwiftUI

// MARK: - Wire models (mirror /api/markets/* JSON exactly)

/// One WaterX perp market, as returned by `GET /api/markets`.
struct PerpMarket: Decodable, Identifiable, Hashable {
    let symbol: String          // "SUIUSD"
    let name: String            // "Sui"
    let sym: String             // "SUI"
    let category: String        // crypto | stock | fx | commodity
    let marketId: String
    let paused: Bool
    let refPriceUsd: Double
    let maxLeverage: Double
    let longOiTokens: Double
    let shortOiTokens: Double
    let availLongSize: Double
    let availShortSize: Double
    let minCollUsd: Double
    let fundingRatePct: Double
    let tradingFeeBps: Double

    var id: String { symbol }
}

struct MarketsResponse: Decodable { let markets: [PerpMarket] }

/// `GET /api/markets/quote?symbol=…` → live spot + 24h change.
struct MarketQuote: Decodable {
    let spot: Double?
    let change24h: Double?
    let unavailable: Bool?
}

/// One OHLC candle from `GET /api/markets/candles`.
struct Candle: Decodable, Identifiable {
    let time: Double            // unix seconds
    let open: Double
    let high: Double
    let low: Double
    let close: Double
    var id: Double { time }
    var date: Date { Date(timeIntervalSince1970: time) }
}

struct CandlesResponse: Decodable { let candles: [Candle] }

/// One open position, from `GET /api/markets/account`.
struct PerpPosition: Decodable, Identifiable, Hashable {
    let ticker: String
    let positionId: String
    let isLong: Bool
    let sizeTokens: Double
    let collateralUsd: Double
    let entryPriceUsd: Double
    let markPriceUsd: Double
    let liqPriceUsd: Double
    let leverage: Double
    let pnlUsd: Double
    let hasTpSl: Bool

    var id: String { positionId }
    var pnlPct: Double {
        collateralUsd > 0 ? (pnlUsd / collateralUsd) * 100 : 0
    }
}

/// `GET /api/markets/account` — remembered account + snapshot.
struct PerpAccount: Decodable {
    let accountId: String?
    let address: String?
    let availableUsd: Double?
    let positions: [PerpPosition]?
}

/// One recorded trade, from `GET /api/markets/history`.
struct TradeLogEntry: Decodable, Identifiable {
    let ts: Double
    let type: String            // open | close | deposit | withdraw
    let ticker: String?
    let side: String?
    let sizeTokens: Double?
    let priceUsd: Double?
    let collateralUsd: Double?
    let pnlUsd: Double?
    let feeUsd: Double?
    let digest: String?

    var id: String { "\(ts)-\(type)-\(digest ?? "")" }
    var date: Date { Date(timeIntervalSince1970: ts / 1000) }
}

struct HistoryResponse: Decodable { let trades: [TradeLogEntry] }

/// A short, user-facing failure raised by the Trade flows themselves (as
/// opposed to a transport/decode `APIError`).
struct TradeError: LocalizedError {
    let msg: String
    var errorDescription: String? { msg }
}

/// The shape every write endpoint returns: either an already-executed local
/// digest, or (production) sponsor-ready `bytes` to sign with the zkLogin key.
struct SponsorPrepareResponse: Decodable {
    let mode: String?           // "sponsored" | "executed"
    let bytes: String?          // base64 sponsor-ready TransactionData
    let digest: String?         // present in local-executed mode
    let accountId: String?      // present on account create/link
    let feeUsd: Double?         // present on close
}

// MARK: - Trade venue palette

/// Trading green / red, tuned to read clearly on the app's dark surfaces while
/// staying in the muted Talise family.
enum TradeColor {
    static let long = TaliseColor.accent            // 0x79D96C
    static let short = Color(hex: 0xD9614F)
    static let longSoft = Color(hex: 0x79D96C).opacity(0.16)
    static let shortSoft = Color(hex: 0xD9614F).opacity(0.16)
}

// MARK: - Formatting helpers

enum TradeFormat {
    /// Price with category-aware precision: big numbers get commas, small ones
    /// get more decimals.
    static func price(_ v: Double) -> String {
        if v >= 1000 {
            let f = NumberFormatter()
            f.numberStyle = .decimal
            f.maximumFractionDigits = 2
            return f.string(from: NSNumber(value: v)) ?? String(format: "%.2f", v)
        }
        if v >= 1 { return String(format: "%.3f", v) }
        return String(format: "%.4f", v)
    }

    static func signedPct(_ v: Double) -> String {
        String(format: "%@%.2f%%", v >= 0 ? "+" : "", v)
    }

    static func signedUsd(_ v: Double) -> String {
        String(format: "%@$%.2f", v >= 0 ? "+" : "-", abs(v))
    }

    static func compact(_ v: Double) -> String {
        if v >= 1_000_000 { return String(format: "%.2fM", v / 1_000_000) }
        if v >= 1_000 { return String(format: "%.2fK", v / 1_000) }
        return String(format: "%.2f", v)
    }
}
