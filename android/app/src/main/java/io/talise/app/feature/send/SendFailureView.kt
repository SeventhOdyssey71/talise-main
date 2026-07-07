package io.talise.app.feature.send

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PriorityHigh
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/**
 * Terminal failure step — iOS `SendFailureView`. Reached when the pipeline
 * throws, including server 4xx rejections and transport errors. The success
 * screen is gated on a non-empty digest; every other outcome routes here.
 */
@Composable
fun SendFailureView(
    draft: SendDraft,
    onTryAgain: () -> Unit,
    onDone: () -> Unit,
) {
    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        Spacer(Modifier.weight(1f))

        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            Box(
                Modifier.size(96.dp).background(TaliseColors.danger.copy(alpha = 0.15f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.PriorityHigh,
                    contentDescription = null,
                    tint = TaliseColors.danger,
                    modifier = Modifier.size(36.dp),
                )
            }

            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    "Send failed",
                    style = TaliseType.heading(34.sp, FontWeight.Medium),
                    letterSpacing = (-1).sp,
                    color = TaliseColors.fg,
                )
                Text(
                    "No funds moved. You can try again or close this.",
                    style = TaliseType.body(14.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 32.dp),
                )
            }

            val err = draft.errorMessage
            if (!err.isNullOrEmpty()) {
                Text(
                    err,
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 32.dp).padding(top = 4.dp),
                )
            }
        }

        Spacer(Modifier.weight(1f))

        Column(
            Modifier.padding(horizontal = 24.dp).padding(bottom = 18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            SolidCapsuleButton(title = "Try again", onClick = onTryAgain)
            GlassCapsuleButton(title = "Done", onClick = onDone)
        }
    }
}
