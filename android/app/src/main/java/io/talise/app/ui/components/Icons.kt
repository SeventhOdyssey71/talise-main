package io.talise.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ReceiptLong
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.Wallet
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FormatListBulleted
import androidx.compose.material.icons.outlined.WorkOutline
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.talise.app.ui.theme.TaliseColors

/**
 * Logical icon names that mirror the iOS HugeIcons set (`hi.bank` … `hi.team`).
 * Backed by Material icons as stand-ins; swap each to the imported HugeIcons
 * vector drawable (res/drawable/ic_hi_*.xml) for a pixel-exact match later.
 */
object TaliseIcons {
    val bank = Icons.Filled.AccountBalance
    val briefcase = Icons.Outlined.WorkOutline
    val card = Icons.Outlined.CreditCard
    val cash = Icons.Filled.Payments
    val cheque = Icons.AutoMirrored.Filled.ReceiptLong
    val contract = Icons.Filled.Description
    val globe = Icons.Filled.Language
    val invoice = Icons.Filled.ReceiptLong
    val list = Icons.Outlined.FormatListBulleted
    val lock = Icons.Filled.Lock
    val qr = Icons.Filled.QrCode2
    val send = Icons.AutoMirrored.Outlined.Send
    val stream = Icons.Filled.Repeat
    val team = Icons.Filled.Groups
    val write = Icons.Outlined.Edit
    val wallet = Icons.Filled.Wallet
}

/** Template-tinted glyph — iOS `HugeIcon`. */
@Composable
fun HugeIcon(
    icon: ImageVector,
    modifier: Modifier = Modifier,
    size: Dp = 20.dp,
    tint: Color = TaliseColors.greenMint,
) {
    Icon(icon, contentDescription = null, tint = tint, modifier = modifier.size(size))
}

/** Squircle icon chip — iOS `IconChip` (tint@12% wash + tinted glyph, radius = side*0.32). */
@Composable
fun IconChip(
    icon: ImageVector,
    modifier: Modifier = Modifier,
    side: Dp = 42.dp,
    iconSize: Dp = 20.dp,
    tint: Color = TaliseColors.greenMint,
) {
    Box(
        modifier = modifier
            .size(side)
            .background(tint.copy(alpha = 0.12f), RoundedCornerShape(side * 0.32f)),
        contentAlignment = androidx.compose.ui.Alignment.Center,
    ) {
        HugeIcon(icon, size = iconSize, tint = tint)
    }
}
