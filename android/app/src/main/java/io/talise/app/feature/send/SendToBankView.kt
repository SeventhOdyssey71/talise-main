package io.talise.app.feature.send

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.R
import io.talise.app.core.auth.ZkLoginCoordinator
import io.talise.app.core.model.GaslessSubmitRequest
import io.talise.app.core.model.SendMeta
import io.talise.app.core.model.SponsorPrepareRequest
import io.talise.app.core.net.ApiClient
import io.talise.app.core.session.TaliseEvents
import io.talise.app.core.store.SecureStore
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import retrofit2.HttpException
import java.util.Locale
import kotlin.coroutines.cancellation.CancellationException

private enum class ToBankStep { Form, Sending, Done }

/**
 * Off-ramp Phase 3 — iOS `SendToBankView`. When a resolved Send recipient
 * has a PRIMARY linked Nigerian bank, the sender can pay them in Naira
 * instead of on-chain.
 *
 * Flow: enter an NGN amount → `POST /api/offramp/linq/to-user` (server
 * locks the order + returns the EXACT USDsui to send + the masked bank
 * label) → sign+send that EXACT amount to the Linq deposit wallet via the
 * same proven sponsored pipeline → poll `/api/offramp/linq/status/{id}`.
 */
@Composable
fun SendToBankView(
    /** The @handle or address the Send flow resolved against. */
    recipient: String,
    /** Display name for the recipient ("alice") shown in the header. */
    recipientDisplay: String,
    /** Masked primary-bank label, e.g. "GTBank ••••1234". */
    bankLabel: String,
    onDone: () -> Unit,
) {
    val scope = rememberCoroutineScope()

    var amount by remember { mutableStateOf("") }
    var step by remember { mutableStateOf(ToBankStep.Form) }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var statusText by remember { mutableStateOf("") }
    var paidLabel by remember { mutableStateOf("") }
    var finalStatus by remember { mutableStateOf<String?>(null) }   // completed | failed
    var paidOut by remember { mutableStateOf(false) }
    var displayRate by remember { mutableStateOf<Double?>(null) }

    val amountValue = amount.toDoubleOrNull() ?: 0.0
    val canContinue = amountValue > 0 && !sending

    // Public display rate for the "≈ $X" estimate. Silent on failure.
    LaunchedEffect(Unit) {
        if (displayRate == null) {
            displayRate = runCatching { SendApiClient.api.linqRate().rate }.getOrNull()
        }
    }

    /** Poll the Linq order until it lands or fails (or we time out). */
    suspend fun pollStatus(id: String, label: String) {
        repeat(20) {
            val s = runCatching { SendApiClient.api.linqStatus(id) }.getOrNull()
            when (s?.phase) {
                "completed" -> {
                    finalStatus = "completed"
                    paidOut = true
                    statusText = "₦${ngnGrouped(s.amountNgn)} has landed in $label."
                    step = ToBankStep.Done
                    return
                }
                "failed" -> {
                    finalStatus = "failed"
                    statusText = "The payment couldn't be completed, your USDsui has been returned."
                    step = ToBankStep.Done
                    return
                }
                else -> Unit    // initiated / processing — keep polling
            }
            delay(3000)
        }
        finalStatus = "completed"
        paidOut = false
        statusText = "Your payment is on its way. It can take a few minutes to land in $label."
        step = ToBankStep.Done
    }

    /** Create the order, then sign+send the EXACT returned USDsui and poll. */
    fun payToBank() {
        if (!canContinue) return
        sending = true
        error = null
        scope.launch {
            try {
                // 1. Lock the order — server resolves the recipient's primary
                //    bank and returns the EXACT USDsui to send.
                val order = SendApiClient.api.linqToUser(
                    LinqToUserRequest(recipient = recipient, amountNgn = amountValue),
                )
                paidLabel = order.recipientBankLabel

                // 2. Send EXACTLY `amountUsdsui` to the Linq deposit wallet
                //    via the proven sponsor-prepare → sign → gasless-submit
                //    pipeline.
                val digest = sendExactUsdsui(order.walletAddress, order.amountUsdsui)
                if (digest.isEmpty()) {
                    error = "Payment didn't land on chain. No funds moved."
                    return@launch
                }

                TaliseEvents.emit(
                    TaliseEvents.Event.TxCompleted(
                        digest = digest,
                        direction = "sent",
                        amountUsdsui = order.amountUsdsui,
                        counterpartyName = "Paid ${order.recipientBankLabel}",
                    ),
                )

                statusText = "Sending ₦${ngnGrouped(order.amountNgn)} to ${order.recipientBankLabel}…"
                step = ToBankStep.Sending
                pollStatus(order.orderId, order.recipientBankLabel)
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                error = friendlyToBankError(t)
            } finally {
                sending = false
            }
        }
    }

    Column(
        Modifier
            .fillMaxWidth()
            .fillMaxHeight(0.92f)
            .background(TaliseColors.bg),
    ) {
        // Title bar — "Pay to bank" inline title + Cancel (form only).
        Box(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 4.dp, bottom = 8.dp)) {
            Text(
                "Pay to bank",
                style = TaliseType.heading(16.sp, FontWeight.Medium),
                color = TaliseColors.fg,
                modifier = Modifier.align(Alignment.Center),
            )
            if (step == ToBankStep.Form) {
                Text(
                    "Cancel",
                    style = TaliseType.body(14.sp, FontWeight.Normal),
                    color = TaliseColors.fgMuted,
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .clickable { onDone() },
                )
            }
        }

        when (step) {
            ToBankStep.Form -> Column(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp)
                    .padding(top = 12.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                // Destination summary — name + masked bank. The sender never
                // sees the full account number, only this label.
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(TaliseColors.surface, RoundedCornerShape(18.dp))
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box(
                        Modifier
                            .size(38.dp)
                            .background(TaliseColors.accentSoft, RoundedCornerShape(11.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            painterResource(R.drawable.hi_bank),
                            contentDescription = null,
                            tint = TaliseColors.accent,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(
                            recipientDisplay,
                            style = TaliseType.body(15.sp, FontWeight.Medium),
                            color = TaliseColors.fg,
                            maxLines = 1,
                        )
                        Text(
                            bankLabel,
                            style = TaliseType.mono(11.sp, FontWeight.Light),
                            color = TaliseColors.fgMuted,
                            maxLines = 1,
                        )
                    }
                }

                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        "AMOUNT IN NAIRA",
                        style = TaliseType.mono(10.sp, FontWeight.Light),
                        letterSpacing = 1.3.sp,
                        color = TaliseColors.fgDim,
                    )
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .background(TaliseColors.surface, RoundedCornerShape(16.dp))
                            .border(1.dp, TaliseColors.line, RoundedCornerShape(16.dp))
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            "₦",
                            style = TaliseType.heading(20.sp, FontWeight.Light),
                            color = TaliseColors.fgMuted,
                        )
                        Box(Modifier.weight(1f)) {
                            if (amount.isEmpty()) {
                                Text(
                                    "0",
                                    style = TaliseType.heading(20.sp, FontWeight.Medium),
                                    color = TaliseColors.fgDim,
                                )
                            }
                            BasicTextField(
                                value = amount,
                                onValueChange = {
                                    amount = it
                                    if (error != null) error = null
                                },
                                singleLine = true,
                                textStyle = TaliseType.heading(20.sp, FontWeight.Medium)
                                    .copy(color = TaliseColors.fg),
                                cursorBrush = SolidColor(TaliseColors.accent),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                    // Display-only estimate — the EXACT debit comes from the
                    // /to-user response, never this figure.
                    val rate = displayRate
                    if (rate != null && rate > 0 && amountValue > 0) {
                        Text(
                            "≈ \$${sendFmt(amountValue / rate, 2)} USDsui leaves your wallet",
                            style = TaliseType.mono(12.sp, FontWeight.Light),
                            color = TaliseColors.fgMuted,
                            modifier = Modifier.padding(start = 2.dp),
                        )
                    }
                }

                val err = error
                if (err != null) {
                    Text(
                        err,
                        style = TaliseType.body(12.sp, FontWeight.Light),
                        color = TaliseColors.danger,
                        modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                    )
                }

                Spacer(Modifier.height(8.dp))

                // Continue button — "Pay {name}".
                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(56.dp)
                        .background(
                            if (canContinue) TaliseColors.fg else TaliseColors.fg.copy(alpha = 0.35f),
                            CircleShape,
                        )
                        .clickable(enabled = canContinue) { payToBank() }
                        .padding(top = 4.dp, bottom = 4.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (sending) {
                        CircularProgressIndicator(
                            color = TaliseColors.bg,
                            strokeWidth = 2.dp,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.size(8.dp))
                    }
                    Text(
                        if (sending) "Sending…" else "Pay $recipientDisplay",
                        style = TaliseType.heading(16.sp, FontWeight.Medium),
                        color = TaliseColors.bg,
                    )
                }

                Spacer(Modifier.height(24.dp))
            }

            ToBankStep.Sending, ToBankStep.Done -> Column(
                Modifier.fillMaxWidth().weight(1f),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                Spacer(Modifier.weight(1f))

                // Status icon
                when {
                    step == ToBankStep.Sending -> Box(
                        Modifier.size(96.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(
                            color = TaliseColors.accent,
                            strokeWidth = 3.5.dp,
                            modifier = Modifier.size(64.dp),
                        )
                    }
                    finalStatus == "completed" -> Box(
                        Modifier
                            .size(96.dp)
                            .background(TaliseColors.greenMint.copy(alpha = 0.16f), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            if (paidOut) Icons.Filled.Verified else Icons.Filled.Schedule,
                            contentDescription = null,
                            tint = TaliseColors.greenMint,
                            modifier = Modifier.size(if (paidOut) 56.dp else 50.dp),
                        )
                    }
                    else -> Box(
                        Modifier
                            .size(96.dp)
                            .background(TaliseColors.danger.copy(alpha = 0.16f), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Filled.Warning,
                            contentDescription = null,
                            tint = TaliseColors.danger,
                            modifier = Modifier.size(52.dp),
                        )
                    }
                }

                Text(
                    when {
                        step == ToBankStep.Sending -> "Paying their bank…"
                        finalStatus == "failed" -> "Payment failed"
                        paidOut -> "Paid $paidLabel"
                        else -> "On its way"
                    },
                    style = TaliseType.heading(24.sp, FontWeight.Medium),
                    letterSpacing = (-0.5).sp,
                    color = TaliseColors.fg,
                )
                Text(
                    statusText,
                    style = TaliseType.body(14.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 30.dp),
                )

                Spacer(Modifier.weight(1f))

                if (step == ToBankStep.Done) {
                    Column(
                        Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        if (finalStatus == "failed") {
                            SolidCapsuleButton(
                                title = "Try again",
                                onClick = {
                                    step = ToBankStep.Form
                                    error = null
                                },
                            )
                            Text(
                                "Close",
                                style = TaliseType.body(14.sp),
                                color = TaliseColors.fgMuted,
                                modifier = Modifier.clickable { onDone() },
                            )
                        } else {
                            SolidCapsuleButton(title = "Done", onClick = onDone)
                        }
                    }
                }
            }
        }
    }
}

/**
 * The proven sponsored send pipeline, reused for the bank payout leg:
 * `/api/send/sponsor-prepare` → local ephemeral sign → `/api/send/gasless-
 * submit`. Non-custodial; the key never leaves the device.
 */
private suspend fun sendExactUsdsui(to: String, amountUsdsui: Double): String {
    val prep = ApiClient.api.sponsorPrepare(SponsorPrepareRequest(to = to, amount = amountUsdsui))
    val bytes = prep.bytes ?: error(prep.error ?: "could not prepare the payment")
    val userSignature = ZkLoginCoordinator.signTransaction(bytes)
    val randomness = SecureStore.jwtRandomness ?: error("session needs a refresh, sign in again")
    val res = ApiClient.api.gaslessSubmit(
        GaslessSubmitRequest(
            bytesB64 = bytes,
            ephemeralPubKeyB64 = ZkLoginCoordinator.ephemeralPubKeyB64(),
            maxEpoch = SecureStore.maxEpoch,
            randomness = randomness,
            userSignature = userSignature,
            meta = SendMeta(kind = "send", amountUsd = amountUsdsui),
        ),
    )
    return res.digest ?: error(res.error ?: "Payment didn't land on chain. No funds moved.")
}

/** Grouped NGN figure (no symbol — we prefix ₦ at the call site). */
private fun ngnGrouped(v: Double): String {
    val decimals = if (v < 100) 2 else 0
    return String.format(Locale.US, "%,.${decimals}f", v)
}

/** Map rollout / config errors to reassuring copy; pass short real ones through. */
private fun friendlyToBankError(t: Throwable): String {
    if (t is HttpException) {
        val code = t.code()
        val raw = try {
            t.response()?.errorBody()?.string()
        } catch (_: Exception) {
            null
        }
        val lower = (raw ?: "").lowercase()
        if (code == 503 || lower.contains("not configured") || lower.contains("fx_unavailable")) {
            return "Bank payouts are rolling out, check back soon."
        }
        if (code == 404 || lower.contains("no primary") || lower.contains("no_bank")) {
            return "They don't have a bank account set up anymore. Try sending on-chain."
        }
        if (lower.contains("\"error\"") && raw != null) {
            try {
                val obj = ApiClient.json.parseToJsonElement(raw)
                    .let { it as? kotlinx.serialization.json.JsonObject }
                val e = obj?.get("error")
                    ?.let { it as? kotlinx.serialization.json.JsonPrimitive }
                    ?.content
                if (!e.isNullOrEmpty()) return e
            } catch (_: Exception) {
                // fall through
            }
        }
        if (!raw.isNullOrEmpty() && raw.length <= 120 &&
            !lower.contains("<html") && !lower.contains("<!doctype")
        ) {
            return raw
        }
        return "Something went wrong. Please try again."
    }
    return t.message ?: "Couldn't complete the payment right now."
}
