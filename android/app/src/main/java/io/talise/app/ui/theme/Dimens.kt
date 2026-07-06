package io.talise.app.ui.theme

import androidx.compose.ui.unit.dp

/**
 * Layout tokens — ported 1:1 from iOS `Tokens.swift` (TaliseSpacing / TaliseRadius
 * / TaliseHeight) so spacing, corner radii, and button heights match the app.
 */
object TaliseDimens {
    // Spacing
    val xs = 4.dp
    val sm = 8.dp
    val md = 12.dp
    val lg = 16.dp
    val xl = 24.dp
    val xxl = 32.dp
    val xxxl = 48.dp

    // Corner radii
    val radiusSm = 10.dp
    val radiusMd = 14.dp
    val radiusLg = 20.dp
    val radiusXl = 25.dp   // big cards (activity + username)
    val radiusPill = 40.dp // bottom nav + active pill

    // Button heights
    val buttonSm = 32.dp
    val buttonMd = 40.dp
    val buttonLg = 44.dp
}
