package io.talise.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseSize
import io.talise.app.ui.theme.TaliseType

/**
 * Primary CTA — iOS `LiquidGlassButton`. A solid tint fill (default accent) with a
 * dark ink label on bright greens. `tint = null` → secondary (surface2 + hairline).
 */
@Composable
fun LiquidGlassButton(
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color? = TaliseColors.accent,
    enabled: Boolean = true,
    loading: Boolean = false,
    fullWidth: Boolean = true,
) {
    val brightGreens = setOf(TaliseColors.accent, TaliseColors.greenMint)
    val label = when {
        tint == null -> TaliseColors.fg
        tint in brightGreens -> TaliseColors.inkOnGreen
        else -> TaliseColors.fg
    }
    Button(
        onClick = { if (!loading) onClick() },
        enabled = enabled && !loading,
        shape = RoundedCornerShape(TaliseRadiusSm),
        colors = ButtonDefaults.buttonColors(
            containerColor = tint ?: TaliseColors.surface2,
            contentColor = label,
            disabledContainerColor = (tint ?: TaliseColors.surface2).copy(alpha = 0.5f),
            disabledContentColor = label.copy(alpha = 0.6f),
        ),
        border = if (tint == null) BorderStroke(1.dp, TaliseColors.line) else null,
        modifier = modifier
            .then(if (fullWidth) Modifier.fillMaxWidth() else Modifier)
            .height(TaliseSize.buttonLg),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (loading) {
                CircularProgressIndicator(color = label, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
            }
            Text(title, style = TaliseType.heading(16.sp, FontWeight.Medium))
        }
    }
}

private val TaliseRadiusSm = 10.dp

/** Small capsule CTA — iOS `LiquidGlassPill` ("Copy", "Suiscan", …). */
@Composable
fun LiquidGlassPill(
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color? = null,
) {
    Button(
        onClick = onClick,
        shape = CircleShape,
        colors = ButtonDefaults.buttonColors(
            containerColor = tint?.copy(alpha = 0.18f) ?: TaliseColors.surface2,
            contentColor = TaliseColors.fg,
        ),
        border = BorderStroke(1.dp, TaliseColors.line),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp, vertical = 0.dp),
        modifier = modifier.height(30.dp),
    ) {
        Text(title, style = TaliseType.body(12.sp, FontWeight.Medium))
    }
}
