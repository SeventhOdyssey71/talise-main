package io.talise.app.feature.send

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.components.SlideToConfirm
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Send flow — iOS `SendFlowView` (amount → recipient → review → sending → complete).
 * This scaffold shows the amount + recipient + the shared `SlideToConfirm`; the
 * sponsor-prepare → sign (ZkLoginCoordinator) → execute pipeline lands in phase 2.
 */
@Composable
fun SendFlow(onClose: () -> Unit) {
    var amount by remember { mutableStateOf("") }
    var recipient by remember { mutableStateOf("") }
    var reset by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }

    Column(
        Modifier.fillMaxSize().background(TaliseColors.bg).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Send", style = TaliseType.heading(26.sp, FontWeight.Medium), color = TaliseColors.fg)
            IconButton(onClick = onClose) { Icon(Icons.Filled.Close, contentDescription = "Close", tint = TaliseColors.fgMuted) }
        }

        Box(Modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
            Text(
                "$" + (amount.ifBlank { "0" }),
                style = TaliseType.display(56.sp, FontWeight.SemiBold),
                color = TaliseColors.fg,
            )
        }

        OutlinedTextField(
            value = amount,
            onValueChange = { amount = it.filter { c -> c.isDigit() || c == '.' } },
            label = { Text("Amount (USD)") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = recipient,
            onValueChange = { recipient = it },
            label = { Text("@handle, name.talise.sui or 0x…") },
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(8.dp))
        SlideToConfirm(
            title = "Slide to send",
            enabled = amount.toDoubleOrNull()?.let { it > 0 } == true && recipient.isNotBlank(),
            reset = reset,
            onConfirm = {
                // Phase 2: resolve → sponsor-prepare → ZkLoginCoordinator.signTransaction → sponsor-execute.
                note = "Send pipeline wiring lands in phase 2."
                reset = !reset
            },
        )
        if (note != null) Text(note!!, style = TaliseType.body(12.sp), color = TaliseColors.fgMuted)
    }
}
