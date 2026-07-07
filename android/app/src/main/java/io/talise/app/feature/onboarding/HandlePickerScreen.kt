package io.talise.app.feature.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import retrofit2.HttpException

/**
 * Step 2/4 of the post-Welcome onboarding — iOS `HandlePickerScreen`: pick a
 * `*.talise.sui` username.
 *
 * Visual: `OnboardingBackground` + top progress bar (step 2 of 4) + left-aligned
 * title/subtitle + a text field with a muted `.talise.sui` suffix + primary
 * "Continue" CTA pinned near the bottom.
 *
 * Validation: 3..24 chars, lowercase alphanumeric only, no spaces. The CTA stays
 * disabled until the handle parses.
 *
 * Backend: on Continue we run the availability check (GET /api/username/check?u=)
 * then actually CLAIM the chosen `<name>.talise.sui` via POST /api/username/claim
 * (operator-paid mint) so the username the user picked is the one they get. On a
 * taken name / error we surface it inline and let them pick another.
 */
@Composable
fun HandlePickerScreen(onContinue: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    val focusRequester = remember { FocusRequester() }

    var handle by remember { mutableStateOf("") }
    var claiming by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val sanitized = handle.lowercase().filter { it.isLetterOrDigit() }
    val isValid = sanitized.length in 3..24

    LaunchedEffect(Unit) {
        // Restore in-progress handle if user backgrounded mid-flow.
        OnboardingPrefs.of(context).getString(OnboardingPrefs.KEY_HANDLE, null)
            ?.takeIf { it.isNotEmpty() }
            ?.let { handle = it }
        delay(350)
        focusRequester.requestFocus()
    }

    fun claimAndContinue() {
        if (!isValid || claiming) return
        claiming = true
        error = null
        keyboard?.hide()
        val name = sanitized
        OnboardingPrefs.of(context).edit().putString(OnboardingPrefs.KEY_HANDLE, name).apply()
        scope.launch {
            try {
                // Availability check first — same endpoint iOS uses (ClaimHandleSheet).
                // An "rpc" reason is inconclusive, so we fall through to the claim.
                val check = runCatching { onboardingApi.checkUsername(name) }.getOrNull()
                if (check != null && !check.available && check.reason != "rpc") {
                    claiming = false
                    error = when (check.reason) {
                        "invalid" -> "That name can't be used. Try another."
                        "reserved" -> "That name's reserved. Try another."
                        else -> "That name's taken. Try another."
                    }
                    return@launch
                }
                onboardingApi.claimUsername(UsernameClaimRequest(name))
                claiming = false
                onContinue(name)
            } catch (e: HttpException) {
                claiming = false
                error = if (e.code() == 409) {
                    e.serverMessage() ?: "That name's taken. Try another."
                } else {
                    e.serverMessage() ?: "Couldn't reserve that name. Try again."
                }
            } catch (t: Throwable) {
                claiming = false
                error = "Couldn't reserve that name. Check your connection and try again."
            }
        }
    }

    Box(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        OnboardingBackground(Modifier.fillMaxSize())

        Column(
            Modifier
                .fillMaxSize()
                .navigationBarsPadding()
                .imePadding()
        ) {
            OnboardingProgressBar(totalSteps = 4, currentStep = 2)

            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    .padding(top = 28.dp)
            ) {
                Text(
                    "Create a username",
                    style = TaliseType.heading(23.5.sp, FontWeight.SemiBold),
                    letterSpacing = (-0.705).sp,
                    color = TaliseColors.fg,
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    "Usernames are used for your Talise ID, for swift identification and verification.",
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    letterSpacing = (-0.39).sp,
                    lineHeight = 17.sp,
                    color = TaliseColors.fgMuted,
                )
            }

            HandleField(
                value = handle,
                onValueChange = { newValue ->
                    handle = newValue.lowercase().filter { it.isLetterOrDigit() }
                },
                onDone = { claimAndContinue() },
                focusRequester = focusRequester,
                modifier = Modifier
                    .padding(horizontal = 24.dp)
                    .padding(top = 28.dp),
            )

            error?.let { msg ->
                Text(
                    msg,
                    style = TaliseType.body(12.5.sp, FontWeight.Light),
                    letterSpacing = (-0.375).sp,
                    color = TaliseColors.danger,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp)
                        .padding(top = 10.dp),
                )
            }

            Spacer(Modifier.weight(1f))

            // Primary CTA — accent capsule, dims to 40% while invalid/claiming.
            Box(
                modifier = Modifier
                    .padding(horizontal = 24.dp)
                    .padding(bottom = 28.dp)
                    .fillMaxWidth()
                    .height(54.dp)
                    .clip(RoundedCornerShape(27.dp))
                    .background(
                        if (isValid && !claiming) TaliseColors.accent
                        else TaliseColors.accent.copy(alpha = 0.4f)
                    )
                    .clickable(enabled = isValid && !claiming) { claimAndContinue() },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    if (claiming) "Reserving…" else "Continue",
                    style = TaliseType.body(15.sp, FontWeight.Medium),
                    letterSpacing = (-0.45).sp,
                    color = TaliseColors.bg,
                )
            }
        }
    }
}

/** Rounded glass field with a muted `.talise.sui` suffix (iOS `handleField`). */
@Composable
private fun HandleField(
    value: String,
    onValueChange: (String) -> Unit,
    onDone: () -> Unit,
    focusRequester: FocusRequester,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(54.dp)
            .clip(RoundedCornerShape(27.dp))
            .background(Color.White.copy(alpha = 0.08f))
            .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(27.dp))
            .padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = TaliseType.body(16.sp, FontWeight.Medium).copy(
                color = TaliseColors.fg,
                letterSpacing = (-0.48).sp,
            ),
            cursorBrush = SolidColor(TaliseColors.fg),
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.None,
                autoCorrectEnabled = false,
                keyboardType = KeyboardType.Ascii,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { onDone() }),
            decorationBox = { innerTextField ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty()) {
                        Text(
                            "yourname",
                            style = TaliseType.body(16.sp, FontWeight.Medium),
                            letterSpacing = (-0.48).sp,
                            color = TaliseColors.fgDim,
                        )
                    }
                    innerTextField()
                }
            },
            modifier = Modifier
                .weight(1f)
                .focusRequester(focusRequester),
        )

        Text(
            ".talise.sui",
            style = TaliseType.body(15.sp, FontWeight.Light),
            letterSpacing = (-0.45).sp,
            color = TaliseColors.fgMuted,
        )
    }
}
