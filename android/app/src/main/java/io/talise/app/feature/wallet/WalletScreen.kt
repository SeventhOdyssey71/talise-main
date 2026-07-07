package io.talise.app.feature.wallet

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.AddCircleOutline
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.R
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.components.MicroLabel
import io.talise.app.ui.components.SlideToConfirm
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay
import java.util.Locale

/**
 * Currency pockets, a faithful port of iOS `CurrencyPocketsView`.
 *
 * Presentation only: Talise settles in USDsui (1:1 USD) on chain; "pockets" are a
 * UX surface over the single underlying balance, not separate on-chain ledgers.
 *
 * Layout, top -> bottom:
 *   1. Hero, total balance in the display currency.
 *   2. Pockets list, the same balance shown in each added currency, each row a
 *      flat card with a circular flag + localized amount.
 *   3. "Add a currency", opens a sheet that appends a currency as a pocket.
 *   4. Tapping a pocket opens the FX quote sheet (amount in / out / locked rate /
 *      spread-as-fee / countdown + SlideToConfirm).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalletScreen(onClose: () -> Unit) {
    val vm: WalletViewModel = viewModel()
    val state by vm.state.collectAsStateWithLifecycle()

    var showAddSheet by remember { mutableStateOf(false) }
    // The pocket the user tapped to preview a conversion. Drives the FX quote sheet.
    var quoteTarget by remember { mutableStateOf<TaliseCurrency?>(null) }

    val displayCurrency = TaliseCurrency.find(state.displayCode)

    // Display currency forced to the front so the hero currency always leads the list.
    val pocketCurrencies: List<TaliseCurrency> = remember(state.pocketCodes, state.displayCode) {
        val codes = state.pocketCodes.toMutableList().apply {
            remove(state.displayCode)
            add(0, state.displayCode)
        }
        codes.map { TaliseCurrency.find(it) }
    }

    // USD -> currency `c`, formatted with its symbol. Falls back to the USD figure
    // when the rate hasn't loaded (rate defaults to 1).
    fun localized(usd: Double, c: TaliseCurrency): String {
        val rate = state.rates[c.code] ?: 1.0
        return formatSymbolic(usd * rate, c, 2)
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(TaliseColors.bg),
    ) {
        // Inline nav bar, iOS `navigationTitle("Currencies")` + back button.
        Box(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 8.dp)) {
            IconButton(onClick = onClose, modifier = Modifier.align(Alignment.CenterStart)) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = TaliseColors.fg)
            }
            Text(
                "Currencies",
                style = TaliseType.heading(17.sp, FontWeight.SemiBold),
                color = TaliseColors.fg,
                modifier = Modifier.align(Alignment.Center),
            )
        }

        PullToRefreshBox(
            isRefreshing = state.refreshing,
            onRefresh = vm::refresh,
            modifier = Modifier.fillMaxSize(),
        ) {
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp)
                    .padding(top = 12.dp),
                verticalArrangement = Arrangement.spacedBy(22.dp),
            ) {
                // Hero, iOS `HeroNumber(value:eyebrow:sub:)`, centered, 66pt compact.
                Column(
                    Modifier.fillMaxWidth().padding(top = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Eyebrow("Total balance")
                    Text(
                        localized(state.usdBalance, displayCurrency),
                        style = TaliseType.display(66.sp, FontWeight.SemiBold),
                        letterSpacing = (-1.98).sp,
                        color = TaliseColors.fg,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.redactedPlaceholder(state.loading),
                    )
                    Text(
                        "Across all your currencies",
                        style = TaliseType.body(13.sp),
                        color = TaliseColors.fgMuted,
                    )
                }

                // Pockets
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Eyebrow("Your pockets")
                        CompactGlassPill(title = "Add a currency", onClick = { showAddSheet = true })
                    }
                    PocketCard {
                        pocketCurrencies.forEachIndexed { idx, c ->
                            if (idx > 0) PocketDivider()
                            PocketRow(
                                currency = c,
                                amount = localized(state.usdBalance, c),
                                isDisplay = c.code == state.displayCode,
                                loading = state.loading,
                                onClick = { quoteTarget = c },
                            )
                        }
                    }
                }

                // Disclaimer
                Row(
                    Modifier.padding(horizontal = 4.dp),
                    verticalAlignment = Alignment.Top,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(
                        Icons.Outlined.Info,
                        contentDescription = null,
                        tint = TaliseColors.fgDim,
                        modifier = Modifier.size(12.dp),
                    )
                    Text(
                        "Pockets show your one balance in each currency. Your wallet settles in USDsui (1:1 USD), rates update live.",
                        style = TaliseType.mono(10.sp, FontWeight.Light),
                        color = TaliseColors.fgDim,
                    )
                }

                Spacer(Modifier.height(60.dp))
            }
        }
    }

    if (showAddSheet) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(
            onDismissRequest = { showAddSheet = false },
            sheetState = sheetState,
            containerColor = TaliseColors.bg,
        ) {
            AddCurrencySheet(
                existing = state.pocketCodes,
                onPick = { code -> vm.addPocket(code) },
                onDone = { showAddSheet = false },
            )
        }
    }

    quoteTarget?.let { target ->
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(
            onDismissRequest = { quoteTarget = null },
            sheetState = sheetState,
            containerColor = TaliseColors.bg,
        ) {
            FXQuoteSheet(
                usdBalance = state.usdBalance,
                target = target,
                fromCurrency = displayCurrency,
                rates = state.rates,
                onDismiss = { quoteTarget = null },
            )
        }
    }
}

// MARK: - Pocket card + row

/** Flat radius-20 surface card, iOS pockets card (fill only, no hairline). */
@Composable
private fun PocketCard(content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(20.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(TaliseColors.surface),
    ) { content() }
}

@Composable
private fun PocketRow(
    currency: TaliseCurrency,
    amount: String,
    isDisplay: Boolean,
    loading: Boolean,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(horizontal = 18.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        RoundedFlag(currency.flagCode, size = 38.dp)
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                currency.name,
                style = TaliseType.body(14.sp, FontWeight.Light),
                color = TaliseColors.fg,
                maxLines = 1,
            )
            Text(currency.code, style = TaliseType.mono(10.sp, FontWeight.Light), color = TaliseColors.fgDim)
        }
        Spacer(Modifier.weight(1f))
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                amount,
                style = TaliseType.heading(15.sp, FontWeight.Medium),
                color = TaliseColors.fg,
                maxLines = 1,
                modifier = Modifier.redactedPlaceholder(loading),
            )
            if (isDisplay) MicroLabel("DISPLAY", color = TaliseColors.accent)
        }
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = TaliseColors.fgDim,
            modifier = Modifier.size(14.dp),
        )
    }
}

/** Hairline divider inset 18 on both sides, iOS `LiquidGlassDivider(inset: 18)`. */
@Composable
private fun PocketDivider() {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp)
            .height(1.dp)
            .background(TaliseColors.line),
    )
}

/** Circular flag icon, iOS `RoundedFlag`, vendored circle-flags in res/drawable. */
@Composable
private fun RoundedFlag(code: String, size: Dp) {
    Image(
        painter = painterResource(id = flagDrawable(code)),
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = Modifier
            .size(size)
            .clip(CircleShape)
            .border(1.dp, TaliseColors.line, CircleShape),
    )
}

/** Compact capsule with a leading plus, iOS `LiquidGlassPill(compact: true)` (height 24). */
@Composable
private fun CompactGlassPill(title: String, onClick: () -> Unit) {
    Row(
        Modifier
            .clip(CircleShape)
            .background(TaliseColors.surface2)
            .border(1.dp, TaliseColors.line, CircleShape)
            .clickable { onClick() }
            .height(24.dp)
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(Icons.Filled.Add, contentDescription = null, tint = TaliseColors.fg, modifier = Modifier.size(10.dp))
        Text(
            title,
            style = TaliseType.body(11.sp, FontWeight.Medium),
            letterSpacing = (-0.1).sp,
            color = TaliseColors.fg,
        )
    }
}

/**
 * iOS `.redacted(reason: .placeholder)` stand-in: while active, draws a soft
 * rounded block instead of the text so loading money never flashes "$0.00".
 */
private fun Modifier.redactedPlaceholder(active: Boolean): Modifier =
    if (!active) this
    else drawWithContent {
        drawRoundRect(
            color = TaliseColors.surface2,
            cornerRadius = CornerRadius(6.dp.toPx()),
        )
    }

// MARK: - Add a currency sheet

/**
 * Extends the display-currency picker into a pocket picker. Lists every supported
 * currency that isn't already pinned; tapping one appends it as a pocket and dismisses.
 */
@Composable
private fun AddCurrencySheet(
    existing: List<String>,
    onPick: (String) -> Unit,
    onDone: () -> Unit,
) {
    val available = TaliseCurrency.allSupported.filter { !existing.contains(it.code) }
    Column(Modifier.fillMaxWidth().padding(bottom = 32.dp)) {
        // Inline nav bar, iOS `navigationTitle("Add a currency")` + Done.
        Box(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp)) {
            Text(
                "Add a currency",
                style = TaliseType.heading(17.sp, FontWeight.SemiBold),
                color = TaliseColors.fg,
                modifier = Modifier.align(Alignment.Center),
            )
            Text(
                "Done",
                style = TaliseType.body(16.sp, FontWeight.Medium),
                color = TaliseColors.accent,
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .clickable { onDone() },
            )
        }
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(top = 12.dp),
        ) {
            PocketCard {
                if (available.isEmpty()) {
                    Column(
                        Modifier.fillMaxWidth().padding(vertical = 28.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            Icons.Outlined.CheckCircle,
                            contentDescription = null,
                            tint = TaliseColors.accent,
                            modifier = Modifier.size(22.dp),
                        )
                        Text(
                            "You've added every currency.",
                            style = TaliseType.body(13.sp, FontWeight.Light),
                            color = TaliseColors.fgMuted,
                        )
                    }
                } else {
                    available.forEachIndexed { idx, c ->
                        if (idx > 0) PocketDivider()
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable {
                                    onPick(c.code)
                                    onDone()
                                }
                                .padding(horizontal = 18.dp, vertical = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(14.dp),
                        ) {
                            RoundedFlag(c.flagCode, size = 32.dp)
                            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text(c.name, style = TaliseType.body(14.sp, FontWeight.Light), color = TaliseColors.fg)
                                Text(c.code, style = TaliseType.mono(10.sp, FontWeight.Light), color = TaliseColors.fgDim)
                            }
                            Spacer(Modifier.weight(1f))
                            Icon(
                                Icons.Outlined.AddCircleOutline,
                                contentDescription = null,
                                tint = TaliseColors.accent,
                                modifier = Modifier.size(16.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

// MARK: - FX quote sheet

/**
 * In-app FX quote block: amount in, amount out, a locked rate, the ~25bps spread
 * shown as an explicit fee, and a countdown after which the quote re-locks. This
 * is a preview — converting between pockets is a no-op today (one underlying
 * USDsui balance), so the SlideToConfirm simply acknowledges the quote and dismisses.
 */
@Composable
private fun FXQuoteSheet(
    usdBalance: Double,
    target: TaliseCurrency,
    fromCurrency: TaliseCurrency,
    rates: Map<String, Double>,
    onDismiss: () -> Unit,
) {
    // Spread Talise applies, in basis points (~25bps). Surfaced as a fee so the rate stays honest.
    val spreadBps = 25.0
    // Quote lifetime before it re-locks, in seconds.
    val quoteTTL = 30

    val fromRate = rates[fromCurrency.code] ?: 1.0
    val toRate = rates[target.code] ?: 1.0
    val cross = if (fromRate > 0) toRate / fromRate else 1.0

    // Amount to convert FROM, in the display currency; defaults to the full balance.
    val amountIn = usdBalance * fromRate
    val grossOut = if (fromRate > 0) amountIn * cross else 0.0
    val amountOut = grossOut * (1 - spreadBps / 10_000)
    val feeInTarget = grossOut * (spreadBps / 10_000)

    // "1 USD = N1,540.00" style line built from the locked cross rate.
    val rateLine = if (fromRate > 0) {
        val one = formatSymbolic(1.0, fromCurrency, if (fromCurrency.code == "USD") 0 else 2)
        val other = formatSymbolic(cross, target, if (cross >= 100) 2 else 4)
        "$one = $other"
    } else "-"

    var secondsLeft by remember { mutableIntStateOf(quoteTTL) }
    var acknowledged by remember { mutableStateOf(false) }

    // Simple 1Hz countdown; re-locks (resets) at zero so the user never
    // confirms against a stale rate. Stops once acknowledged.
    LaunchedEffect(Unit) {
        while (!acknowledged) {
            delay(1_000)
            if (acknowledged) break
            secondsLeft = if (secondsLeft > 0) secondsLeft - 1 else quoteTTL
        }
    }

    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp)
            .padding(top = 20.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        // Header
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Eyebrow("Convert to ${target.code}")
            Text(
                "${fromCurrency.name} → ${target.name}",
                style = TaliseType.heading(20.sp, FontWeight.Medium),
                color = TaliseColors.fg,
            )
        }

        // Quote card: amount in / amount out / locked rate / fee / TTL.
        PocketCard {
            AmountRow("You convert", formatSymbolic(amountIn, fromCurrency, 2), emphasis = false)
            PocketDivider()
            AmountRow("You get", formatSymbolic(amountOut, target, 2), emphasis = true)
            PocketDivider()
            DetailRow("Locked rate", rateLine)
            PocketDivider()
            DetailRow(
                "Talise fee",
                "${formatSymbolic(feeInTarget, target, 2)} · ${String.format(Locale.US, "%.2f", spreadBps / 100)}%",
            )
            PocketDivider()
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 13.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("Rate refreshes in", style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    val warn = secondsLeft <= 5
                    Box(
                        Modifier
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(if (warn) TaliseColors.warmGold else TaliseColors.accent),
                    )
                    Text(
                        "${secondsLeft}s",
                        style = TaliseType.mono(12.sp),
                        color = if (warn) TaliseColors.warmGold else TaliseColors.fg,
                    )
                }
            }
        }

        // Slide / acknowledged state
        if (acknowledged) {
            Row(
                Modifier.fillMaxWidth().height(58.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
            ) {
                Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = TaliseColors.accent, modifier = Modifier.size(20.dp))
                Spacer(Modifier.size(8.dp))
                Text("Quote saved", style = TaliseType.heading(15.sp, FontWeight.Medium), color = TaliseColors.fg)
            }
        } else {
            SlideToConfirm(
                title = "Slide to lock this quote",
                onConfirm = {
                    acknowledged = true
                    delay(600)
                    onDismiss()
                },
            )
        }

        Spacer(Modifier.height(20.dp))
    }
}

@Composable
private fun AmountRow(label: String, value: String, emphasis: Boolean) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted)
        Text(
            value,
            style = TaliseType.heading(if (emphasis) 22.sp else 17.sp, FontWeight.Medium),
            color = if (emphasis) TaliseColors.accent else TaliseColors.fg,
            maxLines = 1,
        )
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted)
        Text(value, style = TaliseType.mono(12.sp, FontWeight.Light), color = TaliseColors.fg, maxLines = 1)
    }
}

// MARK: - Currency model (Android match for iOS `TaliseCurrency`)

data class TaliseCurrency(val code: String, val symbol: String, val name: String) {
    /** ISO alpha-2 (or "eu") for the circular flag icon. Currency code -> country. */
    val flagCode: String
        get() = when (code) {
            "USD" -> "us"
            "NGN" -> "ng"
            "GHS" -> "gh"
            "KES" -> "ke"
            "EUR" -> "eu"
            "GBP" -> "gb"
            "CAD" -> "ca"
            "ZAR" -> "za"
            "JPY" -> "jp"
            "SGD" -> "sg"
            "PHP" -> "ph"
            "IDR" -> "id"
            "VND" -> "vn"
            else -> "us"
        }

    companion object {
        val allSupported: List<TaliseCurrency> = listOf(
            TaliseCurrency("USD", "$", "US Dollar"),
            TaliseCurrency("NGN", "₦", "Nigerian Naira"),
            TaliseCurrency("GHS", "₵", "Ghanaian Cedi"),
            TaliseCurrency("KES", "KSh", "Kenyan Shilling"),
            TaliseCurrency("EUR", "€", "Euro"),
            TaliseCurrency("GBP", "£", "British Pound"),
            TaliseCurrency("CAD", "CA$", "Canadian Dollar"),
            TaliseCurrency("ZAR", "R", "South African Rand"),
            TaliseCurrency("JPY", "¥", "Japanese Yen"),
            TaliseCurrency("SGD", "S$", "Singapore Dollar"),
            TaliseCurrency("PHP", "₱", "Philippine Peso"),
            TaliseCurrency("IDR", "Rp", "Indonesian Rupiah"),
            TaliseCurrency("VND", "₫", "Vietnamese Dong"),
        )

        val usd = allSupported[0]

        fun find(code: String): TaliseCurrency = allSupported.firstOrNull { it.code == code } ?: usd
    }
}

/**
 * Symbol-prefixed, grouped amount, iOS `TaliseFormat.symbolic` (en_US pinned).
 * Smart decimals when `fixed` is null: under 1 -> 4 decimals, else 2.
 */
internal fun formatSymbolic(amount: Double, currency: TaliseCurrency, fixed: Int? = null): String {
    val decimals = fixed ?: if (amount < 1) 4 else 2
    val body = String.format(Locale.US, "%,.${decimals}f", amount)
    return "${currency.symbol}$body"
}

// MARK: - Flag drawables

private fun flagDrawable(code: String): Int = when (code) {
    "us" -> R.drawable.flag_us
    "ng" -> R.drawable.flag_ng
    "gb" -> R.drawable.flag_gb
    "eu" -> R.drawable.flag_eu
    "ca" -> R.drawable.flag_ca
    "jp" -> R.drawable.flag_jp
    "in" -> R.drawable.flag_in
    "ph" -> R.drawable.flag_ph
    "ke" -> R.drawable.flag_ke
    "gh" -> R.drawable.flag_gh
    "za" -> R.drawable.flag_za
    "ae" -> R.drawable.flag_ae
    "sa" -> R.drawable.flag_sa
    "sg" -> R.drawable.flag_sg
    "de" -> R.drawable.flag_de
    "fr" -> R.drawable.flag_fr
    "bd" -> R.drawable.flag_bd
    "pk" -> R.drawable.flag_pk
    "id" -> R.drawable.flag_id
    "vn" -> R.drawable.flag_vn
    "ma" -> R.drawable.flag_ma
    "dz" -> R.drawable.flag_dz
    "eg" -> R.drawable.flag_eg
    else -> R.drawable.flag_us
}
