package io.talise.app.feature.home

import androidx.compose.ui.graphics.Color
import io.talise.app.core.model.ActivityEntryDTO
import io.talise.app.core.model.ActivityOtherCoin
import io.talise.app.core.model.OfframpInfo
import java.text.DateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs
import kotlin.math.pow

/**
 * Category + formatting helpers shared by HistoryRow, HistoryView, and
 * TxReceiptView, ported 1:1 from the iOS HistoryRow / TxReceiptView /
 * TaliseFormat logic so titles, colors, and amounts read identically.
 */

// Directional palette — the same hex literals iOS hardcodes in HistoryRow /
// TxReceiptView (they are view-local there too, not design tokens).
internal val HomeSentRed = Color(0xFFE5484D)
internal val HomeSentRedSoft = Color(0xFFFF6B6B)
internal val HomeReceivedGreen = Color(0xFF79D96C)
internal val HomeReceivedMint = Color(0xFFCAFFB8)
internal val HomeWithdrawForest = Color(0xFF2E5E1F)
internal val HomeAmountGreen = Color(0xFF4FB35E)
internal val HomePendingGold = Color(0xFFD9A441)
internal val HomeReceiptSentFg = Color(0xFFE08D8A)

internal enum class TxCategory { SENT, RECEIVED, INVEST, WITHDRAW, AUTOSWAP, CASHOUT, TEAM, NEUTRAL }

/**
 * Server-side `direction` carries the classification; fiat off-ramps and
 * team payouts get their own categories so they never read as anonymous
 * on-chain transfers. Mirrors iOS `HistoryRow.category`.
 */
internal fun categoryOf(e: ActivityEntryDTO): TxCategory = when {
    e.offramp != null -> TxCategory.CASHOUT
    e.direction == "withdraw" && e.venue == "bridge" -> TxCategory.CASHOUT
    e.team != null -> TxCategory.TEAM
    e.direction == "received" -> TxCategory.RECEIVED
    e.direction == "invest" -> TxCategory.INVEST
    e.direction == "withdraw" -> TxCategory.WITHDRAW
    e.direction == "autoswap" || e.direction == "swap" -> TxCategory.AUTOSWAP
    e.direction == "sent" -> TxCategory.SENT
    else -> TxCategory.NEUTRAL
}

/**
 * Venue code to user-facing label — venue codes stay internal identifiers,
 * users see generic earning terminology. Mirrors iOS `displayVenueName`.
 */
internal fun displayVenueName(code: String): String {
    val normalized = code.lowercase()
    return when (normalized) {
        "navi" -> "Earn"
        "deepbook" -> "Trading"
        else -> normalized.replaceFirstChar { it.uppercase() }
    }
}

/** Resolved @handle/name, else a shortened 0x address, else null. */
internal fun counterpartyLabel(e: ActivityEntryDTO): String? {
    e.counterpartyName?.let { if (it.isNotEmpty()) return it }
    val addr = e.counterparty
    if (!addr.isNullOrEmpty()) {
        return if (addr.length > 14) addr.take(6) + "…" + addr.takeLast(4) else addr
    }
    return null
}

// ── Amount formatting (iOS TaliseFormat) ────────────────────────────────────

/** Fixed 2-decimal USD — "$1,234.50". Pinned to a literal `$` like iOS. */
internal fun usd2(v: Double): String = "$" + String.format(Locale.US, "%,.2f", v)

/** Smart decimals: under $1 renders 4 decimals so tiny yields don't collapse to $0.00. */
internal fun usdSmart(v: Double): String =
    if (v < 1.0) "$" + String.format(Locale.US, "%,.4f", v)
    else "$" + String.format(Locale.US, "%,.2f", v)

/** Raw NGN figure with the naira symbol and grouped thousands — "₦142,350.00". */
internal fun ngn(v: Double): String = "₦" + String.format(Locale.US, "%,.2f", v)

/**
 * Raw u64 coin amount scaled by decimals with trailing zeros trimmed —
 * iOS `ActivityOtherCoin.displayAmount`.
 */
internal fun coinDisplayAmount(c: ActivityOtherCoin): String {
    val raw = c.amount.toDoubleOrNull() ?: return c.amount
    val scaled = raw / 10.0.pow(c.decimals.toDouble())
    if (scaled % 1.0 == 0.0) return scaled.toLong().toString()
    var s = String.format(Locale.US, "%.4f", scaled)
    while (s.endsWith("0")) s = s.dropLast(1)
    if (s.endsWith(".")) s = s.dropLast(1)
    return s
}

/** Abbreviated relative timestamp, the iOS RelativeDateTimeFormatter look. */
internal fun relativeTime(ms: Double): String {
    val diff = System.currentTimeMillis() - ms.toLong()
    val mins = diff / 60_000
    return when {
        mins < 1 -> "now"
        mins < 60 -> "${mins}m ago"
        mins < 1440 -> "${mins / 60}h ago"
        else -> "${mins / 1440}d ago"
    }
}

/** Medium date + short time — iOS DateFormatter(.medium, .short). */
internal fun receiptDate(ms: Double): String =
    DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(ms.toLong()))

internal fun shortAddress(a: String): String =
    if (a.length > 14) a.take(8) + "…" + a.takeLast(6) else a

internal fun shortDigest(d: String): String =
    if (d.length > 14) d.take(10) + "…" + d.takeLast(6) else d

// ── Row copy (iOS HistoryRow title/subtitle/amount) ─────────────────────────

internal fun rowTitle(e: ActivityEntryDTO, category: TxCategory): String {
    // Fiat cash-out takes priority over every other classification, including
    // the otherCoin (USDC) label below.
    if (category == TxCategory.CASHOUT) {
        if (e.offramp != null) return "Cash out to Nigeria"
        if (e.venue == "bridge") return "Cash out to United States"
        return "Cash out"
    }
    // Non-USDsui/non-SUI rows (WAL, USDC, USDT, ...) override the default
    // "Sent"/"Received" so the row clearly shows the coin.
    e.otherCoin?.let { other ->
        return if (e.direction == "received") "Received ${other.symbol}" else "Sent ${other.symbol}"
    }
    val hasRoundup = (e.roundupUsdsui ?: 0.0) > 0.0
    return when (category) {
        TxCategory.SENT -> {
            val who = counterpartyLabel(e)
            when {
                who != null && hasRoundup -> "Sent to $who + saved"
                who != null -> "Sent to $who"
                hasRoundup -> "Sent + saved"
                else -> "Sent"
            }
        }
        TxCategory.TEAM -> e.team?.name?.takeIf { it.isNotEmpty() }?.let { "Paid $it" } ?: "Paid your team"
        TxCategory.RECEIVED -> counterpartyLabel(e)?.let { "Received from $it" } ?: "Received"
        TxCategory.INVEST -> e.venue?.takeIf { it.isNotEmpty() }?.let { "Invested in ${displayVenueName(it)}" } ?: "Invested"
        TxCategory.WITHDRAW -> e.venue?.takeIf { it.isNotEmpty() }?.let { "Withdrew from ${displayVenueName(it)}" } ?: "Withdrew"
        TxCategory.AUTOSWAP -> when {
            e.direction == "swap" -> "Swapped"
            !e.venue.isNullOrEmpty() -> "Auto-swapped ${e.venue!!.uppercase()}"
            else -> "Auto-swapped to USDsui"
        }
        TxCategory.CASHOUT -> "Cash out"
        TxCategory.NEUTRAL -> "Activity"
    }
}

internal fun rowSubtitle(e: ActivityEntryDTO): String {
    // Cash-out rows show the destination bank + masked account instead of a
    // relative timestamp.
    e.offramp?.let { off ->
        val bank = off.bankName?.takeIf { it.isNotEmpty() } ?: "Bank"
        val last4 = off.accountLast4
        return if (!last4.isNullOrEmpty()) "$bank ••••$last4" else bank
    }
    val relative = relativeTime(e.timestampMs)
    e.team?.let { team ->
        val people = if (team.recipientCount == 1) "1 person" else "${team.recipientCount} people"
        return "$people • $relative"
    }
    val save = e.roundupUsdsui ?: 0.0
    if (save > 0) return "Saved ${usd2(save)} • $relative"
    return relative
}

internal fun rowAmountColor(e: ActivityEntryDTO, category: TxCategory, fg: Color): Color = when {
    category == TxCategory.CASHOUT -> HomeSentRed
    category == TxCategory.AUTOSWAP -> fg
    e.direction == "received" || e.direction == "withdraw" -> HomeAmountGreen
    else -> fg
}

internal fun rowAmount(e: ActivityEntryDTO, category: TxCategory): String {
    // Cash-out shows the NGN payout the user actually received, not the
    // USDsui debit.
    e.offramp?.let { off -> return "−" + ngn(off.amountNgn) }
    // Bridge USD cash-out: USDC leaving the wallet for a US bank, a debit.
    if (category == TxCategory.CASHOUT) {
        e.otherCoin?.let { other -> return "−${coinDisplayAmount(other)} ${other.symbol}" }
    }
    // Auto-swap and manual swap are net-neutral, render both legs of the
    // conversion ("0.1 SUI → $139.59").
    if (category == TxCategory.AUTOSWAP) {
        val legs = mutableListOf<String>()
        (e.amountSui ?: 0.0).let { if (it > 0) legs.add(String.format(Locale.US, "%.4f SUI", it)) }
        e.otherCoin?.let { legs.add("${coinDisplayAmount(it)} ${it.symbol}") }
        (e.amountUsdsui ?: 0.0).let { if (it > 0) legs.add(usd2(it)) }
        return when (legs.size) {
            0 -> "→ -"
            1 -> "→ ${legs[0]}"
            else -> "${legs[0]} → ${legs[1]}"
        }
    }
    // Invest = wallet to pool (debit, "-"); Withdraw = pool to wallet
    // (credit, "+"). Plain transfers use direction directly.
    val inflow = e.direction == "received" || e.direction == "withdraw"
    val prefix = if (inflow) "+" else "-"
    e.otherCoin?.let { return "$prefix${coinDisplayAmount(it)} ${it.symbol}" }
    e.amountUsdsui?.let { return prefix + usd2(abs(it)) }
    e.amountSui?.let { return prefix + String.format(Locale.US, "%.4f SUI", abs(it)) }
    return "$prefix-"
}

// ── Cash-out status (iOS offrampStatusPill / cashOutStatusLabel) ────────────

/**
 * Friendly Linq status label. Statuses are free text ("Settled in treasury",
 * "processing: in bank queue", ...) so we substring-match.
 */
internal fun cashOutStatusLabel(status: String): String {
    val s = status.lowercase()
    if (s.contains("disburse") || s.contains("settled") || s.contains("complete") ||
        s.contains("success") || s.contains("paid")
    ) return "Paid out"
    if (s.contains("timeout") || s.contains("fail") || s.contains("error") ||
        s.contains("cancel") || s.contains("reject") || s.contains("declin")
    ) return "Failed"
    return "Pending"
}

/**
 * Small disbursement-status pill for cash-out rows. Null when the payout is
 * already settled — only Pending / Failed surface.
 */
internal fun offrampStatusPill(off: OfframpInfo): Pair<String, Color>? =
    when (cashOutStatusLabel(off.status)) {
        "Paid out" -> null
        "Failed" -> "Failed" to HomeSentRed
        else -> "Pending" to HomePendingGold
    }

/** Destination-country flag for a cash-out row. Linq = Nigeria; Bridge = US. */
internal fun cashoutFlagCode(e: ActivityEntryDTO): String? {
    if (e.offramp != null) return "ng"
    if (e.direction == "withdraw" && e.venue == "bridge") return "us"
    return null
}
