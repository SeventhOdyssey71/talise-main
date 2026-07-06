package io.talise.app.feature.rules

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
 * Rules / Automations, ported from iOS RulesView + RuleEditView. A rule is money
 * that runs itself: a fixed amount sent to a recipient on a schedule from the
 * rule's own non-custodial on-chain pot (permissionless execute_due, no cron).
 * Hub lists active/paused rules; the editor sets recipient + amount + cadence.
 */

private enum class Cadence(val label: String) { Daily("Every day"), Weekly("Every week"), Monthly("Monthly (a day)") }

@Composable
fun RulesScreen(onClose: () -> Unit) {
    var editing by remember { mutableStateOf(false) }
    if (editing) RuleEdit(onBack = { editing = false }) else RulesHub(onClose = onClose, onNew = { editing = true })
}

@Composable
private fun RulesHub(onClose: () -> Unit, onNew: () -> Unit) {
    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        HeaderBar(onClick = onClose, icon = Icons.Filled.Close)
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Eyebrow("Automations")
            Text("Money that runs itself", style = TaliseType.heading(26.sp, FontWeight.Medium), letterSpacing = (-0.6).sp, color = TaliseColors.fg)
            Text(
                "Set a rule once, pay a fixed amount to someone on a schedule. It runs automatically and gaslessly.",
                style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted,
            )
        }
        // New rule button
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp).height(54.dp)
                .clip(RoundedCornerShape(16.dp)).background(TaliseColors.greenMint).clickable { onNew() },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
        ) {
            Icon(Icons.Filled.Add, null, tint = TaliseColors.inkOnGreen, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
            Text("New rule", style = TaliseType.body(16.sp, FontWeight.SemiBold), color = TaliseColors.inkOnGreen)
        }
        // Empty state (no /api/rules on Android yet).
        Column(Modifier.fillMaxWidth().padding(top = 40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.size(52.dp).clip(RoundedCornerShape(16.dp)).background(TaliseColors.surface2), contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.hi_stream), null, tint = TaliseColors.fgMuted, modifier = Modifier.size(24.dp))
            }
            Text("No rules yet", style = TaliseType.heading(17.sp, FontWeight.Medium), color = TaliseColors.fg)
            Text("Create one to send money on a schedule, automatically.", style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted)
        }
    }
}

@Composable
private fun RuleEdit(onBack: () -> Unit) {
    var recipient by remember { mutableStateOf("") }
    var amount by remember { mutableStateOf("") }
    var cadence by remember { mutableStateOf(Cadence.Daily) }
    var dayOfMonth by remember { mutableStateOf(1) }
    val amt = amount.toDoubleOrNull() ?: 0.0

    Column(
        Modifier.fillMaxSize().background(TaliseColors.bg).verticalScroll(rememberScrollState()),
    ) {
        HeaderBar(onClick = onBack, icon = Icons.AutoMirrored.Filled.ArrowBack)
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Eyebrow("New rule")
            Text("Pay on a schedule", style = TaliseType.heading(24.sp, FontWeight.Medium), letterSpacing = (-0.6).sp, color = TaliseColors.fg)

            OutlinedTextField(recipient, { recipient = it }, label = { Text("Pays who (@handle, name.sui, 0x)") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(
                amount, { amount = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("Amount (USD)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth(),
            )

            Text("HOW OFTEN", style = TaliseType.mono(10.sp), letterSpacing = 1.4.sp, color = TaliseColors.fgDim)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Cadence.entries.forEach { c ->
                    val active = c == cadence
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp))
                            .background(if (active) TaliseColors.greenMint.copy(alpha = 0.14f) else TaliseColors.surface)
                            .clickable { cadence = c }.padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(c.label, style = TaliseType.body(15.sp, if (active) FontWeight.Medium else FontWeight.Normal), color = if (active) TaliseColors.fg else TaliseColors.fgMuted)
                        Spacer(Modifier.weight(1f))
                        if (active) Icon(Icons.Filled.Add, null, tint = TaliseColors.greenMint, modifier = Modifier.size(0.dp)) // spacer only
                        Box(Modifier.size(18.dp).clip(RoundedCornerShape(50)).background(if (active) TaliseColors.greenMint else TaliseColors.surface2))
                    }
                }
            }

            if (cadence == Cadence.Monthly) {
                Text("DAY OF MONTH: $dayOfMonth", style = TaliseType.mono(10.sp), letterSpacing = 1.4.sp, color = TaliseColors.fgDim)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(1, 5, 10, 15, 25).forEach { d ->
                        val on = d == dayOfMonth
                        Box(
                            Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(if (on) TaliseColors.greenMint else TaliseColors.surface2).clickable { dayOfMonth = d },
                            contentAlignment = Alignment.Center,
                        ) { Text("$d", style = TaliseType.body(14.sp, FontWeight.Medium), color = if (on) TaliseColors.inkOnGreen else TaliseColors.fgMuted) }
                    }
                }
            }

            val ready = amt >= 0.01 && recipient.isNotBlank()
            Box(
                Modifier.fillMaxWidth().height(54.dp).clip(RoundedCornerShape(16.dp))
                    .background(if (ready) TaliseColors.greenMint else TaliseColors.surface2)
                    .clickable(enabled = ready) { /* funds an on-chain standing_order pot; runs permissionlessly once wired */ },
                contentAlignment = Alignment.Center,
            ) {
                Text("Create rule", style = TaliseType.body(15.sp, FontWeight.SemiBold), color = if (ready) TaliseColors.inkOnGreen else TaliseColors.fgDim)
            }
            Text(
                "The rule funds its own on-chain pot. It can only pay the set amount to the set recipient on schedule; cancel anytime to refund the rest.",
                style = TaliseType.mono(10.sp), color = TaliseColors.fgDim,
            )
        }
    }
}

@Composable
private fun HeaderBar(onClick: () -> Unit, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(34.dp).clip(RoundedCornerShape(50)).background(TaliseColors.surface2).clickable { onClick() }, contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = TaliseColors.fgMuted, modifier = Modifier.size(18.dp))
        }
    }
}
