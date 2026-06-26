package io.talise.app.feature.deposit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.components.OptionCardRow
import io.talise.app.ui.components.TaliseIcons
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/** Deposit (Add money) hub — iOS `DepositFlowView`: funding paths as option rows. */
@Composable
fun DepositScreen(onClose: () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(TaliseColors.bg).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Deposit", style = TaliseType.heading(26.sp, FontWeight.Medium), color = TaliseColors.fg)
            IconButton(onClick = onClose) { Icon(Icons.Filled.Close, contentDescription = "Close", tint = TaliseColors.fgMuted) }
        }
        Text("Add money to your Talise wallet.", style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted)

        OptionCardRow(TaliseIcons.card, "Cash", "Buy USDsui with your bank card", onClick = {}, badge = "SOON")
        OptionCardRow(TaliseIcons.qr, "Crypto", "Receive USDsui to your QR or address", onClick = {})
        OptionCardRow(TaliseIcons.bank, "Bank transfer", "From a local bank — USD, EUR, GBP…", onClick = {}, badge = "SOON")
    }
}
