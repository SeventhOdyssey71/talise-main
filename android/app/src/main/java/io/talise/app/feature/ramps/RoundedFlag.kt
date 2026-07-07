package io.talise.app.feature.ramps

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.R
import io.talise.app.ui.components.rampCard
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Rounded circular country flags for the ramps, ported 1:1 from iOS
 * `RoundedFlag.swift` (same vendored circle-flags set the web app uses,
 * bundled as `res/drawable-nodpi/flag_<cc>.png`).
 */

/** Drawable for an ISO alpha-2 code (or "EU"); null when the asset is missing. */
internal fun flagRes(code: String): Int? = when (code.lowercase()) {
    "ae" -> R.drawable.flag_ae
    "bd" -> R.drawable.flag_bd
    "ca" -> R.drawable.flag_ca
    "de" -> R.drawable.flag_de
    "dz" -> R.drawable.flag_dz
    "eg" -> R.drawable.flag_eg
    "eu" -> R.drawable.flag_eu
    "fr" -> R.drawable.flag_fr
    "gb" -> R.drawable.flag_gb
    "gh" -> R.drawable.flag_gh
    "id" -> R.drawable.flag_id
    "in" -> R.drawable.flag_in
    "jp" -> R.drawable.flag_jp
    "ke" -> R.drawable.flag_ke
    "ma" -> R.drawable.flag_ma
    "ng" -> R.drawable.flag_ng
    "ph" -> R.drawable.flag_ph
    "pk" -> R.drawable.flag_pk
    "sa" -> R.drawable.flag_sa
    "sg" -> R.drawable.flag_sg
    "us" -> R.drawable.flag_us
    "vn" -> R.drawable.flag_vn
    "za" -> R.drawable.flag_za
    else -> null
}

private fun desaturation(saturation: Float): ColorFilter =
    ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(saturation) })

/**
 * A circular country flag, the app's standard "rounded flag" across the ramps.
 * `code` is an ISO alpha-2 (or "EU"); a missing asset falls back to a neutral
 * disc so nothing breaks. Mirrors iOS `RoundedFlag`.
 */
@Composable
fun RoundedFlag(
    code: String,
    size: Dp = 40.dp,
    /** Dim the chip (used for unavailable / "soon" corridors). */
    dimmed: Boolean = false,
) {
    val res = flagRes(code)
    Box(
        Modifier
            .size(size)
            .clip(CircleShape)
            .background(TaliseColors.surface2, CircleShape) // fallback disc
            .border(1.dp, TaliseColors.line, CircleShape)
            .alpha(if (dimmed) 0.6f else 1f),
        contentAlignment = Alignment.Center,
    ) {
        if (res != null) {
            Image(
                painterResource(res),
                contentDescription = null,
                modifier = Modifier.size(size).clip(CircleShape),
                contentScale = ContentScale.Crop,
                colorFilter = if (dimmed) desaturation(0.2f) else null,
            )
        }
    }
}

/**
 * A small cluster of overlapped circular flags, the compact "coming soon"
 * treatment so a long tail of not-yet-live corridors reads as one quiet row
 * of country circles rather than a wall of disabled list items. `codes` are
 * ISO alpha-2 codes. Mirrors iOS `OverlappedFlags`.
 */
@Composable
fun OverlappedFlags(
    codes: List<String>,
    size: Dp = 32.dp,
    max: Int = 6,
) {
    Row {
        codes.take(max).forEachIndexed { index, cc ->
            Box(
                Modifier
                    .offset(x = -(size * 0.34f) * index)
                    .size(size)
                    .clip(CircleShape)
                    .background(TaliseColors.surface2, CircleShape)
                    .border(2.dp, TaliseColors.bg, CircleShape)
                    .alpha(0.7f),
                contentAlignment = Alignment.Center,
            ) {
                flagRes(cc)?.let { res ->
                    Image(
                        painterResource(res),
                        contentDescription = null,
                        modifier = Modifier.size(size).clip(CircleShape),
                        contentScale = ContentScale.Crop,
                        colorFilter = desaturation(0.25f),
                    )
                }
            }
        }
        if (codes.size > max) {
            Box(
                Modifier
                    .offset(x = -(size * 0.34f) * (max - 1) + 4.dp)
                    .size(size)
                    .clip(CircleShape)
                    .background(TaliseColors.surface2, CircleShape)
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

/**
 * One selectable corridor row: rounded flag + name + currency/rail subtitle,
 * a trailing chevron, and a clean tappable card. Disabled rows aren't built
 * here, "soon" corridors collapse into [OverlappedFlags] instead. Mirrors iOS
 * `CorridorRow`.
 */
@Composable
fun CorridorRow(
    corridor: RampCorridor,
    selected: Boolean = false,
) {
    val ring = if (selected) TaliseColors.greenMint.copy(alpha = 0.5f) else TaliseColors.line
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(TaliseColors.surface, RoundedCornerShape(20.dp))
            .border(1.dp, ring, RoundedCornerShape(20.dp))
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
                modifier = Modifier.size(13.dp),
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

/** iOS `messageCard(title:body:)` clone shared by the ramp flows. */
@Composable
internal fun RampMessageCard(title: String, body: String) {
    Column(
        Modifier.fillMaxWidth().rampCard().padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, style = TaliseType.heading(16.sp, FontWeight.SemiBold), color = TaliseColors.fg)
        Text(body, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted)
    }
}
