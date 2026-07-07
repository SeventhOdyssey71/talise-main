package io.talise.app.feature.deposit

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.R
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay

/**
 * Deposit (Add money) hub, pixel port of iOS `DepositFlowView`.
 *
 * Full page (not a sheet): inline header with title + close, an
 * "Deposit with" section of large soft funding-path cards (icon chip +
 * title + muted subtitle + chevron), and a trust footer. Paths not yet
 * wired to a backend (Cash, Bank transfer) carry a quiet "Soon" suffix,
 * a dimmed chip, and surface a coming-soon toast on tap.
 */
@Composable
fun DepositScreen(onClose: () -> Unit) {
    // Onchain deposit pushes the Receive page (QR + Sui address), mirroring
    // iOS `DepositOnchainView` which embeds `ReceiveView`. A back tap returns
    // to the deposit hub rather than closing the whole flow.
    var showOnchain by remember { mutableStateOf(false) }
    if (showOnchain) {
        io.talise.app.feature.receive.ReceiveScreen(onClose = { showOnchain = false })
        return
    }

    var toast by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(toast) {
        if (toast != null) {
            delay(2200)
            toast = null
        }
    }

    Box(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        Column(Modifier.fillMaxSize()) {
            // Inline header, title (26 medium) + circular close, then muted subtitle.
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(top = 18.dp, bottom = 18.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "Deposit",
                        style = TaliseType.heading(26.sp, FontWeight.Medium),
                        letterSpacing = (-0.6).sp,
                        color = TaliseColors.fg,
                    )
                    Spacer(Modifier.weight(1f))
                    Box(
                        Modifier
                            .size(34.dp)
                            .clip(CircleShape)
                            .background(TaliseColors.surface2)
                            .clickable { onClose() },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Filled.Close,
                            contentDescription = "Close",
                            tint = TaliseColors.fg,
                            modifier = Modifier.size(15.dp),
                        )
                    }
                }
                Text(
                    "Add money to your Talise wallet.",
                    style = TaliseType.body(14.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                )
            }

            // Scrolling body.
            Column(
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp)
                    .padding(top = 4.dp, bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(22.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Eyebrow(
                        "Deposit with",
                        color = TaliseColors.fgDim,
                        modifier = Modifier.padding(start = 4.dp),
                    )

                    // Card on-ramp, LOCKED: honest "Soon" instead of a dead-end.
                    FundingPathCard(
                        painter = painterResource(R.drawable.hi_card),
                        title = "Cash",
                        subtitle = "Buy USDsui with your bank card",
                        soon = true,
                        onClick = { toast = "Card top-ups are coming soon." },
                    )

                    // Onchain receive (QR / address). Live.
                    FundingPathCard(
                        painter = painterResource(R.drawable.hi_qr),
                        title = "Crypto",
                        subtitle = "Receive USDsui to your Talise QR or address",
                        onClick = { showOnchain = true },
                    )

                    // Bank transfer, Bridge corridors, gated off for now.
                    FundingPathCard(
                        painter = painterResource(R.drawable.hi_bank),
                        title = "Bank transfer",
                        subtitle = "From a local bank account - no card needed",
                        soon = true,
                        onClick = { toast = "Bank transfers are coming soon." },
                    )
                }

                // Trust footer.
                Row(
                    Modifier.fillMaxWidth().padding(top = 4.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.Filled.Lock,
                        contentDescription = null,
                        tint = TaliseColors.fgDim,
                        modifier = Modifier.size(11.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "Funds land as USDsui - pegged 1:1 to USD on Sui.",
                        style = TaliseType.mono(10.sp, FontWeight.Light),
                        letterSpacing = 0.2.sp,
                        color = TaliseColors.fgDim,
                    )
                }
            }
        }

        // Coming-soon toast, capsule surface pinned to the bottom.
        toast?.let { message ->
            Box(
                Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 32.dp),
            ) {
                Text(
                    message,
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    color = TaliseColors.fg,
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(TaliseColors.surface2)
                        .padding(horizontal = 18.dp, vertical = 12.dp),
                )
            }
        }
    }
}

/**
 * One deposit path, iOS `FundingPathCard`. 42dp squircle icon chip in a
 * soft wash, 16 semibold title (+ quiet "Soon" suffix when gated), 12.5
 * muted subtitle, radius-24 surface card with a hairline ring. The
 * content dims to 75% when `soon` while the card surface stays opaque.
 */
@Composable
private fun FundingPathCard(
    painter: Painter,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
    soon: Boolean = false,
) {
    val shape = RoundedCornerShape(24.dp)
    val tint = if (soon) TaliseColors.fgMuted else TaliseColors.greenMint
    Box(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(TaliseColors.surface, shape)
            .border(1.dp, Color.White.copy(alpha = 0.05f), shape)
            .clickable { onClick() },
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .alpha(if (soon) 0.75f else 1f)
                .padding(horizontal = 18.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(
                Modifier
                    .size(42.dp)
                    .background(tint.copy(alpha = 0.12f), RoundedCornerShape(42.dp * 0.32f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(painter, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
            }
            Column(
                Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.5.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    Text(
                        title,
                        style = TaliseType.heading(16.sp, FontWeight.SemiBold),
                        letterSpacing = (-0.3).sp,
                        color = TaliseColors.fg,
                    )
                    if (soon) {
                        Text(
                            "Soon",
                            style = TaliseType.mono(10.sp),
                            letterSpacing = 0.6.sp,
                            color = TaliseColors.fgDim,
                        )
                    }
                }
                Text(
                    subtitle,
                    style = TaliseType.body(12.5.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = TaliseColors.fgDim,
                modifier = Modifier.size(14.dp),
            )
        }
    }
}
