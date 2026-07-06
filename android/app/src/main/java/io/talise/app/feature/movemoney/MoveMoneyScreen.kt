package io.talise.app.feature.movemoney

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.core.animateFloatAsState
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
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import io.talise.app.R
import io.talise.app.ui.components.TaliseIcons
import io.talise.app.ui.nav.Routes
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * "Move money" hub — a pixel port of iOS `WithdrawFlowView`. A quiet inline
 * header, a "Send" 2×2 primary grid (Cash out / Send / Send abroad / Send
 * privately), then a "More" section with expandable Cheques + Work groups and
 * Payroll / Request money / Rules rows. Locked actions dim and show a "SOON"
 * pill until their flow lands.
 */
@Composable
fun MoveMoneyScreen(nav: NavController) {
    var expanded by remember { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        // ── Inline header ──
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 18.dp, bottom = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Move money",
                style = TaliseType.heading(26.sp, FontWeight.Medium),
                letterSpacing = (-0.6).sp,
                color = TaliseColors.fg,
            )
            Spacer(Modifier.weight(1f))
            Box(
                Modifier.size(34.dp).background(TaliseColors.surface2, CircleShape)
                    .clickable { nav.popBackStack() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Close, contentDescription = "Close", tint = TaliseColors.fg, modifier = Modifier.size(15.dp))
            }
        }

        Column(
            Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp).padding(top = 10.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            SectionLabel("Send")

            // 2×2 primary grid.
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                ActionTile(painterResource(R.drawable.hi_bank), "Cash out", "To your bank", locked = true, onClick = {}, modifier = Modifier.weight(1f))
                ActionTile(painterResource(R.drawable.hi_send), "Send", "@handle or address", onClick = { nav.navigate(Routes.SEND) }, modifier = Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                ActionTile(painterResource(R.drawable.hi_globe), "Send abroad", "Paid in their currency", locked = true, onClick = {}, modifier = Modifier.weight(1f))
                ActionTile(rememberVectorPainter(TaliseIcons.lock), "Send privately", "Amount stays hidden", locked = true, onClick = {}, modifier = Modifier.weight(1f))
            }

            SectionLabel("More", topPad = 6.dp)

            // ── Cheques group ──
            GroupRow(
                painterResource(R.drawable.hi_cheque),
                "Cheques",
                "Write · Cash · My cheques",
                isExpanded = expanded == "cheques",
                onClick = { expanded = if (expanded == "cheques") null else "cheques" },
            )
            AnimatedVisibility(
                visible = expanded == "cheques",
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut(),
            ) {
                SubActionList(
                    listOf(
                        SubAction(rememberVectorPainter(TaliseIcons.write), "Write a cheque"),
                        SubAction(painterResource(R.drawable.hi_cash), "Cash a cheque"),
                        SubAction(rememberVectorPainter(TaliseIcons.list), "My cheques"),
                    ),
                )
            }

            // ── Work group ──
            GroupRow(
                rememberVectorPainter(TaliseIcons.briefcase),
                "Work",
                "Streams · Invoices · Contracts",
                isExpanded = expanded == "work",
                onClick = { expanded = if (expanded == "work") null else "work" },
            )
            AnimatedVisibility(
                visible = expanded == "work",
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut(),
            ) {
                SubActionList(
                    listOf(
                        SubAction(painterResource(R.drawable.hi_stream), "Stream a payment"),
                        SubAction(rememberVectorPainter(TaliseIcons.list), "My streams"),
                        SubAction(painterResource(R.drawable.hi_invoice), "Invoices"),
                        SubAction(painterResource(R.drawable.hi_contract), "Contracts"),
                    ),
                )
            }

            // ── Single-destination rows ──
            NavRow(painterResource(R.drawable.hi_cash), "Payroll", "Pay a team in one tap", onClick = { nav.navigate(Routes.PAYROLL) })
            NavRow(painterResource(R.drawable.hi_qr), "Request money", "Ask anyone with a link", onClick = {})
            NavRow(painterResource(R.drawable.hi_stream), "Rules", "Money that runs itself", onClick = {})
        }
    }
}

// MARK: - Building blocks (iOS ActionTile / GroupRow / NavRow / SubActionList)

@Composable
private fun SectionLabel(text: String, topPad: androidx.compose.ui.unit.Dp = 0.dp) {
    Text(
        text.uppercase(),
        style = TaliseType.mono(10.sp),
        letterSpacing = 2.0.sp,
        color = TaliseColors.fgDim,
        modifier = Modifier.padding(start = 2.dp, top = topPad),
    )
}

/** Soft mint squircle chip — iOS `IconChip`. */
@Composable
private fun IconChip(painter: Painter, side: androidx.compose.ui.unit.Dp = 42.dp, iconSize: androidx.compose.ui.unit.Dp = 20.dp) {
    Box(
        Modifier.size(side).background(TaliseColors.greenMint.copy(alpha = 0.12f), RoundedCornerShape(side * 0.32f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(painter, contentDescription = null, tint = TaliseColors.greenMint, modifier = Modifier.size(iconSize))
    }
}

/** One 132dp primary tile in the 2×2 grid. */
@Composable
private fun ActionTile(
    painter: Painter,
    title: String,
    caption: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    locked: Boolean = false,
) {
    val shape = RoundedCornerShape(24.dp)
    Column(
        modifier = modifier
            .height(132.dp)
            .background(TaliseColors.surface, shape)
            .border(1.dp, TaliseColors.line, shape)
            .clickable(enabled = !locked) { onClick() }
            .alpha(if (locked) 0.5f else 1f)
            .padding(18.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            IconChip(painter)
            Spacer(Modifier.weight(1f))
            if (locked) {
                Row(
                    Modifier.background(TaliseColors.surface2, CircleShape).padding(horizontal = 7.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(Icons.Filled.Lock, contentDescription = null, tint = TaliseColors.fgDim, modifier = Modifier.size(8.dp))
                    Text("SOON", style = TaliseType.mono(8.sp), letterSpacing = 1.sp, color = TaliseColors.fgDim)
                }
            }
        }
        Spacer(Modifier.weight(1f))
        Text(
            title,
            style = TaliseType.heading(16.sp, FontWeight.SemiBold),
            letterSpacing = (-0.3).sp,
            color = if (locked) TaliseColors.fgMuted else TaliseColors.fg,
        )
        Text(
            caption,
            style = TaliseType.body(12.5.sp, FontWeight.Light),
            color = TaliseColors.fgDim,
            maxLines = 1,
            modifier = Modifier.padding(top = 3.dp),
        )
    }
}

/** Slim full-width group header row — expands (chevron.down). */
@Composable
private fun GroupRow(painter: Painter, title: String, caption: String, isExpanded: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(24.dp)
    val rot by animateFloatAsState(if (isExpanded) 180f else 0f, label = "chev")
    Row(
        Modifier.fillMaxWidth().background(TaliseColors.surface, shape).border(1.dp, TaliseColors.line, shape)
            .clickable { onClick() }.padding(horizontal = 18.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconChip(painter)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.5.dp)) {
            Text(title, style = TaliseType.heading(16.sp, FontWeight.SemiBold), letterSpacing = (-0.3).sp, color = TaliseColors.fg)
            Text(caption, style = TaliseType.body(12.5.sp, FontWeight.Light), color = TaliseColors.fgMuted)
        }
        Icon(Icons.Filled.KeyboardArrowDown, contentDescription = null, tint = TaliseColors.fgDim, modifier = Modifier.size(18.dp).rotate(rot))
    }
}

/** Slim full-width row that navigates (chevron.right). */
@Composable
private fun NavRow(painter: Painter, title: String, caption: String, onClick: () -> Unit) {
    val shape = RoundedCornerShape(24.dp)
    Row(
        Modifier.fillMaxWidth().background(TaliseColors.surface, shape).border(1.dp, TaliseColors.line, shape)
            .clickable { onClick() }.padding(horizontal = 18.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconChip(painter)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.5.dp)) {
            Text(title, style = TaliseType.heading(16.sp, FontWeight.SemiBold), letterSpacing = (-0.3).sp, color = TaliseColors.fg)
            Text(caption, style = TaliseType.body(12.5.sp, FontWeight.Light), color = TaliseColors.fgMuted)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = TaliseColors.fgDim, modifier = Modifier.size(18.dp))
    }
}

private data class SubAction(val painter: Painter, val title: String)

/** The expanded rows of a group — one rounded container, hairline dividers. */
@Composable
private fun SubActionList(rows: List<SubAction>) {
    val shape = RoundedCornerShape(24.dp)
    Column(
        Modifier.fillMaxWidth().background(TaliseColors.surface.copy(alpha = 0.55f), shape)
            .border(1.dp, TaliseColors.line, shape).padding(vertical = 4.dp),
    ) {
        rows.forEachIndexed { i, row ->
            Row(
                Modifier.fillMaxWidth().clickable { }.padding(horizontal = 18.dp, vertical = 13.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                IconChip(row.painter, side = 34.dp, iconSize = 16.dp)
                Text(row.title, style = TaliseType.body(15.sp, FontWeight.Normal), color = TaliseColors.fg, modifier = Modifier.weight(1f))
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = TaliseColors.fgDim, modifier = Modifier.size(16.dp))
            }
            if (i < rows.size - 1) {
                Box(Modifier.fillMaxWidth().padding(start = 66.dp).height(1.dp).background(TaliseColors.fg.copy(alpha = 0.06f)))
            }
        }
    }
}
