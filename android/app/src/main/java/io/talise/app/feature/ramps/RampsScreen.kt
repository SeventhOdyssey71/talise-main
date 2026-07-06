package io.talise.app.feature.ramps

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.R
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Ramps hub — the Android port of iOS Ramps (BridgeOnrampView / BridgeCashOutView /
 * CorridorPickerView). A hub (add money / cash out) → a corridor picker (country +
 * currency, circular flag; available rows tappable, "soon" rows dimmed) → an amount
 * form. Corridor catalogue mirrors RampCorridor.all.
 */

private enum class Direction { OnRamp, OffRamp }

private data class Corridor(
    val code: String,
    val name: String,
    val currency: String,
    val flag: Int,
    val available: Boolean,
    val onramp: Boolean,
    val offramp: Boolean,
)

// Mirrors iOS RampCorridor.all (only corridors whose flag we bundle).
private val CORRIDORS = listOf(
    Corridor("US", "United States", "USD", R.drawable.flag_us, true, true, true),
    Corridor("EU", "Eurozone", "EUR", R.drawable.flag_eu, true, true, true),
    Corridor("GB", "United Kingdom", "GBP", R.drawable.flag_gb, true, true, true),
    Corridor("NG", "Nigeria", "NGN", R.drawable.flag_ng, true, false, true),
    Corridor("KE", "Kenya", "KES", R.drawable.flag_ke, false, false, true),
    Corridor("GH", "Ghana", "GHS", R.drawable.flag_gh, false, false, true),
    Corridor("ZA", "South Africa", "ZAR", R.drawable.flag_za, false, false, true),
    Corridor("CA", "Canada", "CAD", R.drawable.flag_ca, false, true, true),
    Corridor("IN", "India", "INR", R.drawable.flag_in, false, false, true),
    Corridor("PH", "Philippines", "PHP", R.drawable.flag_ph, false, false, true),
    Corridor("AE", "United Arab Emirates", "AED", R.drawable.flag_ae, false, true, true),
    Corridor("SA", "Saudi Arabia", "SAR", R.drawable.flag_sa, false, false, true),
    Corridor("SG", "Singapore", "SGD", R.drawable.flag_sg, false, true, true),
    Corridor("DE", "Germany", "EUR", R.drawable.flag_de, false, true, true),
    Corridor("FR", "France", "EUR", R.drawable.flag_fr, false, true, true),
    Corridor("JP", "Japan", "JPY", R.drawable.flag_jp, false, false, true),
    Corridor("PK", "Pakistan", "PKR", R.drawable.flag_pk, false, false, true),
    Corridor("BD", "Bangladesh", "BDT", R.drawable.flag_bd, false, false, true),
    Corridor("ID", "Indonesia", "IDR", R.drawable.flag_id, false, false, true),
    Corridor("VN", "Vietnam", "VND", R.drawable.flag_vn, false, false, true),
    Corridor("EG", "Egypt", "EGP", R.drawable.flag_eg, false, false, true),
)

@Composable
fun RampsScreen(onClose: () -> Unit) {
    // hub → picker(direction) → amount(corridor, direction)
    var direction by remember { mutableStateOf<Direction?>(null) }
    var corridor by remember { mutableStateOf<Corridor?>(null) }

    when {
        corridor != null && direction != null ->
            AmountForm(corridor!!, direction!!, onBack = { corridor = null })
        direction != null ->
            CorridorPicker(direction!!, onBack = { direction = null }, onPick = { corridor = it })
        else ->
            RampsHub(onClose = onClose, onAdd = { direction = Direction.OnRamp }, onCashOut = { direction = Direction.OffRamp })
    }
}

@Composable
private fun RampsHub(onClose: () -> Unit, onAdd: () -> Unit, onCashOut: () -> Unit) {
    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        HubHeader("Money in and out", onClose = onClose)
        Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Eyebrow("Move between banks and Talise")
            HubCard(R.drawable.hi_card, "Add money", "Fund your wallet from a bank in your country.", onAdd)
            HubCard(R.drawable.hi_bank, "Cash out", "Withdraw USDsui to your linked bank account.", onCashOut)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                Icon(painterResource(R.drawable.hi_globe), null, tint = TaliseColors.fgDim, modifier = Modifier.size(14.dp))
                Text("Rails settle in USDsui, pegged 1:1 to USD on Sui.", style = TaliseType.mono(10.sp), color = TaliseColors.fgDim)
            }
        }
    }
}

@Composable
private fun HubCard(icon: Int, title: String, subtitle: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(TaliseColors.surface, RoundedCornerShape(24.dp))
            .clickable { onClick() }.padding(horizontal = 18.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(42.dp).clip(RoundedCornerShape(13.dp)).background(TaliseColors.greenMint.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
            Icon(painterResource(icon), null, tint = TaliseColors.greenMint, modifier = Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = TaliseType.heading(16.sp, FontWeight.SemiBold), letterSpacing = (-0.3).sp, color = TaliseColors.fg)
            Text(subtitle, style = TaliseType.body(12.5.sp, FontWeight.Light), color = TaliseColors.fgMuted)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = TaliseColors.fgDim, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun CorridorPicker(direction: Direction, onBack: () -> Unit, onPick: (Corridor) -> Unit) {
    val rows = CORRIDORS.filter { if (direction == Direction.OnRamp) it.onramp else it.offramp }
    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        HubHeader(if (direction == Direction.OnRamp) "Add money" else "Cash out", onBack = onBack)
        Text(
            "Choose the country and currency to ${if (direction == Direction.OnRamp) "fund from" else "cash out to"}.",
            style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted,
            modifier = Modifier.padding(horizontal = 20.dp).padding(bottom = 8.dp),
        )
        LazyColumn(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(rows, key = { it.code }) { c ->
                CorridorRow(c, enabled = c.available, onClick = { if (c.available) onPick(c) })
            }
        }
    }
}

@Composable
private fun CorridorRow(c: Corridor, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(TaliseColors.surface, RoundedCornerShape(18.dp))
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Image(
            painterResource(c.flag), null,
            modifier = Modifier.size(34.dp).clip(CircleShape),
            contentScale = ContentScale.Crop,
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(c.name, style = TaliseType.body(15.sp, FontWeight.Medium), color = if (enabled) TaliseColors.fg else TaliseColors.fgMuted)
            Text(c.currency, style = TaliseType.mono(11.sp), color = TaliseColors.fgDim)
        }
        if (!enabled) {
            Text("SOON", style = TaliseType.mono(9.sp, FontWeight.Medium), letterSpacing = 1.0.sp, color = TaliseColors.fgDim)
        } else {
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = TaliseColors.fgDim, modifier = Modifier.size(20.dp))
        }
    }
}

@Composable
private fun AmountForm(c: Corridor, direction: Direction, onBack: () -> Unit) {
    var amount by remember { mutableStateOf("") }
    val cta = if (direction == Direction.OnRamp) "Continue" else "Withdraw"
    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        HubHeader(if (direction == Direction.OnRamp) "Add money" else "Cash out", onBack = onBack)
        Column(Modifier.padding(horizontal = 20.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Image(painterResource(c.flag), null, modifier = Modifier.size(30.dp).clip(CircleShape), contentScale = ContentScale.Crop)
                Text("${c.name} · ${c.currency}", style = TaliseType.body(14.sp, FontWeight.Medium), color = TaliseColors.fg)
            }
            Box(Modifier.fillMaxWidth().padding(vertical = 20.dp), contentAlignment = Alignment.Center) {
                Text("$" + amount.ifBlank { "0" }, style = TaliseType.display(52.sp, FontWeight.SemiBold), letterSpacing = (-1.6).sp, color = TaliseColors.fg)
            }
            androidx.compose.material3.OutlinedTextField(
                value = amount,
                onValueChange = { amount = it.filter { ch -> ch.isDigit() || ch == '.' } },
                label = { Text("Amount (USD)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth(),
            )
            val ready = (amount.toDoubleOrNull() ?: 0.0) > 0.0
            Box(
                Modifier.fillMaxWidth().height(54.dp).clip(RoundedCornerShape(16.dp))
                    .background(if (ready) TaliseColors.greenMint else TaliseColors.surface2)
                    .clickable(enabled = ready) { /* Bridge on/off-ramp requires KYC + a linked bank; opens in-app once provisioned. */ },
                contentAlignment = Alignment.Center,
            ) {
                Text(cta, style = TaliseType.body(15.sp, FontWeight.SemiBold), color = if (ready) TaliseColors.inkOnGreen else TaliseColors.fgDim)
            }
            Text(
                "Bank ${if (direction == Direction.OnRamp) "funding" else "cash-out"} for ${c.name} is served by Bridge. You'll verify your identity once, then it's a tap.",
                style = TaliseType.mono(10.sp), color = TaliseColors.fgDim,
            )
        }
    }
}

@Composable
private fun HubHeader(title: String, onClose: (() -> Unit)? = null, onBack: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 12.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            CircleBtn(Icons.AutoMirrored.Filled.ArrowBack, onBack)
        } else if (onClose != null) {
            CircleBtn(Icons.Filled.Close, onClose)
        }
        Spacer(Modifier.size(12.dp))
        Text(title, style = TaliseType.heading(24.sp, FontWeight.Medium), letterSpacing = (-0.6).sp, color = TaliseColors.fg)
    }
}

@Composable
private fun CircleBtn(icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    Box(
        Modifier.size(34.dp).clip(CircleShape).background(TaliseColors.surface2).clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) { Icon(icon, null, tint = TaliseColors.fgMuted, modifier = Modifier.size(18.dp)) }
}
