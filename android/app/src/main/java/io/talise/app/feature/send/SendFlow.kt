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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.ui.components.SlideToConfirm
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Send flow — amount + recipient + SlideToConfirm, wired to [SendViewModel]:
 * resolve → sponsor-prepare → local zkLogin sign → gasless-submit → digest.
 */
@Composable
fun SendFlow(onClose: () -> Unit, vm: SendViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()

    when (val s = state) {
        is SendViewModel.State.Success -> SendResult(
            title = "Sent",
            detail = "$" + "%.2f".format(s.amount) + " to " + s.recipient,
            suiscan = s.suiscan,
            onDone = onClose,
        )
        is SendViewModel.State.Error -> SendResult(
            title = "Send failed",
            detail = s.message,
            suiscan = null,
            error = true,
            onDone = { vm.reset() },
            doneLabel = "Try again",
        )
        else -> SendForm(
            working = s as? SendViewModel.State.Working,
            onClose = onClose,
            onSend = { amount, recipient -> vm.send(amount, recipient) },
        )
    }
}

@Composable
private fun SendForm(
    working: SendViewModel.State.Working?,
    onClose: () -> Unit,
    onSend: (Double, String) -> Unit,
) {
    var amount by remember { mutableStateOf("") }
    var recipient by remember { mutableStateOf("") }
    var reset by remember { mutableStateOf(false) }
    val busy = working != null

    Column(
        Modifier.fillMaxSize().background(TaliseColors.bg).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Send", style = TaliseType.heading(26.sp, FontWeight.Medium), color = TaliseColors.fg)
            IconButton(onClick = onClose, enabled = !busy) { Icon(Icons.Filled.Close, contentDescription = "Close", tint = TaliseColors.fgMuted) }
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
            enabled = !busy,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = recipient,
            onValueChange = { recipient = it },
            label = { Text("@handle, name.talise.sui or 0x…") },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(8.dp))
        if (busy) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                CircularProgressIndicator(color = TaliseColors.accent, modifier = Modifier.size(20.dp))
                Text(working!!.step.replaceFirstChar { it.uppercase() } + "…", style = TaliseType.body(14.sp), color = TaliseColors.fgMuted)
            }
        } else {
            SlideToConfirm(
                title = "Slide to send",
                enabled = amount.toDoubleOrNull()?.let { it > 0 } == true && recipient.isNotBlank(),
                reset = reset,
                onConfirm = {
                    val amt = amount.toDoubleOrNull()
                    if (amt != null && amt > 0 && recipient.isNotBlank()) onSend(amt, recipient.trim())
                    reset = !reset
                },
            )
        }
    }
}

@Composable
private fun SendResult(
    title: String,
    detail: String,
    suiscan: String?,
    onDone: () -> Unit,
    error: Boolean = false,
    doneLabel: String = "Done",
) {
    Column(
        Modifier.fillMaxSize().background(TaliseColors.bg).padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.size(72.dp).background(
                (if (error) TaliseColors.sentRed else TaliseColors.accent).copy(alpha = 0.16f), CircleShape,
            ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.CheckCircle,
                contentDescription = null,
                tint = if (error) TaliseColors.sentRedSoft else TaliseColors.accent,
                modifier = Modifier.size(36.dp),
            )
        }
        Spacer(Modifier.height(20.dp))
        Text(title, style = TaliseType.heading(24.sp, FontWeight.SemiBold), color = TaliseColors.fg)
        Spacer(Modifier.height(8.dp))
        Text(detail, style = TaliseType.body(14.sp), color = TaliseColors.fgMuted)
        if (suiscan != null) {
            Spacer(Modifier.height(6.dp))
            Text(suiscan, style = TaliseType.mono(11.sp), color = TaliseColors.fgDim)
        }
        Spacer(Modifier.height(28.dp))
        TextButton(onClick = onDone) {
            Text(doneLabel, style = TaliseType.body(15.sp, FontWeight.Medium), color = TaliseColors.accent)
        }
    }
}
