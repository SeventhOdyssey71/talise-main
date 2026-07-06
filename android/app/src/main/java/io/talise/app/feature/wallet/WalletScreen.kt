package io.talise.app.feature.wallet

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.outlined.AddCircleOutline
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.R
import io.talise.app.config.AppConfig
import io.talise.app.core.net.ApiClient
import io.talise.app.core.store.SecureStore
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.components.LiquidGlassPill
import io.talise.app.ui.components.MicroLabel
import io.talise.app.ui.components.SlideToConfirm
import io.talise.app.ui.components.taliseGlass
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay
import kotlinx.serialization.Serializable
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.GET
import kotlin.math.roundToLong

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
 *
 * iOS sources the total from `/api/balances` and FX from `/api/fx`. Android does the
 * same: balances via `ApiClient.api.balances()`, rates via a self-contained fetch.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalletScreen(onClose: () -> Unit) {
    // Fetched on appear so the hero + pocket rows render real money. Soft-fails to 0.
    var usdBalance by remember { mutableStateOf(0.0) }
    var loading by remember { mutableStateOf(true) }
    // USD -> code rates. Defaults to identity so pockets read correctly while stale.
    var rates by remember { mutableStateOf<Map<String, Double>>(mapOf("USD" to 1.0)) }

    // Codes the user has pinned as pockets. Android has no persisted display-currency
    // yet, so USD leads (the canonical settlement currency).
    val pocketCodes = remember { mutableStateListOf("USD") }
    var showAddSheet by remember { mutableStateOf(false) }
    var quoteTarget by remember { mutableStateOf<TaliseCurrency?>(null) }

    val displayCode = "USD"

    LaunchedEffect(Unit) {
        runCatching { ApiClient.api.balances() }.getOrNull()?.let { usdBalance = it.usdsui }
        runCatching { walletFxApi.fx() }.getOrNull()?.rates?.takeIf { it.isNotEmpty() }?.let { rates = it }
        loading = false
    }

    // Display currency forced to the front so the hero currency always leads.
    val pocketCurrencies: List<TaliseCurrency> = remember(pocketCodes.toList()) {
        val codes = pocketCodes.toMutableList().apply {
            remove(displayCode)
            add(0, displayCode)
        }
        codes.map { TaliseCurrency.find(it) }
    }

    fun localized(usd: Double, c: TaliseCurrency): String {
        val rate = rates[c.code] ?: 1.0
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

        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(top = 12.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            // Hero
            Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Eyebrow("Total balance")
                Text(
                    formatSymbolic(usdBalance * (rates[displayCode] ?: 1.0), TaliseCurrency.find(displayCode), 2),
                    style = TaliseType.display(42.sp, FontWeight.SemiBold),
                    letterSpacing = (-1.6).sp,
                    color = TaliseColors.fg,
                )
                Text(
                    "Across all your currencies",
                    style = TaliseType.body(13.sp, FontWeight.Light),
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
                    LiquidGlassPill(title = "Add a currency", onClick = { showAddSheet = true })
                }
                Column(Modifier.fillMaxWidth().taliseGlass(radius = 20.dp)) {
                    pocketCurrencies.forEachIndexed { idx, c ->
                        if (idx > 0) PocketDivider()
                        PocketRow(
                            currency = c,
                            amount = localized(usdBalance, c),
                            isDisplay = c.code == displayCode,
                            onClick = { quoteTarget = c },
                        )
                    }
                }
            }

            // Disclaimer
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(horizontal = 4.dp)) {
                Icon(Icons.Filled.Info, contentDescription = null, tint = TaliseColors.fgDim, modifier = Modifier.size(12.dp).padding(top = 1.dp))
                Text(
                    "Pockets show your one balance in each currency. Your wallet settles in USDsui (1:1 USD), rates update live.",
                    style = TaliseType.mono(10.sp, FontWeight.Light),
                    color = TaliseColors.fgDim,
                )
            }

            Spacer(Modifier.height(60.dp))
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
                existing = pocketCodes.toList(),
                onPick = { code ->
                    if (!pocketCodes.contains(code)) pocketCodes.add(code)
                    showAddSheet = false
                },
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
                usdBalance = usdBalance,
                target = target,
                fromCurrency = TaliseCurrency.find(displayCode),
                rates = rates,
                onDismiss = { quoteTarget = null },
            )
        }
    }
}

// MARK: - Pocket row

@Composable
private fun PocketRow(
    currency: TaliseCurrency,
    amount: String,
    isDisplay: Boolean,
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
            Text(currency.name, style = TaliseType.body(14.sp, FontWeight.Light), color = TaliseColors.fg, maxLines = 1)
            Text(currency.code, style = TaliseType.mono(10.sp, FontWeight.Light), color = TaliseColors.fgDim)
        }
        Spacer(Modifier.weight(1f))
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(amount, style = TaliseType.heading(15.sp, FontWeight.Medium), color = TaliseColors.fg, maxLines = 1)
            if (isDisplay) MicroLabel("DISPLAY", color = TaliseColors.accent)
        }
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = TaliseColors.fgDim,
            modifier = Modifier.size(16.dp),
        )
    }
}

@Composable
private fun PocketDivider() {
    Box(Modifier.fillMaxWidth().padding(start = 18.dp).height(1.dp).background(TaliseColors.line))
}

/** Circular flag icon, iOS `RoundedFlag`, vendored circle-flags in res/drawable. */
@Composable
private fun RoundedFlag(code: String, size: Dp) {
    Image(
        painter = painterResource(id = flagDrawable(code)),
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = Modifier.size(size).clip(CircleShape),
    )
}

// MARK: - Add a currency sheet

@Composable
private fun AddCurrencySheet(existing: List<String>, onPick: (String) -> Unit) {
    val available = TaliseCurrency.allSupported.filter { !existing.contains(it.code) }
    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Eyebrow("Add a currency")
        Column(Modifier.fillMaxWidth().taliseGlass(radius = 20.dp)) {
            if (available.isEmpty()) {
                Column(
                    Modifier.fillMaxWidth().padding(vertical = 28.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = TaliseColors.accent, modifier = Modifier.size(22.dp))
                    Text("You've added every currency.", style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted)
                }
            } else {
                available.forEachIndexed { idx, c ->
                    if (idx > 0) PocketDivider()
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable { onPick(c.code) }
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
                        Icon(Icons.Outlined.AddCircleOutline, contentDescription = null, tint = TaliseColors.accent, modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
    }
}

// MARK: - FX quote sheet

@Composable
private fun FXQuoteSheet(
    usdBalance: Double,
    target: TaliseCurrency,
    fromCurrency: TaliseCurrency,
    rates: Map<String, Double>,
    onDismiss: () -> Unit,
) {
    val spreadBps = 25.0
    val quoteTTL = 30

    val fromRate = rates[fromCurrency.code] ?: 1.0
    val toRate = rates[target.code] ?: 1.0
    val cross = if (fromRate > 0) toRate / fromRate else 1.0

    // Amount to convert FROM, in the display currency; defaults to the full balance.
    val amountIn = usdBalance * fromRate
    val grossOut = if (fromRate > 0) amountIn * cross else 0.0
    val amountOut = grossOut * (1 - spreadBps / 10_000)
    val feeInTarget = grossOut * (spreadBps / 10_000)

    val rateLine = if (fromRate > 0) {
        val one = formatSymbolic(1.0, fromCurrency, if (fromCurrency.code == "USD") 0 else 2)
        val other = formatSymbolic(cross, target, if (cross >= 100) 2 else 4)
        "$one = $other"
    } else "-"

    var secondsLeft by remember { mutableIntStateOf(quoteTTL) }
    var acknowledged by remember { mutableStateOf(false) }

    // 1Hz countdown; resets at zero so the user never confirms a stale rate.
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
            .padding(top = 8.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        // Header
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Eyebrow("Convert to ${target.code}")
            Text(
                "${fromCurrency.name} -> ${target.name}",
                style = TaliseType.heading(20.sp, FontWeight.Medium),
                color = TaliseColors.fg,
            )
        }

        // Quote card
        Column(Modifier.fillMaxWidth().taliseGlass(radius = 20.dp)) {
            AmountRow("You convert", formatSymbolic(amountIn, fromCurrency, 2), emphasis = false)
            PocketDivider()
            AmountRow("You get", formatSymbolic(amountOut, target, 2), emphasis = true)
            PocketDivider()
            DetailRow("Locked rate", rateLine)
            PocketDivider()
            DetailRow("Talise fee", "${formatSymbolic(feeInTarget, target, 2)} · ${"%.2f".format(spreadBps / 100)}%")
            PocketDivider()
            // Countdown
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 13.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("Rate refreshes in", style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    val warn = secondsLeft <= 5
                    Box(Modifier.size(6.dp).clip(CircleShape).background(if (warn) TaliseColors.warmGold else TaliseColors.accent))
                    Text("${secondsLeft}s", style = TaliseType.mono(12.sp), color = if (warn) TaliseColors.warmGold else TaliseColors.fg)
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

/** Symbol-prefixed, grouped amount, iOS `TaliseFormat.symbolic`. */
private fun formatSymbolic(amount: Double, currency: TaliseCurrency, fixed: Int): String {
    val grouped = when (fixed) {
        0 -> "%,d".format(amount.roundToLong())
        else -> "%,.${fixed}f".format(amount)
    }
    return "${currency.symbol}$grouped"
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

// MARK: - FX rates fetch (self-contained; iOS `/api/fx`)

@Serializable
private data class WalletFxResponse(val rates: Map<String, Double> = emptyMap())

private interface WalletFxApi {
    @GET("api/fx")
    suspend fun fx(): WalletFxResponse
}

private val walletFxApi: WalletFxApi by lazy {
    val client = OkHttpClient.Builder()
        .addInterceptor { chain ->
            val builder = chain.request().newBuilder()
            SecureStore.bearer?.let { builder.header("Authorization", "Bearer $it") }
            chain.proceed(builder.build())
        }
        .build()
    Retrofit.Builder()
        .baseUrl(AppConfig.apiBaseUrl)
        .client(client)
        .addConverterFactory(ApiClient.json.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(WalletFxApi::class.java)
}
