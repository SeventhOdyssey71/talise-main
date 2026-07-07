package io.talise.app.feature.chat

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.R
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * A clean paper-style receipt for a successful agent transaction — a white slip
 * with a torn bottom edge, monospace ledger rows, a barcode, and a "thank you".
 * The Android port of iOS `AgentReceiptSheet` (rendered inside a bottom sheet).
 * Sharing hands the system share sheet the receipt as text + the Suiscan link.
 */
@Composable
fun AgentReceiptSheet(
    amountUsd: Double,
    recipient: String,
    digest: String,
    title: String = "Sent",
) {
    val context = LocalContext.current
    val ink = Color(0xFF192117)   // near-black green
    val paper = Color(0xFFFAFAF5) // warm white
    val suiscanUrl = "https://suiscan.xyz/mainnet/tx/$digest"

    Column(
        Modifier
            .fillMaxWidth()
            .background(TaliseColors.bg)
            .padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Column(
            Modifier
                .weight(1f, fill = false)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 36.dp)
                .padding(top = 24.dp),
        ) {
            Slip(amountUsd = amountUsd, recipient = recipient, digest = digest, title = title, ink = ink, paper = paper)
        }

        Column(
            Modifier.fillMaxWidth().padding(horizontal = 22.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Share receipt — hands the system share sheet the receipt summary.
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(50.dp)
                    .clip(RoundedCornerShape(25.dp))
                    .background(TaliseColors.greenMint)
                    .clickable {
                        val share = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(
                                Intent.EXTRA_TEXT,
                                "Talise receipt. $title ${AgentExecutor.usd2(amountUsd)} to $recipient. View on Suiscan: $suiscanUrl",
                            )
                        }
                        context.startActivity(Intent.createChooser(share, "Share receipt"))
                    },
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Share, contentDescription = null, tint = TaliseColors.bg, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(8.dp))
                Text("Share receipt", style = TaliseType.body(15.sp, FontWeight.SemiBold), color = TaliseColors.bg)
            }
            Text(
                "View on Suiscan",
                style = TaliseType.body(13.sp, FontWeight.Medium),
                color = TaliseColors.fgMuted,
                modifier = Modifier.clickable {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(suiscanUrl)))
                },
            )
        }
    }
}

/** The paper slip itself. */
@Composable
private fun Slip(
    amountUsd: Double,
    recipient: String,
    digest: String,
    title: String,
    ink: Color,
    paper: Color,
) {
    Column(Modifier.fillMaxWidth().shadow(elevation = 18.dp, shape = RoundedCornerShape(2.dp))) {
        Column(
            Modifier.fillMaxWidth().background(paper),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // Brand mark (tinted to the receipt ink) instead of a text wordmark.
            Image(
                painter = painterResource(R.drawable.taliselogo),
                contentDescription = null,
                colorFilter = ColorFilter.tint(ink),
                modifier = Modifier.padding(top = 28.dp).size(width = 34.dp, height = 31.dp),
            )
            Text(
                "PAYMENT RECEIPT",
                style = TaliseType.mono(10.sp, FontWeight.Medium).copy(letterSpacing = 3.sp),
                color = ink.copy(alpha = 0.5f),
            )

            DashedLine(ink)

            Column(
                Modifier.fillMaxWidth().padding(horizontal = 22.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                LedgerLine(title.uppercase(Locale.US), AgentExecutor.usd2(amountUsd), ink)
                LedgerLine("TO", recipient, ink)
                LedgerLine("DATE", shortDate(), ink)
                LedgerLine("NETWORK FEE", "FREE", ink)
                LedgerLine("STATUS", "CONFIRMED", ink)
            }

            DashedLine(ink)

            Row(
                Modifier.fillMaxWidth().padding(horizontal = 22.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("TOTAL", style = TaliseType.mono(13.sp, FontWeight.Bold), color = ink)
                Spacer(Modifier.weight(1f))
                Text(AgentExecutor.usd2(amountUsd), style = TaliseType.mono(17.sp, FontWeight.Bold), color = ink)
            }

            Barcode(
                seed = digest,
                ink = ink,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(46.dp)
                    .padding(horizontal = 22.dp)
                    .padding(top = 4.dp),
            )
            Text(shortDigest(digest), style = TaliseType.mono(10.sp), color = ink.copy(alpha = 0.55f))

            Text(
                "THANK YOU",
                style = TaliseType.mono(12.sp, FontWeight.SemiBold).copy(letterSpacing = 3.sp),
                color = ink.copy(alpha = 0.75f),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 6.dp, bottom = 22.dp),
            )
        }
        // Torn bottom edge.
        Spacer(
            Modifier
                .fillMaxWidth()
                .height(12.dp)
                .clip(tornEdgeShape())
                .background(paper),
        )
    }
}

@Composable
private fun LedgerLine(label: String, value: String, ink: Color) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = TaliseType.mono(11.sp), color = ink.copy(alpha = 0.5f))
        Spacer(Modifier.width(12.dp).weight(1f))
        Text(
            value,
            style = TaliseType.mono(12.sp, FontWeight.Medium),
            color = ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun DashedLine(ink: Color) {
    Canvas(
        Modifier
            .fillMaxWidth()
            .height(1.dp)
            .padding(horizontal = 22.dp),
    ) {
        drawLine(
            color = ink.copy(alpha = 0.25f),
            start = Offset(0f, size.height / 2f),
            end = Offset(size.width, size.height / 2f),
            strokeWidth = 1.dp.toPx(),
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 3.dp.toPx())),
        )
    }
}

/** A faux barcode whose bar widths are derived from the tx digest (stable). */
@Composable
private fun Barcode(seed: String, ink: Color, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val bytes = seed.toByteArray(Charsets.UTF_8)
        if (bytes.isEmpty()) return@Canvas
        var x = 0f
        var i = 0
        val unit = 1.dp.toPx()
        while (x < size.width) {
            val b = bytes[i % bytes.size].toInt() and 0xFF
            val bar = (1 + b % 4) * unit
            val gap = (1 + (b shr 2) % 3) * unit
            if (i % 2 == 0) {
                drawRect(
                    color = ink,
                    topLeft = Offset(x, 0f),
                    size = androidx.compose.ui.geometry.Size(bar, size.height),
                )
            }
            x += bar + gap
            i += 1
        }
    }
}

/** A zigzag "torn paper" bottom edge. */
private fun tornEdgeShape(): Shape = androidx.compose.foundation.shape.GenericShape { size, _ ->
    val teeth = 22
    val w = size.width / teeth
    moveTo(0f, 0f)
    lineTo(size.width, 0f)
    var x = size.width
    var down = true
    while (x > 0f) {
        x -= w
        lineTo(maxOf(x, 0f), if (down) size.height else 0f)
        down = !down
    }
    close()
}

private fun shortDigest(digest: String): String =
    if (digest.length > 16) "${digest.take(8)}…${digest.takeLast(8)}" else digest

private fun shortDate(): String =
    SimpleDateFormat("MMM d, yyyy  HH:mm", Locale.US).format(Date())
