package io.talise.app.ui.theme

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

/**
 * Typography helpers mirroring iOS `TaliseFont`. iOS uses SF Pro / SF Mono (system);
 * Android stands in with the platform sans + monospace. Swap to bundled Inter +
 * JetBrains Mono in `res/font` later for an exact match — only these helpers change.
 *
 * Usage mirrors SwiftUI: `TaliseType.display(42, FontWeight.SemiBold)`, etc.
 */
object TaliseType {
    private val sans = FontFamily.Default
    private val mono = FontFamily.Monospace

    fun display(size: TextUnit, weight: FontWeight = FontWeight.SemiBold) =
        TextStyle(fontFamily = sans, fontSize = size, fontWeight = weight)

    fun heading(size: TextUnit, weight: FontWeight = FontWeight.SemiBold) =
        TextStyle(fontFamily = sans, fontSize = size, fontWeight = weight)

    fun body(size: TextUnit = 14.sp, weight: FontWeight = FontWeight.Normal) =
        TextStyle(fontFamily = sans, fontSize = size, fontWeight = weight)

    fun mono(size: TextUnit = 11.sp, weight: FontWeight = FontWeight.Normal) =
        TextStyle(fontFamily = mono, fontSize = size, fontWeight = weight)
}
