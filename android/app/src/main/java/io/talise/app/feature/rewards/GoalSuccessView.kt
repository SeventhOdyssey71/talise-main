package io.talise.app.feature.rewards

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.R
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType

/** Which flow the success screen confirms — iOS `GoalSuccessView.Kind`. */
enum class GoalSuccessKind { Deposit, Withdraw }

/**
 * Full-screen success confirmation shown after adding to (or withdrawing
 * from) a savings goal — iOS `GoalSuccessView`. Shared green-on-black look:
 * the target hero drops in with the scrapbook wobble, a display headline,
 * one quiet mono sub-line, and the white "Back to Invest" pill.
 *
 * `amountText` is pre-formatted by the caller (e.g. "$25.00").
 */
@Composable
fun GoalSuccessView(
    amountText: String,
    goalName: String,
    onDismiss: () -> Unit,
    kind: GoalSuccessKind = GoalSuccessKind.Deposit,
) {
    val headline = if (kind == GoalSuccessKind.Deposit) "Getting closer to your target" else "Back in your balance"
    val subline = if (kind == GoalSuccessKind.Deposit) {
        "$amountText added to $goalName."
    } else {
        "$amountText withdrawn from $goalName."
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(TaliseColors.bg),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))

        // Target hero — the hand-drawn crosshair illustration, dropping in
        // with the same scrapbook wobble as the savings piggy.
        Image(
            painter = painterResource(R.drawable.goaltarget),
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .size(260.dp)
                .scrapbookEntry(delayMillis = 50, tilt = -6f),
        )

        Spacer(Modifier.height(30.dp))

        Text(
            headline,
            style = TaliseType.display(38.sp, FontWeight.Normal),
            letterSpacing = (-0.8).sp,
            color = TaliseColors.fg,
            textAlign = TextAlign.Center,
            maxLines = 2,
            modifier = Modifier
                .padding(horizontal = 24.dp)
                .scrapbookFadeUp(delayMillis = 220),
        )

        Text(
            subline,
            style = TaliseType.mono(13.sp),
            letterSpacing = (-0.26).sp,
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
            lineHeight = 17.sp,
            modifier = Modifier
                .width(310.dp)
                .padding(top = 14.dp)
                .scrapbookFadeUp(delayMillis = 300),
        )

        Spacer(Modifier.weight(1f))

        Box(
            Modifier
                .width(175.dp)
                .height(41.dp)
                .background(Color.White, CircleShape)
                .clickable { onDismiss() }
                .scrapbookFadeUp(delayMillis = 380),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "Back to Invest",
                style = TaliseType.body(15.sp, FontWeight.Medium),
                letterSpacing = (-0.3).sp,
                color = Color.Black,
            )
        }
        Spacer(Modifier.height(40.dp))
    }
}
