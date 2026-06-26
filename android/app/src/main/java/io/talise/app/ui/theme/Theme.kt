package io.talise.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * App theme. Talise is dark-only: we hand Material3 a dark scheme built from the
 * Talise palette so any stray Material component still reads on-brand, but app
 * code should reference [TaliseColors] / [TaliseType] directly (as the iOS app
 * references TaliseColor/TaliseFont) rather than MaterialTheme.
 */
private val TaliseColorScheme = darkColorScheme(
    primary = TaliseColors.accent,
    onPrimary = TaliseColors.inkOnGreen,
    secondary = TaliseColors.greenMint,
    background = TaliseColors.bg,
    onBackground = TaliseColors.fg,
    surface = TaliseColors.surface,
    onSurface = TaliseColors.fg,
    surfaceVariant = TaliseColors.surface2,
    onSurfaceVariant = TaliseColors.fgMuted,
    error = TaliseColors.danger,
    outline = Color(0x14FFFFFF),
)

@Composable
fun TaliseTheme(content: @Composable () -> Unit) {
    @Suppress("UNUSED_EXPRESSION") isSystemInDarkTheme() // always dark regardless
    MaterialTheme(colorScheme = TaliseColorScheme, content = content)
}
