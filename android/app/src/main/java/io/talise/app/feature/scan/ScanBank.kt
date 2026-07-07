package io.talise.app.feature.scan

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
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
 * Bank list + OCR extraction for the scan-to-bank path, ported 1:1 from iOS
 * `ScanBankPayout.swift` (`ScanBank` + `BankAccountExtractor`), plus the local
 * `BankAvatar` tile (iOS BankAccountsView.swift) backed by the bundled
 * res/drawable bank marks.
 */

// MARK: - Bank list

/**
 * One Nigerian bank: display [name], the plain NIBSS [code] Linq accepts
 * directly, and [aliases], lowercased keywords we keyword-match against
 * OCR'd placard text (brand names, common abbreviations).
 */
data class ScanBank(
    val name: String,
    val code: String,
    val aliases: List<String>,
) {
    val id: String get() = code

    companion object {
        /**
         * The full bank list, mirrors iOS `ScanBank.all` (BankWithdrawView's NIBSS
         * codes extended with OCR keyword aliases). Order roughly by ubiquity so
         * the picker reads sensibly.
         */
        val all: List<ScanBank> = listOf(
            ScanBank("OPay", "100004", listOf("opay")),
            ScanBank("PalmPay", "100033", listOf("palmpay", "palm pay")),
            ScanBank("Moniepoint", "090405", listOf("moniepoint", "monie point", "moniepoint mfb")),
            ScanBank("Kuda", "090267", listOf("kuda", "kuda mfb", "kuda bank")),
            ScanBank("Guaranty Trust Bank", "058", listOf("gtbank", "gtb", "guaranty trust", "gt bank", "guaranty")),
            ScanBank("Access Bank", "044", listOf("access bank", "access")),
            ScanBank("First Bank of Nigeria", "011", listOf("first bank", "firstbank", "fbn")),
            ScanBank("Zenith Bank", "057", listOf("zenith bank", "zenith")),
            ScanBank("United Bank For Africa", "033", listOf("uba", "united bank for africa", "united bank")),
            ScanBank("Wema Bank", "035", listOf("wema bank", "wema", "alat", "alat by wema")),
            ScanBank("Sterling Bank", "232", listOf("sterling bank", "sterling")),
            ScanBank("Fidelity Bank", "070", listOf("fidelity bank", "fidelity")),
            ScanBank("First City Monument Bank", "214", listOf("fcmb", "first city monument")),
            ScanBank("Stanbic IBTC Bank", "039", listOf("stanbic", "stanbic ibtc", "ibtc")),
        )

        fun byCode(code: String): ScanBank? = all.firstOrNull { it.code == code }
    }
}

// MARK: - OCR extraction

/**
 * Stateless helper that pulls a `{bankCode, accountNumber}` candidate out of
 * a single frame's recognized strings. The caller ([ScanViewModel]) holds the
 * debounce state and only locks once the same pair has been seen on enough
 * consecutive frames.
 */
object BankAccountExtractor {
    data class Candidate(
        val bank: ScanBank,
        /** Exactly 10 digits. */
        val accountNumber: String,
    )

    /**
     * Joins the frame's strings, then:
     *   - finds the first standalone 10-digit run (NUBAN), tolerating spaces
     *     between digit groups that OCR sometimes inserts;
     *   - keyword-matches the text against the bank aliases.
     * Returns a candidate only when BOTH are present.
     */
    fun extract(strings: List<String>): Candidate? {
        val joined = strings.joinToString(" ")
        val account = firstTenDigitAccount(joined) ?: return null
        val bank = matchBank(joined) ?: return null
        return Candidate(bank = bank, accountNumber = account)
    }

    /**
     * First isolated 10-digit number. We strip spaces/dashes that OCR drops
     * between digit groups, then scan for a run of exactly 10 digits that
     * isn't part of a longer number (so a phone/serial of 11+ doesn't match).
     */
    fun firstTenDigitAccount(text: String): String? {
        val chars = text.toCharArray()
        var i = 0
        while (i < chars.size) {
            if (!chars[i].isDigit()) {
                i += 1
                continue
            }
            // Walk a digit run, allowing single spaces/dashes between digits.
            val digits = StringBuilder()
            var j = i
            while (j < chars.size) {
                val c = chars[j]
                if (c.isDigit()) {
                    digits.append(c)
                    j += 1
                } else if ((c == ' ' || c == '-') && j + 1 < chars.size && chars[j + 1].isDigit() && digits.isNotEmpty()) {
                    // Separator inside a number, skip it and keep accumulating.
                    j += 1
                } else {
                    break
                }
            }
            if (digits.length == 10) return digits.toString()
            i = j
        }
        return null
    }

    /**
     * Keyword-match the OCR text against the bank aliases. Longer aliases win
     * (so "gt bank" beats a stray "gt").
     */
    fun matchBank(text: String): ScanBank? {
        val hay = text.lowercase()
        var best: Pair<ScanBank, Int>? = null
        for (bank in ScanBank.all) {
            for (alias in bank.aliases) {
                if (!hay.contains(alias)) continue
                val len = alias.length
                if (best == null || len > best!!.second) {
                    best = bank to len
                }
            }
        }
        return best?.first
    }
}

// MARK: - Bank branding (logos + avatar)

/**
 * Bank codes we ship a brand logo drawable for; mirrors iOS `BankBranding`.
 * Everything else falls back to a letter tile.
 */
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
    // Fintechs / MFBs (raster brand marks)
    "100004" to R.drawable.bank_100004, // OPay
    "100033" to R.drawable.bank_100033, // PalmPay
    "090405" to R.drawable.bank_090405, // Moniepoint
    "090267" to R.drawable.bank_090267, // Kuda
)

/**
 * A bank's brand logo when we have one, else a letter-circle fallback.
 * Square rounded tile, iOS `BankAvatar`. Brand marks are designed for light
 * backgrounds, so they sit on a clean white tile (Apple-Wallet style).
 */
@Composable
fun ScanBankAvatar(
    bankCode: String,
    bankName: String,
    size: Dp = 40.dp,
    cornerRadius: Dp = 11.dp,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(cornerRadius)
    val res = bankLogoRes[bankCode]
    if (res != null) {
        Box(
            modifier = modifier
                .size(size)
                .clip(shape)
                .background(Color.White)
                .border(1.dp, TaliseColors.line, shape),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                painter = painterResource(res),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(size * 0.16f),
            )
        }
    } else {
        Box(
            modifier = modifier
                .size(size)
                .clip(shape)
                .background(TaliseColors.accentSoft),
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
