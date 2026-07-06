package io.talise.app.feature.cheques

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
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
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.theme.TaliseColors

/**
 * Cheques, claimable money links, ported from iOS ChequesView. Centerpiece is
 * the skeuomorphic paper-cheque card (cream stock, serif TALISE header, PAY TO
 * THE ORDER OF, boxed figure, amount in words, MEMO + AUTHORIZED SIGNATURE, and
 * a rotated status stamp). Two segments: Write and My cheques.
 */

private val Ink = Color(0xFF2B2A26)
private val InkSoft = Color(0xFF6E685C)
private val Rule = Color(0xFF9C9486)
private val PaperTop = Color(0xFFF7F3E8)
private val PaperBottom = Color(0xFFEDE6D5)
private val GreenDeep = Color(0xFF4B8A37)
private val StampRed = Color(0xFFA23B2E)

@Composable
fun ChequesScreen(onClose: () -> Unit) {
    var tab by remember { mutableStateOf(0) } // 0 write, 1 my cheques
    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 12.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(34.dp).clip(RoundedCornerShape(50)).background(TaliseColors.surface2).clickable { onClose() },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Filled.Close, null, tint = TaliseColors.fgMuted, modifier = Modifier.size(18.dp)) }
            Spacer(Modifier.width(12.dp))
            Text("Cheques", style = androidx.compose.ui.text.TextStyle(fontFamily = FontFamily.Default, fontSize = 24.sp, fontWeight = FontWeight.Medium, letterSpacing = (-0.6).sp), color = TaliseColors.fg)
        }
        // Segmented control
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)
                .clip(RoundedCornerShape(12.dp)).background(TaliseColors.surface).padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Segment("Write", tab == 0, Modifier.weight(1f)) { tab = 0 }
            Segment("My cheques", tab == 1, Modifier.weight(1f)) { tab = 1 }
        }
        if (tab == 0) WriteCheque() else MyCheques()
    }
}

@Composable
private fun Segment(label: String, active: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier.clip(RoundedCornerShape(9.dp)).background(if (active) TaliseColors.surface2 else Color.Transparent).clickable { onClick() }.padding(vertical = 9.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, fontSize = 13.sp, fontWeight = if (active) FontWeight.Medium else FontWeight.Normal, color = if (active) TaliseColors.fg else TaliseColors.fgDim)
    }
}

@Composable
private fun WriteCheque() {
    var payee by remember { mutableStateOf("") }
    var amount by remember { mutableStateOf("") }
    var memo by remember { mutableStateOf("") }
    var signature by remember { mutableStateOf("") }
    val amt = amount.toDoubleOrNull() ?: 0.0

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Eyebrow("Write a cheque")
        ChequeCard(payee = payee, amountUsd = amt, memo = memo, signature = signature, stamp = null)
        OutlinedTextField(payee, { payee = it }, label = { Text("Pay to the order of") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(
            amount, { amount = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("Amount (USD)") },
            keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Decimal), modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(memo, { memo = it }, label = { Text("Memo (optional)") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(signature, { signature = it }, label = { Text("Signature") }, modifier = Modifier.fillMaxWidth())
        val ready = amt > 0 && payee.isNotBlank()
        Box(
            Modifier.fillMaxWidth().height(54.dp).clip(RoundedCornerShape(16.dp))
                .background(if (ready) TaliseColors.greenMint else TaliseColors.surface2)
                .clickable(enabled = ready) { /* creates a claimable cheque link via the escrow rail once wired */ },
            contentAlignment = Alignment.Center,
        ) {
            Text("Create cheque", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = if (ready) TaliseColors.inkOnGreen else TaliseColors.fgDim)
        }
        Text("A cheque is a claimable link. Anyone with it can cash it into their Talise wallet; unclaimed cheques are yours to reclaim.", fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = TaliseColors.fgDim)
    }
}

@Composable
private fun MyCheques() {
    // No cheques endpoint on Android yet, so show the iOS empty state.
    Column(
        Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(48.dp))
        Text("No cheques yet", fontSize = 17.sp, fontWeight = FontWeight.Medium, color = TaliseColors.fg)
        Text("Write one to send money as a claimable link.", fontSize = 13.sp, color = TaliseColors.fgMuted)
    }
}

/** The paper cheque, ported from iOS ChequeCard. */
@Composable
fun ChequeCard(payee: String, amountUsd: Double, memo: String, signature: String, stamp: String?) {
    Box(
        Modifier.fillMaxWidth().height(210.dp).clip(RoundedCornerShape(16.dp))
            .background(Brush.linearGradient(listOf(PaperTop, PaperBottom))),
    ) {
        Column(Modifier.fillMaxSize().padding(18.dp)) {
            // Header band
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Text("TALISE", fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black, fontSize = 15.sp, letterSpacing = 2.sp, color = GreenDeep)
                    Text("PAY ANYONE, ANYWHERE", fontFamily = FontFamily.Monospace, fontSize = 6.sp, letterSpacing = 1.5.sp, color = InkSoft)
                }
                Spacer(Modifier.weight(1f))
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Text("No. 0001", fontFamily = FontFamily.Monospace, fontSize = 9.sp, fontWeight = FontWeight.Medium, color = InkSoft)
                    Text("USDsui", fontFamily = FontFamily.Serif, fontSize = 9.sp, fontWeight = FontWeight.SemiBold, color = Ink)
                }
            }
            Box(Modifier.fillMaxWidth().height(1.dp).padding(top = 8.dp).background(Rule.copy(alpha = 0.5f)))
            // Pay to the order of + figure box
            Row(Modifier.fillMaxWidth().padding(top = 14.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text("PAY TO THE ORDER OF", fontFamily = FontFamily.Monospace, fontSize = 7.sp, letterSpacing = 1.sp, color = InkSoft)
                    Text(payee.ifBlank { "—" }, fontFamily = FontFamily.Serif, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Box(Modifier.fillMaxWidth().height(1.dp).background(Rule.copy(alpha = 0.6f)))
                }
                Text(
                    "$" + "%,.2f".format(amountUsd),
                    fontFamily = FontFamily.Serif, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Ink,
                    modifier = Modifier.border(1.2.dp, Ink.copy(alpha = 0.5f), RoundedCornerShape(6.dp)).padding(horizontal = 10.dp, vertical = 5.dp),
                )
            }
            // Amount in words
            Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(amountInWords(amountUsd), fontFamily = FontFamily.Serif, fontStyle = FontStyle.Italic, fontSize = 11.sp, fontWeight = FontWeight.Medium, color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text("USDsui", fontFamily = FontFamily.Serif, fontSize = 9.sp, color = InkSoft)
            }
            Spacer(Modifier.weight(1f))
            // Memo + signature
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(memo.ifBlank { " " }, fontFamily = FontFamily.Serif, fontSize = 10.sp, color = Ink, maxLines = 1)
                    Box(Modifier.width(110.dp).height(1.dp).background(Rule.copy(alpha = 0.5f)))
                    Text("MEMO", fontFamily = FontFamily.Monospace, fontSize = 6.sp, color = InkSoft)
                }
                Spacer(Modifier.weight(1f))
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(signature.ifBlank { " " }, fontFamily = FontFamily.Cursive, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = GreenDeep, maxLines = 1)
                    Box(Modifier.width(120.dp).height(1.dp).background(Rule.copy(alpha = 0.5f)))
                    Text("AUTHORIZED SIGNATURE", fontFamily = FontFamily.Monospace, fontSize = 6.sp, color = InkSoft)
                }
            }
        }
        if (stamp != null) {
            Box(Modifier.align(Alignment.Center).rotate(-14f).border(3.dp, StampRed.copy(alpha = 0.85f), RoundedCornerShape(6.dp)).padding(8.dp)) {
                Text(stamp, fontWeight = FontWeight.Black, fontSize = 26.sp, letterSpacing = 2.sp, color = StampRed.copy(alpha = 0.85f))
            }
        }
    }
}

/** Dollar amount to words, e.g. 123.45 -> "One hundred twenty three and 45/100". */
private fun amountInWords(amount: Double): String {
    if (amount <= 0) return "Zero and 00/100"
    val dollars = amount.toLong()
    val cents = Math.round((amount - dollars) * 100).toInt()
    val words = if (dollars == 0L) "Zero" else numberToWords(dollars).replaceFirstChar { it.uppercase() }
    return "$words and ${"%02d".format(cents)}/100"
}

private fun numberToWords(n: Long): String {
    if (n == 0L) return "zero"
    val ones = arrayOf("", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen")
    val tens = arrayOf("", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")
    fun under1000(x: Int): String {
        val sb = StringBuilder()
        val h = x / 100; val r = x % 100
        if (h > 0) sb.append(ones[h]).append(" hundred").append(if (r > 0) " " else "")
        if (r in 1..19) sb.append(ones[r])
        else if (r >= 20) { sb.append(tens[r / 10]); if (r % 10 > 0) sb.append(" ").append(ones[r % 10]) }
        return sb.toString()
    }
    val parts = mutableListOf<String>()
    val scales = listOf(1_000_000_000L to "billion", 1_000_000L to "million", 1_000L to "thousand", 1L to "")
    var rem = n
    for ((value, name) in scales) {
        if (rem >= value && value >= 1000) {
            val chunk = (rem / value).toInt()
            parts.add(under1000(chunk) + if (name.isNotEmpty()) " $name" else "")
            rem %= value
        }
    }
    if (rem in 1 until 1000) parts.add(under1000(rem.toInt()))
    return parts.joinToString(" ").trim()
}
