package io.talise.app.feature.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay

/**
 * First frame the user ever sees — iOS `SplashView`. Pure black, Talise wordmark
 * centered. Auto-advances after 1.2s into the Welcome screen; the fade is driven by
 * the coordinator's top-level transition.
 */
@Composable
fun SplashView(onAdvance: () -> Unit) {
    LaunchedEffect(Unit) {
        delay(1_200)
        onAdvance()
    }
    Box(
        Modifier.fillMaxSize().background(TaliseColors.bg),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "Talise",
            style = TaliseType.heading(40.sp, FontWeight.Medium),
            letterSpacing = (-1.2).sp,
            color = TaliseColors.fg,
        )
    }
}
