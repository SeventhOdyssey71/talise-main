package io.talise.app.feature.send

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
 * Step 4: in-flight — iOS `SendInProgressView`. We're already past confirm;
 * the pipeline fires from `SendFlow` and writes back to the draft when it
 * lands. This screen is purely a visual hold while that happens.
 *
 * "Done" is intentionally live even before completion — the chain
 * submission continues server-side either way.
 */
@Composable
fun SendInProgressView(
    draft: SendDraft,
    onDone: () -> Unit,
    /** Live stage text (private-send flows); null keeps the generic copy. */
    progress: String? = null,
) {
    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        Spacer(Modifier.weight(1f))

        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(28.dp),
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.padding(bottom = 8.dp),
            ) {
                AnimatedPaperPlane(size = 140.dp)
            }

            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    if (progress == null) "Sending…" else "Sending privately…",
                    style = TaliseType.heading(28.sp, FontWeight.Medium),
                    letterSpacing = (-0.5).sp,
                    color = TaliseColors.fg,
                )
                if (!progress.isNullOrEmpty()) {
                    Text(
                        progress,
                        style = TaliseType.body(14.sp, FontWeight.Light),
                        color = TaliseColors.fgMuted,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 32.dp),
                    )
                } else {
                    Text(
                        "Should take a moment. You can close this now, we'll keep going.",
                        style = TaliseType.body(14.sp, FontWeight.Light),
                        color = TaliseColors.fgMuted,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 32.dp),
                    )
                }
            }

            ShimmerBars()

            val err = draft.errorMessage
            if (err != null) {
                Text(
                    err,
                    style = TaliseType.body(12.sp, FontWeight.Light),
                    color = TaliseColors.danger,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 32.dp),
                )
            }
        }

        Spacer(Modifier.weight(1f))

        GlassCapsuleButton(
            title = "Done",
            onClick = onDone,
            modifier = Modifier.padding(horizontal = 24.dp).padding(bottom = 18.dp),
        )
    }
}
