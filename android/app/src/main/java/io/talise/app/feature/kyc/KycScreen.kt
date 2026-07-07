package io.talise.app.feature.kyc

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.EaseOut
import androidx.compose.animation.core.tween
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseDimens
import io.talise.app.ui.theme.TaliseType

/**
 * Identity / onboarding verification, ported 1:1 from iOS `KYCView`.
 *
 * The final onboarding step after the Google account is verified: the user
 * picks a country and an account type (Personal / Business), then a solid mint
 * "Continue" CTA posts the choice (`/api/onboarding`), best-effort claims the
 * sponsored SuiNS handle (`/api/username/claim`), and hands back via [onClose]
 * so the session bootstraps into the app. Nigeria gets the optional
 * [OnboardingBankLink] step first (gated off until the bank add-flow is
 * ported, see [KycViewModel]).
 *
 * Layout matches iOS exactly: flat near-black canvas, a header block, a flat
 * country list card with hairline dividers + a trailing check on the selection,
 * two account-type tiles (selected = bright mint with dark ink), and the mint
 * Continue button.
 */
@Composable
fun KycScreen(onClose: () -> Unit) {
    val vm: KycViewModel = viewModel()
    val ui by vm.state.collectAsStateWithLifecycle()

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
                Eyebrow("Verify · 1 of 1")
                Text(
                    "Finish setting up\nyour account",
                    style = TaliseType.display(30.sp, FontWeight.Medium),
                    letterSpacing = (-0.8).sp,
                    lineHeight = 38.sp,
                    color = TaliseColors.fg,
                )
                Text(
                    "We verified your Google account. One last step: tell us where you'll be using Talise, and whether this is for you or your business.",
                    style = TaliseType.body(14.sp),
                    lineHeight = 20.sp,
                    color = TaliseColors.fgMuted,
                )
            }

            // Country picker, flat card with hairline dividers.
            Column(verticalArrangement = Arrangement.spacedBy(TaliseDimens.md)) {
                Eyebrow("Country")
                Column(
                    modifier = Modifier
                        .clip(RoundedCornerShape(TaliseDimens.radiusLg))
                        .background(TaliseColors.surface),
                ) {
                    countries.forEachIndexed { index, (code, name) ->
                        CountryRow(
                            name = name,
                            selected = ui.country == code,
                            onClick = { vm.selectCountry(code) },
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
                Eyebrow("Account type")
                Row(horizontalArrangement = Arrangement.spacedBy(TaliseDimens.md)) {
                    TypeTile(
                        title = "Personal",
                        sub = "Send, receive, earn",
                        selected = ui.accountType == AccountType.Personal,
                        onClick = { vm.selectAccountType(AccountType.Personal) },
                        modifier = Modifier.weight(1f),
                    )
                    TypeTile(
                        title = "Business",
                        sub = "Invoices, payroll",
                        selected = ui.accountType == AccountType.Business,
                        onClick = { vm.selectAccountType(AccountType.Business) },
                        modifier = Modifier.weight(1f),
                    )
                }
            }

            ui.error?.let {
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
                    .alpha(if (ui.submitting) 0.85f else 1f)
                    .clip(RoundedCornerShape(16.dp))
                    .background(TaliseColors.greenMint)
                    .clickable(enabled = !ui.submitting) { vm.submit(onFinished = onClose) },
                contentAlignment = Alignment.Center,
            ) {
                if (ui.submitting) {
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

        // Nigeria-only optional bank-link step (iOS fullScreenCover). On
        // continue/skip we run the handle claim + bootstrap that the non-NG
        // path runs inline.
        if (ui.showBankLink) {
            OnboardingBankLink(onContinue = { vm.continueFromBankLink(onFinished = onClose) })
        }
    }
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
 * Account-type tile. Selected = a flat brand-mint tile (dark ink on the bright
 * mint); unselected = a flat neutral surface. No gradient, no specular sheen.
 * Selection eases over 0.2s like the iOS `.animation(.easeOut(duration: 0.2))`.
 */
@Composable
private fun TypeTile(
    title: String,
    sub: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val fill by animateColorAsState(
        targetValue = if (selected) TaliseColors.greenMint else TaliseColors.surface,
        animationSpec = tween(durationMillis = 200, easing = EaseOut),
        label = "tileFill",
    )
    val ink: Color by animateColorAsState(
        targetValue = if (selected) TaliseColors.inkOnGreen else TaliseColors.fg,
        animationSpec = tween(durationMillis = 200, easing = EaseOut),
        label = "tileInk",
    )
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(TaliseDimens.radiusMd))
            .background(fill)
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
