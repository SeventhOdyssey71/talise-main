package io.talise.app.feature.onboarding

import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Photo
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.components.LiquidGlassButton
import io.talise.app.ui.components.MicroLabel
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.launch

/**
 * Three-slide swipeable brand-intro carousel, iOS `BrandIntroCarousel`. Each slide shows a
 * hero illustration slot (the Higgsfield exports drop in later; until then a flat glass
 * placeholder card keeps the layout stable) plus a punchy one-liner. "Continue" advances
 * through the slides and calls [onContinue] once past the third.
 */
@Composable
fun BrandIntroCarousel(onContinue: () -> Unit, modifier: Modifier = Modifier) {
    // iOS copy verbatim (em dashes dropped per copy rules; "Face ID" reads
    // "biometrics" on Android hardware).
    val headlines = listOf(
        "Sub-second sends. Sign with biometrics, never see a seed phrase.",
        "A payment that does more. Pay, save, and earn in one tap.",
        "Cash in, cash out. Stripe in, mobile money out, all in one app.",
    )
    val pagerState = rememberPagerState(pageCount = { headlines.size })
    val scope = rememberCoroutineScope()

    Box(modifier.fillMaxSize().background(TaliseColors.bg)) {
        Column(Modifier.fillMaxSize()) {
            HorizontalPager(
                state = pagerState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
            ) { page ->
                Slide(headline = headlines[page])
            }

            // Dot indicators, active dot tracks both swipes and the Continue button.
            Row(
                Modifier.fillMaxWidth().padding(bottom = 24.dp),
                horizontalArrangement = Arrangement.Center,
            ) {
                headlines.indices.forEach { i ->
                    Box(
                        Modifier
                            .padding(horizontal = 4.dp)
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(if (i == pagerState.currentPage) TaliseColors.fg else TaliseColors.fgDim)
                    )
                }
            }

            LiquidGlassButton(
                title = "Continue",
                onClick = {
                    val idx = pagerState.currentPage
                    if (idx < headlines.lastIndex) {
                        // iOS advances with an easeInOut 0.28s slide.
                        scope.launch {
                            pagerState.animateScrollToPage(
                                page = idx + 1,
                                animationSpec = tween(durationMillis = 280),
                            )
                        }
                    } else {
                        onContinue()
                    }
                },
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 0.dp),
            )
            Spacer(Modifier.height(32.dp))
        }
    }
}

@Composable
private fun Slide(headline: String) {
    Column(
        Modifier.fillMaxSize().padding(top = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(32.dp),
    ) {
        // Hero illustration slot, flat glass placeholder until the real PNG lands.
        Box(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 32.dp)
                .height(320.dp)
                .clip(RoundedCornerShape(28.dp))
                .background(TaliseColors.surface)
                .border(1.dp, TaliseColors.line, RoundedCornerShape(28.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    imageVector = Icons.Outlined.Photo,
                    contentDescription = null,
                    tint = TaliseColors.fgDim,
                    modifier = Modifier.size(28.dp),
                )
                MicroLabel(text = "ILLUSTRATION COMING", color = TaliseColors.fgDim)
            }
        }

        Text(
            headline,
            style = TaliseType.heading(24.sp, FontWeight.Medium),
            letterSpacing = (-0.6).sp,
            color = TaliseColors.fg,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 32.dp),
        )
    }
}
