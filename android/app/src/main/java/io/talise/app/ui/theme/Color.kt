package io.talise.app.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Talise color palette — ported 1:1 from the iOS `TaliseColor` (Figma node 42-1819).
 * Dark-mode only; every value is an absolute hex (no light/dark variants).
 */
object TaliseColors {
    // Core surfaces
    val bg = Color(0xFF000000)
    val surface = Color(0xFF161616)
    val surface2 = Color(0xFF242424)
    val surfaceGlass = Color(0xFF1C1C1C)
    val surfaceGlassStrong = Color(0xFF2C2C2C)

    // Text / foreground
    val fg = Color(0xFFFFFFFF)
    val fgSubtle = Color(0xFFFAFAFA)
    val fgMuted = Color(0xFFB5B5B5)
    val fgDim = Color(0xFF636363)
    val line = Color(0x14FFFFFF) // white @ 8%

    // Brand greens
    val accent = Color(0xFF79D96C)     // bright green — live / success / "earn up to 11%"
    val greenMint = Color(0xFFCAFFB8)  // mint accent — button labels on dark
    val greenDeep = Color(0xFF4B8A37)  // forest — solid CTA fill

    // Accents
    val warmGold = Color(0xFFC08A3E)
    val danger = Color(0xFFA05A3E)

    // Activity badges (semi-transparent muted tones)
    val badgeSent = Color(0x806C3A38)      // muted red @ 50%
    val badgeReceived = Color(0x80355F40)  // muted green @ 50%
    val badgeNeutral = Color(0x994A4A4A)   // grey @ 60%

    // Bright/red helpers used by activity rows
    val sentRed = Color(0xFFE5484D)
    val sentRedSoft = Color(0xFFFF6B6B)
    val receivedGreen = Color(0xFF79D96C)

    // Button label inks
    val inkOnGreen = Color(0xFF0A140C)     // dark ink on bright-green CTAs
    val labelOnDeep = Color(0xFFF2FFEC)    // near-white on forest CTA

    // Exact-match additions from iOS Tokens.swift.
    val accentSoft = Color(0xFF2A2A2A)
    val usernameCard = Color(0xFF161616)
    val live = Color(0xFF79D96C)
    val success = Color(0xFF79D96C)
    val warmGoldAlt = Color(0xFFC08A3E)
}
