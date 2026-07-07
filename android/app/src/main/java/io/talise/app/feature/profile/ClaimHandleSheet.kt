package io.talise.app.feature.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.core.model.UserDTO
import io.talise.app.ui.components.LiquidGlassButton
import io.talise.app.ui.components.MicroLabel
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Bottom sheet that lets the user claim a `<name>.talise.sui` subname — exact port
 * of iOS `ClaimHandleSheet`.
 *
 * Flow:
 *   1. Debounced GET /api/username/check?u=<input> on every keystroke
 *   2. Tap "Claim" → POST /api/username/claim — operator wallet pays gas + signs
 *      the SuiNS mint, user pays nothing
 *   3. On success, refresh the session user so Home/Profile pick up the new handle
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ClaimHandleSheet(user: UserDTO?, onClaimed: () -> Unit, onDismiss: () -> Unit) {
    var input by remember { mutableStateOf("") }
    var availability by remember { mutableStateOf(HandleAvailability.EMPTY) }
    var claiming by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var claimed by remember { mutableStateOf<String?>(null) }
    var checkJob by remember { mutableStateOf<Job?>(null) }
    val scope = rememberCoroutineScope()
    val focusRequester = remember { FocusRequester() }

    fun scheduleCheck(raw: String) {
        checkJob?.cancel()
        error = null
        val q = raw.trim()
        if (q.isEmpty()) {
            availability = HandleAvailability.EMPTY
            return
        }
        if (q.length < 3) {
            availability = HandleAvailability.INVALID
            return
        }
        availability = HandleAvailability.CHECKING
        checkJob = scope.launch {
            delay(250)
            try {
                val r = profileApi.usernameCheck(q)
                availability = if (r.available) {
                    HandleAvailability.AVAILABLE
                } else {
                    when (r.reason) {
                        "taken" -> HandleAvailability.TAKEN
                        "reserved" -> HandleAvailability.RESERVED
                        "invalid" -> HandleAvailability.INVALID
                        "rpc" -> HandleAvailability.RPC_ERROR
                        else -> HandleAvailability.INVALID
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                availability = HandleAvailability.RPC_ERROR
            }
        }
    }

    fun claim() {
        if (claiming) return
        claiming = true
        error = null
        scope.launch {
            try {
                profileApi.usernameClaim(UsernameClaimBody(input))
                claimed = input
            } catch (t: Throwable) {
                val code = httpCode(t)
                val msg = httpErrorMessage(t)
                if (code == 409) {
                    error = msg ?: "That name was just taken."
                    availability = HandleAvailability.TAKEN
                } else if (code != null) {
                    error = msg ?: "Couldn't claim that handle right now."
                } else {
                    error = t.message ?: "Couldn't claim that handle right now."
                }
            }
            claiming = false
        }
    }

    LaunchedEffect(Unit) {
        if (input.isEmpty()) {
            input = suggestedHandle(user)
            scheduleCheck(input)
            focusRequester.requestFocus()
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = TaliseColors.bg,
    ) {
        val done = claimed
        if (done != null) {
            ClaimSuccessView(
                handle = done,
                onDone = {
                    onDismiss()
                    onClaimed()
                },
            )
        } else {
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    .padding(top = 8.dp),
                verticalArrangement = Arrangement.spacedBy(22.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    MicroLabel("Claim your name", color = TaliseColors.fgDim)
                    Text(
                        "Pick your Talise handle",
                        style = TaliseType.heading(24.sp, FontWeight.Medium),
                        letterSpacing = (-0.8).sp,
                        color = TaliseColors.fg,
                    )
                    Text(
                        "People send to you with name@talise.sui, easier to share than a 0x address.",
                        style = TaliseType.body(13.sp, FontWeight.Light),
                        color = TaliseColors.fgMuted,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }

                // Input — sanitized live to the server's normalizeHandle char set.
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(
                            if (availability == HandleAvailability.AVAILABLE)
                                TaliseColors.accent.copy(alpha = 0.12f)
                            else TaliseColors.surface,
                            RoundedCornerShape(16.dp),
                        )
                        .padding(horizontal = 16.dp, vertical = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.weight(1f)) {
                        if (input.isEmpty()) {
                            Text(
                                "alice",
                                style = TaliseType.heading(20.sp, FontWeight.Medium),
                                letterSpacing = (-0.4).sp,
                                color = TaliseColors.fgDim,
                            )
                        }
                        BasicTextField(
                            value = input,
                            onValueChange = { new ->
                                val cleaned = sanitizeHandle(new)
                                input = cleaned
                                scheduleCheck(cleaned)
                            },
                            singleLine = true,
                            textStyle = TaliseType.heading(20.sp, FontWeight.Medium)
                                .copy(color = TaliseColors.fg, letterSpacing = (-0.4).sp),
                            cursorBrush = SolidColor(TaliseColors.accent),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                            modifier = Modifier
                                .fillMaxWidth()
                                .focusRequester(focusRequester),
                        )
                    }
                    Text(
                        "@talise.sui",
                        style = TaliseType.body(15.sp, FontWeight.Light),
                        color = TaliseColors.fgMuted,
                    )
                }

                // Status row
                Row(
                    Modifier.height(18.dp).padding(horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    when (availability) {
                        HandleAvailability.CHECKING ->
                            CircularProgressIndicator(
                                color = TaliseColors.fgDim,
                                strokeWidth = 1.5.dp,
                                modifier = Modifier.size(12.dp),
                            )
                        HandleAvailability.AVAILABLE ->
                            Icon(
                                Icons.Filled.CheckCircle,
                                contentDescription = null,
                                tint = TaliseColors.accent,
                                modifier = Modifier.size(12.dp),
                            )
                        HandleAvailability.TAKEN,
                        HandleAvailability.RESERVED,
                        HandleAvailability.INVALID ->
                            Icon(
                                Icons.Filled.ErrorOutline,
                                contentDescription = null,
                                tint = TaliseColors.danger,
                                modifier = Modifier.size(12.dp),
                            )
                        HandleAvailability.EMPTY, HandleAvailability.RPC_ERROR ->
                            Box(Modifier.size(12.dp))
                    }
                    Text(
                        statusText(availability, input),
                        style = TaliseType.body(12.sp, FontWeight.Light),
                        color = statusColor(availability),
                    )
                }

                error?.let { MicroLabel(it, color = TaliseColors.danger) }

                val canClaim = !claiming &&
                    (availability == HandleAvailability.AVAILABLE || availability == HandleAvailability.RPC_ERROR)
                LiquidGlassButton(
                    title = if (claiming) "Claiming…" else "Claim $input@talise.sui",
                    onClick = { claim() },
                    tint = if (canClaim) TaliseColors.greenMint else null,
                    enabled = canClaim,
                    loading = claiming,
                )

                Spacer(Modifier.height(40.dp))
            }
        }
    }
}

// MARK: - Success

@Composable
private fun ClaimSuccessView(handle: String, onDone: () -> Unit) {
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Spacer(Modifier.height(24.dp))
        Box(
            Modifier
                .size(84.dp)
                .clip(CircleShape)
                .background(TaliseColors.accent.copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.Verified,
                contentDescription = null,
                tint = TaliseColors.accent,
                modifier = Modifier.size(32.dp),
            )
        }
        Text(
            "Claimed",
            style = TaliseType.heading(28.sp, FontWeight.Medium),
            letterSpacing = (-1).sp,
            color = TaliseColors.fg,
        )
        Text(
            "$handle@talise.sui is yours.",
            style = TaliseType.body(14.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
        )
        Spacer(Modifier.height(24.dp))
        LiquidGlassButton(
            title = "Done",
            onClick = onDone,
            tint = TaliseColors.greenMint,
            modifier = Modifier.padding(horizontal = 24.dp),
        )
        Spacer(Modifier.height(40.dp))
    }
}

// MARK: - State helpers

internal enum class HandleAvailability {
    EMPTY, CHECKING, AVAILABLE, TAKEN, RESERVED, INVALID, RPC_ERROR
}

private fun statusText(a: HandleAvailability, input: String): String = when (a) {
    HandleAvailability.EMPTY -> ""
    HandleAvailability.CHECKING -> "Checking…"
    HandleAvailability.AVAILABLE -> "$input@talise.sui is available."
    HandleAvailability.TAKEN -> "Someone already claimed that name."
    HandleAvailability.RESERVED -> "That name is reserved."
    HandleAvailability.INVALID -> "Use 3-20 lowercase letters, digits, or underscores."
    HandleAvailability.RPC_ERROR -> "Couldn't check on chain. Tap claim anyway."
}

@Composable
private fun statusColor(a: HandleAvailability) = when (a) {
    HandleAvailability.AVAILABLE -> TaliseColors.accent
    HandleAvailability.TAKEN, HandleAvailability.RESERVED, HandleAvailability.INVALID -> TaliseColors.danger
    HandleAvailability.RPC_ERROR -> TaliseColors.fgMuted
    else -> TaliseColors.fgDim
}

/**
 * Server-side normalizeHandle accepts the same character set: lowercased
 * [a-z0-9_], 3-20 chars. Mirrored client-side so the input box reflects
 * what'll actually be sent.
 */
private fun sanitizeHandle(s: String): String =
    s.lowercase().filter { it in 'a'..'z' || it in '0'..'9' || it == '_' }.take(20)

/**
 * Suggestion used to seed the claim sheet — derived from the Google name (then
 * email local-part). Never shown standalone as if it were the user's real handle.
 */
private fun suggestedHandle(user: UserDTO?): String {
    val source = user?.name?.takeIf { it.isNotEmpty() }?.split(" ")?.firstOrNull()
        ?: user?.email?.substringBefore("@")
        ?: "you"
    return sanitizeHandle(source)
}
