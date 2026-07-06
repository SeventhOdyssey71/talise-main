package io.talise.app.ui.theme

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import io.talise.app.R

/**
 * Typography — the Android match for iOS `TaliseFont`.
 *
 * iOS renders the UI in Apple's system font (SF Pro) for display/heading/body
 * and SF Mono for the micro labels. SF Pro can't be licensed on Android, so we
 * bundle **Inter** — the canonical, metrics-compatible SF Pro substitute — and
 * **JetBrains Mono** for the mono eyebrows/timestamps. Same call surface as iOS
 * (`display/heading/body/mono` with size + weight), so screens read identically.
 */
object TaliseType {
    private val sans = FontFamily(
        Font(R.font.inter_regular, FontWeight.Normal),
        Font(R.font.inter_medium, FontWeight.Medium),
        Font(R.font.inter_semibold, FontWeight.SemiBold),
        Font(R.font.inter_bold, FontWeight.Bold),
    )
    private val mono = FontFamily(
        Font(R.font.jetbrainsmono_regular, FontWeight.Normal),
        Font(R.font.jetbrainsmono_medium, FontWeight.Medium),
    )

    /** SF Pro / Inter — primary display face (big balances, headings). */
    fun display(size: TextUnit, weight: FontWeight = FontWeight.SemiBold) =
        TextStyle(fontFamily = sans, fontSize = size, fontWeight = weight)

    fun heading(size: TextUnit, weight: FontWeight = FontWeight.SemiBold) =
        TextStyle(fontFamily = sans, fontSize = size, fontWeight = weight)

    fun body(size: TextUnit = 14.sp, weight: FontWeight = FontWeight.Normal) =
        TextStyle(fontFamily = sans, fontSize = size, fontWeight = weight)

    /** SF Mono / JetBrains Mono — small tracked labels, timestamps, eyebrows. */
    fun mono(size: TextUnit = 11.sp, weight: FontWeight = FontWeight.Normal) =
        TextStyle(fontFamily = mono, fontSize = size, fontWeight = weight)

    /** The bundled Inter family, for Material theming / direct use. */
    val sansFamily: FontFamily get() = sans
    val monoFamily: FontFamily get() = mono
}
