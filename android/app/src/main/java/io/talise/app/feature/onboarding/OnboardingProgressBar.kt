package io.talise.app.feature.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import io.talise.app.ui.theme.TaliseColors

/**
 * Segmented progress bar shown at the top of every multi-step onboarding screen after
 * Welcome — iOS `OnboardingProgressBar`. Four (or [totalSteps]) thin pills separated by
 * 6dp gaps; the first [currentStep] pills fill with `fg`, the rest read as light-grey
 * hairlines at white 18%. Sits with 24dp horizontal padding and 12dp below the status bar.
 */
@Composable
fun OnboardingProgressBar(totalSteps: Int, currentStep: Int, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(horizontal = 24.dp)
            .padding(top = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        repeat(totalSteps) { idx ->
            Box(
                Modifier
                    .weight(1f)
                    .height(3.dp)
                    .clip(RoundedCornerShape(1.5.dp))
                    .background(
                        if (idx < currentStep) TaliseColors.fg
                        else Color.White.copy(alpha = 0.18f)
                    )
            )
        }
    }
}
