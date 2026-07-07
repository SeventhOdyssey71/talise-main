package io.talise.app.feature.withdraw

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.R
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Shared visual pieces for the withdraw flow — ports of iOS `RoundedFlag`,
 * `OverlappedFlags`, `CorridorRow` (Ramps/RoundedFlag.swift), `BankAvatar`
 * (BankAccountsView.swift), `TaliseLoadingRing` + the flat `fieldSurface`
 * treatment (WithdrawFlowView.swift).
 */

// ── Flags ───────────────────────────────────────────────────────────────────

private val flagRes: Map<String, Int> = mapOf(
    "US" to R.drawable.flag_us,
    "GB" to R.drawable.flag_gb,
    "NG" to R.drawable.flag_ng,
    "KE" to R.drawable.flag_ke,
    "GH" to R.drawable.flag_gh,
    "ZA" to R.drawable.flag_za,
    "PH" to R.drawable.flag_ph,
    "IN" to R.drawable.flag_in,
    "ID" to R.drawable.flag_id,
    "VN" to R.drawable.flag_vn,
    "EG" to R.drawable.flag_eg,
    "EU" to R.drawable.flag_eu,
    "DE" to R.drawable.flag_de,
    "FR" to R.drawable.flag_fr,
    "CA" to R.drawable.flag_ca,
)

/** A circular country flag; a missing asset falls back to a neutral disc. */
@Composable
fun RoundedFlag(code: String, size: Dp = 40.dp, dimmed: Boolean = false) {
    val res = flagRes[code.uppercase()]
    Box(
        Modifier
            .size(size)
            .clip(CircleShape)
            .background(TaliseColors.surface2)
            .border(1.dp, TaliseColors.line, CircleShape)
            .alpha(if (dimmed) 0.6f else 1f),
        contentAlignment = Alignment.Center,
    ) {
        if (res != null) {
            Image(
                painterResource(res),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                colorFilter = if (dimmed) {
                    ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0.2f) })
                } else null,
                modifier = Modifier.fillMaxSize().clip(CircleShape),
            )
        }
    }
}

/** A small cluster of overlapped circular flags — the compact "coming soon" treatment. */
@Composable
fun OverlappedFlags(codes: List<String>, size: Dp = 32.dp, max: Int = 6) {
    val dimMatrix = ColorMatrix().apply { setToSaturation(0.25f) }
    Row(horizontalArrangement = Arrangement.spacedBy(-(size * 0.34f))) {
        codes.take(max).forEach { cc ->
            val res = flagRes[cc.uppercase()]
            Box(
                Modifier
                    .size(size)
                    .clip(CircleShape)
                    .background(TaliseColors.surface2)
                    .border(2.dp, TaliseColors.bg, CircleShape)
                    .alpha(0.7f),
                contentAlignment = Alignment.Center,
            ) {
                if (res != null) {
                    Image(
                        painterResource(res),
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        colorFilter = ColorFilter.colorMatrix(dimMatrix),
                        modifier = Modifier.fillMaxSize().clip(CircleShape),
                    )
                }
            }
        }
        if (codes.size > max) {
            Box(
                Modifier
                    .padding(start = size * 0.34f + 4.dp)
                    .size(size)
                    .clip(CircleShape)
                    .background(TaliseColors.surface2)
                    .border(2.dp, TaliseColors.bg, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "+${codes.size - max}",
                    style = TaliseType.mono(11.sp, FontWeight.Medium),
                    color = TaliseColors.fgDim,
                )
            }
        }
    }
}

/** One selectable corridor row: rounded flag + name + currency pill + rail subtitle. */
@Composable
fun CorridorRow(corridor: RampCorridor, selected: Boolean = false) {
    val shape = RoundedCornerShape(20.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .background(TaliseColors.surface, shape)
            .border(
                1.dp,
                if (selected) TaliseColors.greenMint.copy(alpha = 0.5f) else TaliseColors.line,
                shape,
            )
            .padding(horizontal = 18.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        RoundedFlag(code = corridor.code, size = 40.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.5.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                Text(
                    corridor.name,
                    style = TaliseType.heading(16.sp, FontWeight.SemiBold),
                    letterSpacing = (-0.3).sp,
                    color = TaliseColors.fg,
                )
                Text(
                    corridor.currencyCode,
                    style = TaliseType.mono(10.sp),
                    letterSpacing = 0.6.sp,
                    color = TaliseColors.fgDim,
                    modifier = Modifier
                        .background(TaliseColors.surface2, CircleShape)
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }
            Text(
                corridor.railLabel,
                style = TaliseType.body(12.5.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
            )
        }
        if (selected) {
            Icon(
                Icons.Filled.Check,
                contentDescription = null,
                tint = TaliseColors.greenMint,
                modifier = Modifier.size(15.dp),
            )
        } else {
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = TaliseColors.fgDim,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}

// ── Bank avatar ─────────────────────────────────────────────────────────────

/** Bank brand logos we ship (mirrors iOS `BankBranding.logoCodes`). */
private val bankLogoRes: Map<String, Int> = mapOf(
    "011" to R.drawable.bank_011,
    "033" to R.drawable.bank_033,
    "035" to R.drawable.bank_035,
    "039" to R.drawable.bank_039,
    "044" to R.drawable.bank_044,
    "050" to R.drawable.bank_050,
    "057" to R.drawable.bank_057,
    "058" to R.drawable.bank_058,
    "070" to R.drawable.bank_070,
    "214" to R.drawable.bank_214,
    "215" to R.drawable.bank_215,
    "232" to R.drawable.bank_232,
    "301" to R.drawable.bank_301,
    "100004" to R.drawable.bank_100004,
    "100033" to R.drawable.bank_100033,
    "090405" to R.drawable.bank_090405,
    "090267" to R.drawable.bank_090267,
)

/**
 * A bank's brand logo when we have one, else a letter fallback — square
 * rounded tile, iOS `BankAvatar`. Brand marks sit on a clean white tile.
 */
@Composable
fun BankAvatar(bankCode: String, bankName: String, size: Dp = 40.dp, cornerRadius: Dp = 11.dp) {
    val shape = RoundedCornerShape(cornerRadius)
    val res = bankLogoRes[bankCode]
    if (res != null) {
        Box(
            Modifier
                .size(size)
                .clip(shape)
                .background(Color.White)
                .border(1.dp, TaliseColors.line, shape),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                painterResource(res),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize().padding(size * 0.16f),
            )
        }
    } else {
        Box(
            Modifier.size(size).clip(shape).background(TaliseColors.accentSoft),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                bankName.take(1).uppercase(),
                style = TaliseType.heading((size.value * 0.4f).sp, FontWeight.Medium),
                color = TaliseColors.accent,
            )
        }
    }
}

// ── Loading ring ────────────────────────────────────────────────────────────

/**
 * Clean, brand-mint loading ring — a comet-tail arc that fades from transparent
 * into solid mint and spins smoothly. iOS `TaliseLoadingRing`.
 */
@Composable
fun TaliseLoadingRing(size: Dp = 64.dp, lineWidth: Dp = 3.5.dp, color: Color = TaliseColors.greenMint) {
    val transition = rememberInfiniteTransition(label = "ring")
    val angle by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(durationMillis = 1000, easing = LinearEasing)),
        label = "angle",
    )
    val track = TaliseColors.fg.copy(alpha = 0.08f)
    Canvas(Modifier.size(size).rotate(angle)) {
        val strokePx = lineWidth.toPx()
        val stroke = Stroke(width = strokePx, cap = StrokeCap.Round)
        val inset = strokePx / 2f
        val arcSize = androidx.compose.ui.geometry.Size(this.size.width - strokePx, this.size.height - strokePx)
        val topLeft = androidx.compose.ui.geometry.Offset(inset, inset)
        // Faint full-circle track.
        drawArc(color = track, startAngle = 0f, sweepAngle = 360f, useCenter = false, style = stroke, topLeft = topLeft, size = arcSize)
        // Comet-tail arc: angular gradient clear → solid, trimmed to 92%.
        drawArc(
            brush = Brush.sweepGradient(0f to color.copy(alpha = 0f), 0.92f to color, 1f to color),
            startAngle = 0f,
            sweepAngle = 331f,
            useCenter = false,
            style = stroke,
            topLeft = topLeft,
            size = arcSize,
        )
    }
}

// ── Field surface ───────────────────────────────────────────────────────────

/**
 * Flat input-field surface: solid `surface` plate, 1px `line` hairline —
 * iOS `FieldSurface`.
 */
fun Modifier.fieldSurface(cornerRadius: Dp = 16.dp): Modifier {
    val shape = RoundedCornerShape(cornerRadius)
    return this
        .clip(shape)
        .background(TaliseColors.surface, shape)
        .border(1.dp, TaliseColors.line, shape)
}
