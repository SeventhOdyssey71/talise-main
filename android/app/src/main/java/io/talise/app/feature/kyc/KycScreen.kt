package io.talise.app.feature.kyc

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseDimens
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Identity / onboarding verification, ported 1:1 from iOS `KYCView`.
 *
 * The iOS screen is the final onboarding step after the Google account is verified:
 * the user picks a country and an account type (Personal / Business), then a solid
 * mint "Continue" CTA posts the choice and bootstraps into the app. Nigeria gets an
 * optional Naira bank-link step on iOS; Android has no such endpoint wired yet, so
 * every country continues straight through via [onClose].
 *
 * Layout matches iOS exactly: flat near-black canvas, a header block, a flat country
 * list card with hairline dividers + a trailing check on the selection, two account-type
 * tiles (selected = bright mint with dark ink), and the mint Continue button.
 */
@Composable
fun KycScreen(onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var country by remember { mutableStateOf("NG") }
    var accountType by remember { mutableStateOf(AccountType.Personal) }
    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val countries = listOf(
        "NG" to "Nigeria",
        "US" to "United States",
        "GB" to "United Kingdom",
        "OTHER" to "Other",
    )

    Box(
        Modifier
            .fillMaxSize()
            .background(TaliseColors.bg),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(TaliseDimens.xl),
            verticalArrangement = Arrangement.spacedBy(TaliseDimens.xxl),
        ) {
            // Header block.
            Column(verticalArrangement = Arrangement.spacedBy(TaliseDimens.md)) {
                Eyebrow("Verify · 1 of 1", color = TaliseColors.fgDim)
                Text(
                    "Finish setting up\nyour account",
                    style = TaliseType.display(30.sp, FontWeight.Medium),
                    letterSpacing = (-0.8).sp,
                    color = TaliseColors.fg,
                )
                Text(
                    "We verified your Google account. One last step: tell us where you'll be using Talise, and whether this is for you or your business.",
                    style = TaliseType.body(14.sp),
                    color = TaliseColors.fgMuted,
                )
            }

            // Country picker, flat card with hairline dividers.
            Column(verticalArrangement = Arrangement.spacedBy(TaliseDimens.md)) {
                Eyebrow("Country", color = TaliseColors.fgDim)
                Column(
                    modifier = Modifier
                        .clip(RoundedCornerShape(TaliseDimens.radiusLg))
                        .background(TaliseColors.surface),
                ) {
                    countries.forEachIndexed { index, (code, name) ->
                        CountryRow(
                            name = name,
                            selected = country == code,
                            onClick = { country = code },
                        )
                        if (index != countries.lastIndex) {
                            Box(
                                Modifier
                                    .fillMaxWidth()
                                    .height(1.dp)
                                    .background(TaliseColors.line),
                            )
                        }
                    }
                }
            }

            // Account type, two flat tiles.
            Column(verticalArrangement = Arrangement.spacedBy(TaliseDimens.md)) {
                Eyebrow("Account type", color = TaliseColors.fgDim)
                Row(horizontalArrangement = Arrangement.spacedBy(TaliseDimens.md)) {
                    TypeTile(
                        title = "Personal",
                        sub = "Send, receive, earn",
                        selected = accountType == AccountType.Personal,
                        onClick = { accountType = AccountType.Personal },
                        modifier = Modifier.weight(1f),
                    )
                    TypeTile(
                        title = "Business",
                        sub = "Invoices, payroll",
                        selected = accountType == AccountType.Business,
                        onClick = { accountType = AccountType.Business },
                        modifier = Modifier.weight(1f),
                    )
                }
            }

            error?.let {
                Text(
                    it,
                    style = TaliseType.body(12.sp),
                    color = TaliseColors.danger,
                )
            }

            // Flat solid primary CTA, mint fill, dark ink, no glass.
            Box(
                modifier = Modifier
                    .padding(top = TaliseDimens.sm)
                    .fillMaxWidth()
                    .height(54.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(
                        if (submitting) TaliseColors.greenMint.copy(alpha = 0.85f)
                        else TaliseColors.greenMint,
                    )
                    .clickable(enabled = !submitting) {
                        error = null
                        submitting = true
                        scope.launch {
                            // No /api/onboarding endpoint on Android yet; the choice is
                            // captured locally and we bootstrap straight through, matching
                            // the non-Nigeria iOS path. Brief spinner for parity.
                            delay(400)
                            submitting = false
                            onClose()
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                if (submitting) {
                    CircularProgressIndicator(
                        color = TaliseColors.inkOnGreen,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(18.dp),
                    )
                } else {
                    Text(
                        "Continue",
                        style = TaliseType.heading(16.sp, FontWeight.Medium),
                        color = TaliseColors.inkOnGreen,
                    )
                }
            }
        }
    }
}

/** Personal vs. business, iOS `AccountType`. */
private enum class AccountType(val raw: String) {
    Personal("personal"),
    Business("business"),
}

/** A single country row, name + trailing check when selected. */
@Composable
private fun CountryRow(
    name: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(horizontal = TaliseDimens.lg, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            name,
            style = TaliseType.body(14.sp),
            color = TaliseColors.fg,
            modifier = Modifier.weight(1f),
        )
        if (selected) {
            Icon(
                imageVector = Icons.Filled.Check,
                contentDescription = null,
                tint = TaliseColors.fg,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}

/**
 * Account-type tile. Selected = a flat brand-mint tile (dark ink on the bright mint);
 * unselected = a flat neutral surface. No gradient, no specular sheen.
 */
@Composable
private fun TypeTile(
    title: String,
    sub: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val ink: Color = if (selected) TaliseColors.inkOnGreen else TaliseColors.fg
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(TaliseDimens.radiusMd))
            .background(if (selected) TaliseColors.greenMint else TaliseColors.surface)
            .clickable { onClick() }
            .padding(TaliseDimens.lg),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            title,
            style = TaliseType.heading(15.sp),
            color = ink,
        )
        Text(
            sub,
            style = TaliseType.body(12.sp),
            color = if (selected) ink.copy(alpha = 0.66f) else TaliseColors.fgMuted,
        )
    }
}
