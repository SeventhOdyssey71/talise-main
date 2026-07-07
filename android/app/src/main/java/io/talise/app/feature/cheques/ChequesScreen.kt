package io.talise.app.feature.cheques

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.R
import io.talise.app.core.session.AppSession
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.components.LiquidGlassButton
import io.talise.app.ui.components.SlideToConfirm
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Cheques — claimable money links, a 1:1 port of iOS `ChequesView.swift`.
 * Centerpiece is the skeuomorphic paper-cheque card (cream stock, serif
 * TALISE header, PAY TO THE ORDER OF, boxed figure, amount in words, MEMO +
 * AUTHORIZED SIGNATURE, and a rotated status stamp).
 *
 * iOS presents `ChequeWriteView` / `MyChequesView` / `ChequeClaimView` as
 * separate covers; Android's single route hosts them behind a segmented
 * control: Write, My cheques, Cash. Every state (authoring, issued/share,
 * reclaim, list + row reclaim, paste/preview/cash) matches iOS 1:1.
 *
 * Nav signature: `ChequesScreen(onClose: () -> Unit)`.
 */

// Cheque-paper palette — exact iOS `ChequeCard` values.
private val Ink = Color(0xFF2A2A2A)
private val InkSoft = Color(0xFF6B6357)
private val Rule = Color(0xFF9C9486)
private val PaperTop = Color(0xFFF7F3E8)
private val PaperBottom = Color(0xFFEDE6D5)
private val StampRed = Color(0xFFA23B2E)

@Composable
fun ChequesScreen(onClose: () -> Unit) {
    val vm: ChequesViewModel = viewModel()
    val write by vm.write.collectAsStateWithLifecycle()

    var tab by remember { mutableIntStateOf(0) } // 0 write, 1 my cheques, 2 cash

    // Write-form fields live at screen level so the issued view can render
    // the payee/memo the user typed (iOS keeps them in ChequeWriteView).
    var amountText by remember { mutableStateOf("") }
    var payee by remember { mutableStateOf("") }
    var memo by remember { mutableStateOf("") }
    var gateCountry by remember { mutableStateOf(false) }
    var country by remember { mutableStateOf("NG") }

    val signatureName = AppSession.currentUser?.name ?: "Talise"

    // Issued → full-screen share/reclaim view (replaces the cover content on iOS).
    val issued = write.issued
    if (issued != null) {
        ChequeIssuedView(
            resp = issued,
            payee = payee,
            memo = memo,
            signature = signatureName,
            reclaiming = write.reclaiming,
            reclaimed = write.reclaimed,
            reclaimError = write.reclaimError,
            onReclaim = { vm.reclaimIssued() },
            onDone = {
                vm.resetWrite()
                amountText = ""; payee = ""; memo = ""; gateCountry = false; country = "NG"
                onClose()
            },
        )
        return
    }

    Column(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        // ── Top bar: segments + dismiss X (iOS coverDismiss, top-trailing) ──
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 12.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(TaliseColors.surface).padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Segment("Write", tab == 0, Modifier.weight(1f)) { tab = 0 }
                Segment("My cheques", tab == 1, Modifier.weight(1f)) { tab = 1 }
                Segment("Cash", tab == 2, Modifier.weight(1f)) { tab = 2 }
            }
            Box(
                Modifier.size(34.dp).clip(CircleShape).background(TaliseColors.surface2).clickable { onClose() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Close, contentDescription = "Close", tint = TaliseColors.fg, modifier = Modifier.size(13.dp))
            }
        }

        when (tab) {
            0 -> ChequeWriteView(
                vm = vm,
                amountText = amountText, onAmountChange = { amountText = it },
                payee = payee, onPayeeChange = { payee = it },
                memo = memo, onMemoChange = { memo = it },
                gateCountry = gateCountry, onGateChange = { gateCountry = it },
                country = country, onCountryChange = { country = it.uppercase() },
                signatureName = signatureName,
            )
            1 -> MyChequesView(vm = vm)
            else -> ChequeClaimView(vm = vm, onDone = onClose)
        }
    }
}

@Composable
private fun Segment(label: String, active: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier.clip(RoundedCornerShape(9.dp))
            .background(if (active) TaliseColors.surface2 else Color.Transparent)
            .clickable { onClick() }
            .padding(vertical = 9.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            style = TaliseType.body(13.sp, if (active) FontWeight.Medium else FontWeight.Normal),
            color = if (active) TaliseColors.fg else TaliseColors.fgDim,
            maxLines = 1,
        )
    }
}

// MARK: - Write a cheque

@Composable
private fun ChequeWriteView(
    vm: ChequesViewModel,
    amountText: String, onAmountChange: (String) -> Unit,
    payee: String, onPayeeChange: (String) -> Unit,
    memo: String, onMemoChange: (String) -> Unit,
    gateCountry: Boolean, onGateChange: (Boolean) -> Unit,
    country: String, onCountryChange: (String) -> Unit,
    signatureName: String,
) {
    val write by vm.write.collectAsStateWithLifecycle()
    val amountUsd = amountText.toDoubleOrNull() ?: 0.0
    val canIssue = !write.issuing && amountUsd >= 0.01 && payee.isNotEmpty()

    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp).padding(top = 18.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            // ── Header ──
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Eyebrow("Write a cheque")
                Text(
                    "Money in a link",
                    style = TaliseType.heading(24.sp, FontWeight.Medium),
                    letterSpacing = (-0.8).sp,
                    color = TaliseColors.fg,
                )
                Text(
                    "Send it in any DM. They claim it as real money.",
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                )
            }

            ChequeCard(
                amountUsd = amountUsd, payee = payee, memo = memo,
                signature = signatureName, chequeNo = "•••••",
            )

            // ── Fields card ──
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(TaliseColors.surface).padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Labeled("AMOUNT (USDsui)") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("$", style = TaliseType.heading(18.sp), color = TaliseColors.fgMuted)
                        BasicTextField(
                            value = amountText,
                            onValueChange = onAmountChange,
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Decimal),
                            textStyle = TaliseType.display(22.sp, FontWeight.Medium).copy(color = TaliseColors.fg),
                            cursorBrush = SolidColor(TaliseColors.accent),
                            modifier = Modifier.weight(1f).padding(start = 6.dp),
                            decorationBox = { inner ->
                                if (amountText.isEmpty()) Text("0.00", style = TaliseType.display(22.sp, FontWeight.Medium), color = TaliseColors.fgDim)
                                inner()
                            },
                        )
                    }
                }
                Labeled("PAY TO (name on the cheque)") {
                    PlainField(payee, onPayeeChange, placeholder = "e.g. Sele")
                }
                Labeled("MEMO (optional)") {
                    PlainField(memo, onMemoChange, placeholder = "What's it for?")
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("Restrict by country", style = TaliseType.body(14.sp), color = TaliseColors.fg)
                        Text(
                            "Only claimable from one country (IP-checked)",
                            style = TaliseType.mono(9.sp),
                            color = TaliseColors.fgDim,
                        )
                    }
                    Switch(
                        checked = gateCountry,
                        onCheckedChange = onGateChange,
                        colors = SwitchDefaults.colors(
                            checkedTrackColor = TaliseColors.greenDeep,
                            checkedThumbColor = Color.White,
                        ),
                    )
                }
                if (gateCountry) {
                    Labeled("COUNTRY (ISO code)") {
                        PlainField(country, onCountryChange, placeholder = "NG")
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.Filled.VerifiedUser, contentDescription = null, tint = TaliseColors.accent, modifier = Modifier.size(11.dp))
                    Text(
                        "Always protected: captcha + no-VPN on claim",
                        style = TaliseType.mono(9.sp),
                        color = TaliseColors.fgDim,
                    )
                }
            }

            if (write.error != null) {
                Text(write.error!!, style = TaliseType.body(12.sp), color = TaliseColors.danger)
            }

            Spacer(Modifier.height(90.dp))
        }

        // ── Issue bar ──
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                .background(Brush.verticalGradient(listOf(TaliseColors.bg.copy(alpha = 0f), TaliseColors.bg)))
                .padding(horizontal = 22.dp).padding(top = 12.dp, bottom = 24.dp),
        ) {
            Box(Modifier.alpha(if (canIssue) 1f else 0.5f)) {
                SlideToConfirm(
                    title = if (write.issuing) "Issuing…" else "Slide to sign & fund",
                    enabled = canIssue,
                    tint = TaliseColors.accent,
                    reset = write.error != null && !write.issuing,
                    onConfirm = { vm.issue(amountUsd, payee, memo, gateCountry, country) },
                )
            }
        }
    }
}

@Composable
private fun Labeled(label: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Text(label, style = TaliseType.mono(9.sp), letterSpacing = 1.5.sp, color = TaliseColors.fgDim)
        content()
        Box(Modifier.fillMaxWidth().height(1.dp).background(TaliseColors.line))
    }
}

@Composable
private fun PlainField(value: String, onValueChange: (String) -> Unit, placeholder: String) {
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        singleLine = true,
        textStyle = TaliseType.body(15.sp).copy(color = TaliseColors.fg),
        cursorBrush = SolidColor(TaliseColors.accent),
        modifier = Modifier.fillMaxWidth(),
        decorationBox = { inner ->
            if (value.isEmpty()) Text(placeholder, style = TaliseType.body(15.sp), color = TaliseColors.fgDim)
            inner()
        },
    )
}

// MARK: - Issued (share)

@Composable
private fun ChequeIssuedView(
    resp: ChequeCreateResp,
    payee: String,
    memo: String,
    signature: String,
    reclaiming: Boolean,
    reclaimed: Boolean,
    reclaimError: String?,
    onReclaim: () -> Unit,
    onDone: () -> Unit,
) {
    val context = LocalContext.current
    fun share() {
        // Share the link as PLAIN TEXT — a string is auto-linked cleanly by
        // every messaging app (mirrors the iOS ShareSheet note).
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, resp.claimUrl)
        }
        context.startActivity(Intent.createChooser(intent, null))
    }

    Column(
        Modifier.fillMaxSize().background(TaliseColors.bg),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        Spacer(Modifier.height(8.dp))
        Text(
            if (reclaimed) "Cheque reclaimed" else "Cheque issued",
            style = TaliseType.heading(22.sp, FontWeight.Medium),
            color = TaliseColors.fg,
        )
        Box(Modifier.padding(horizontal = 22.dp)) {
            ChequeCard(
                amountUsd = resp.amountUsd, payee = payee, memo = memo,
                signature = signature, chequeNo = resp.chequeId.takeLast(5),
                stamp = if (reclaimed) "RECLAIMED" else "ISSUED",
            )
        }
        Text(
            if (reclaimed) "The money is back in your Talise balance."
            else "Send this link in any DM. They claim it as money.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 30.dp),
        )
        if (reclaimError != null) {
            Text(
                reclaimError,
                style = TaliseType.body(12.sp),
                color = TaliseColors.danger,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 30.dp),
            )
        }
        Spacer(Modifier.weight(1f))
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 22.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (reclaimed) {
                LiquidGlassButton(title = "Done", onClick = onDone, tint = TaliseColors.greenMint)
            } else {
                LiquidGlassButton(title = "Share cheque link", onClick = { share() }, tint = TaliseColors.greenMint)
                // Claim back: pull an unclaimed cheque the user created back
                // to their own balance before anyone cashes it.
                LiquidGlassButton(
                    title = if (reclaiming) "Claiming back…" else "Claim it back",
                    onClick = onReclaim,
                    tint = null,
                    enabled = !reclaiming,
                    loading = reclaiming,
                )
                Box(
                    Modifier.fillMaxWidth().height(44.dp).clip(RoundedCornerShape(10.dp))
                        .clickable(enabled = !reclaiming) { onDone() },
                    contentAlignment = Alignment.Center,
                ) {
                    Text("Done", style = TaliseType.body(15.sp), color = TaliseColors.fgMuted)
                }
            }
        }
    }
}

// MARK: - My cheques

/**
 * The signed-in user's written cheques (GET /api/cheques/mine), newest first.
 * Rows the server marks `reclaimable` get a "Claim it back" button that runs
 * the same reclaim flow as the issued view.
 */
@Composable
private fun MyChequesView(vm: ChequesViewModel) {
    val ui by vm.mine.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.loadMine() }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState())
            .padding(horizontal = 22.dp).padding(top = 18.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        // ── Header ──
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Eyebrow("My cheques")
            Text(
                "Cheques you've written",
                style = TaliseType.heading(24.sp, FontWeight.Medium),
                letterSpacing = (-0.8).sp,
                color = TaliseColors.fg,
            )
            Text(
                "Claim back anything that hasn't been cashed yet.",
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
            )
        }

        when {
            ui.loading -> Box(contentAlignment = Alignment.Center) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    repeat(3) {
                        Box(Modifier.fillMaxWidth().height(84.dp).clip(RoundedCornerShape(20.dp)).background(TaliseColors.surface))
                    }
                }
                CircularProgressIndicator(color = TaliseColors.fgMuted, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
            }
            ui.error != null -> Column(
                Modifier.fillMaxWidth().padding(top = 60.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text(ui.error!!, style = TaliseType.body(13.sp), color = TaliseColors.fgMuted, textAlign = TextAlign.Center)
                LiquidGlassButton(title = "Try again", onClick = { vm.loadMine() }, tint = null, fullWidth = false)
            }
            ui.rows.isEmpty() -> Column(
                Modifier.fillMaxWidth().padding(top = 60.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Icon(Icons.Outlined.Description, contentDescription = null, tint = TaliseColors.fgDim, modifier = Modifier.size(40.dp))
                Text("No cheques yet", style = TaliseType.heading(18.sp, FontWeight.Medium), color = TaliseColors.fg)
                Text(
                    "Cheques you write will show up here so you can track and reclaim them.",
                    style = TaliseType.body(13.sp, FontWeight.Light),
                    color = TaliseColors.fgMuted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 24.dp),
                )
            }
            else -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                ui.rows.forEach { row ->
                    ChequeRowCard(
                        row = row,
                        reclaiming = ui.reclaiming.contains(row.id),
                        onReclaim = { vm.reclaimRow(row) },
                    )
                }
            }
        }

        Spacer(Modifier.height(40.dp))
    }
}

@Composable
private fun ChequeRowCard(row: MyChequeRow, reclaiming: Boolean, onReclaim: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(TaliseColors.surface).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    usd2(row.amountUsd),
                    style = TaliseType.display(20.sp, FontWeight.Medium),
                    color = TaliseColors.fg,
                )
                Text(usd2(row.amountUsd), style = TaliseType.mono(10.sp), color = TaliseColors.fgDim)
            }
            ChequeStatusPill(row.status)
        }
        val label = when {
            !row.memo.isNullOrEmpty() -> row.memo
            !row.payeeLabel.isNullOrEmpty() -> "To ${row.payeeLabel}"
            else -> ""
        }
        if (label.isNotEmpty()) {
            Text(
                label,
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
                maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
        }
        Text(
            SimpleDateFormat("MMM d, yyyy", Locale.US).format(Date(row.createdAt.toLong())),
            style = TaliseType.mono(10.sp),
            color = TaliseColors.fgDim,
        )
        if (row.reclaimable) {
            LiquidGlassButton(
                title = if (reclaiming) "Claiming back…" else "Claim it back",
                onClick = onReclaim,
                tint = null,
                enabled = !reclaiming,
                loading = reclaiming,
            )
        }
    }
}

/** Color-code: funded = mint (live/reclaimable), claimed = muted, everything else dim. */
@Composable
private fun ChequeStatusPill(status: String) {
    val tint = when (status) {
        "funded" -> TaliseColors.greenMint
        "claimed" -> TaliseColors.fgMuted
        else -> TaliseColors.fgDim // reclaimed / voided / expired / draft
    }
    Text(
        status.replaceFirstChar { it.uppercase() },
        style = TaliseType.mono(9.sp, FontWeight.Light),
        letterSpacing = 0.6.sp,
        color = tint,
        modifier = Modifier.clip(CircleShape).background(tint.copy(alpha = 0.15f)).padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

// MARK: - Claim a cheque

@Composable
private fun ChequeClaimView(vm: ChequesViewModel, onDone: () -> Unit) {
    val ui by vm.claim.collectAsStateWithLifecycle()
    var linkText by remember { mutableStateOf("") }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState())
            .padding(horizontal = 22.dp).padding(top = 18.dp, bottom = 40.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Eyebrow("Cash a cheque")

        val claimedAmount = ui.claimedAmount
        val preview = ui.preview
        when {
            claimedAmount != null -> Column(
                Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Spacer(Modifier.height(30.dp))
                Box(
                    Modifier.size(96.dp).clip(CircleShape).background(TaliseColors.accent.copy(alpha = 0.16f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Filled.Verified, contentDescription = null, tint = TaliseColors.accent, modifier = Modifier.size(56.dp))
                }
                Text(
                    "${usd2(claimedAmount)} cashed",
                    style = TaliseType.heading(22.sp, FontWeight.Medium),
                    color = TaliseColors.fg,
                )
                Text("It's in your Talise balance.", style = TaliseType.body(13.sp), color = TaliseColors.fgMuted)
                Box(Modifier.padding(top = 10.dp).fillMaxWidth()) {
                    LiquidGlassButton(title = "Done", onClick = onDone, tint = TaliseColors.greenMint)
                }
            }
            preview != null -> Column(
                Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                Text("From ${preview.creatorDisplay}", style = TaliseType.body(13.sp), color = TaliseColors.fgMuted)
                ChequeCard(
                    amountUsd = preview.amountUsd,
                    payee = preview.payeeLabel ?: "You",
                    memo = preview.memo.orEmpty(),
                    signature = preview.signatureName.orEmpty(),
                    chequeNo = preview.id.takeLast(5),
                    stamp = if (preview.claimable) null else preview.status.uppercase(),
                )
                if (preview.allowedCountries.isNotEmpty()) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Icon(
                            painterResource(R.drawable.hi_globe), contentDescription = null,
                            tint = TaliseColors.fgDim, modifier = Modifier.size(12.dp),
                        )
                        Text(
                            "Claimable only from ${preview.allowedCountries.joinToString(", ")}",
                            style = TaliseType.mono(10.sp),
                            color = TaliseColors.fgDim,
                        )
                    }
                }
                if (preview.claimable) {
                    Box(Modifier.alpha(if (ui.claiming) 0.5f else 1f)) {
                        SlideToConfirm(
                            title = if (ui.claiming) "Cashing…" else "Slide to cash this cheque",
                            enabled = !ui.claiming,
                            tint = TaliseColors.accent,
                            reset = ui.error != null && !ui.claiming,
                            onConfirm = { vm.cash() },
                        )
                    }
                } else {
                    Text("This cheque is ${preview.status}.", style = TaliseType.body(13.sp), color = TaliseColors.fgMuted)
                }
            }
            else -> Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("Paste a cheque link", style = TaliseType.heading(20.sp, FontWeight.Medium), color = TaliseColors.fg)
                Box(
                    Modifier.fillMaxWidth().defaultMinSize(minHeight = 48.dp)
                        .clip(RoundedCornerShape(16.dp)).background(TaliseColors.surface).padding(14.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    BasicTextField(
                        value = linkText,
                        onValueChange = { linkText = it },
                        textStyle = TaliseType.body(13.sp).copy(color = TaliseColors.fg),
                        cursorBrush = SolidColor(TaliseColors.accent),
                        modifier = Modifier.fillMaxWidth(),
                        decorationBox = { inner ->
                            if (linkText.isEmpty()) {
                                Text("https://talise.io/c/…", style = TaliseType.body(13.sp), color = TaliseColors.fgDim)
                            }
                            inner()
                        },
                    )
                }
                Box(Modifier.alpha(if (ui.loading || linkText.isEmpty()) 0.55f else 1f)) {
                    LiquidGlassButton(
                        title = if (ui.loading) "Loading…" else "Open cheque",
                        onClick = { vm.openLink(linkText) },
                        tint = TaliseColors.greenMint,
                        enabled = !ui.loading && linkText.isNotEmpty(),
                        loading = ui.loading,
                    )
                }
            }
        }

        if (ui.error != null) {
            Text(ui.error!!, style = TaliseType.body(12.sp), color = TaliseColors.danger)
        }
    }
}

// MARK: - Skeuomorphic cheque card

/**
 * A paper-cheque visual: cream stock on the dark app surface, engraved
 * header, pay-to-the-order-of line, a boxed figure amount, the amount in
 * words, memo + signature lines, and a status stamp. 1:1 port of iOS
 * `ChequeCard`.
 */
@Composable
fun ChequeCard(
    amountUsd: Double,
    payee: String,
    memo: String,
    signature: String,
    chequeNo: String,
    stamp: String? = null,
) {
    val shape = RoundedCornerShape(16.dp)
    Box(
        Modifier.fillMaxWidth().height(210.dp)
            .shadow(14.dp, shape, clip = false, ambientColor = Color.Black.copy(alpha = 0.4f), spotColor = Color.Black.copy(alpha = 0.4f))
            .clip(shape)
            .background(Brush.linearGradient(listOf(PaperTop, PaperBottom))),
    ) {
        Column(Modifier.fillMaxSize().padding(18.dp)) {
            // Header band
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Text(
                        "TALISE",
                        fontFamily = FontFamily.Serif, fontWeight = FontWeight.Black, fontSize = 15.sp,
                        letterSpacing = 2.sp, color = TaliseColors.greenDeep,
                    )
                    Text(
                        "PAY ANYONE, ANYWHERE",
                        fontFamily = FontFamily.Monospace, fontSize = 6.sp, letterSpacing = 1.5.sp, color = InkSoft,
                    )
                }
                Spacer(Modifier.weight(1f))
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Text(
                        "No. $chequeNo",
                        fontFamily = FontFamily.Monospace, fontSize = 9.sp, fontWeight = FontWeight.Medium, color = InkSoft,
                    )
                    Text(
                        "USDsui",
                        fontFamily = FontFamily.Serif, fontSize = 9.sp, fontWeight = FontWeight.SemiBold, color = Ink,
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            Box(Modifier.fillMaxWidth().height(1.dp).background(Rule.copy(alpha = 0.5f)))

            // Pay to the order of + figure box
            Row(
                Modifier.fillMaxWidth().padding(top = 14.dp),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(
                        "PAY TO THE ORDER OF",
                        fontFamily = FontFamily.Monospace, fontSize = 7.sp, letterSpacing = 1.sp, color = InkSoft,
                    )
                    Text(
                        payee.ifEmpty { "-" },
                        fontFamily = FontFamily.Serif, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
                        color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    Box(Modifier.fillMaxWidth().height(1.dp).background(Rule.copy(alpha = 0.6f)))
                }
                Text(
                    usd2(amountUsd),
                    fontFamily = FontFamily.Serif, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Ink,
                    modifier = Modifier
                        .border(1.2.dp, Ink.copy(alpha = 0.5f), RoundedCornerShape(6.dp))
                        .padding(horizontal = 10.dp, vertical = 5.dp),
                )
            }

            // Amount in words
            Row(
                Modifier.fillMaxWidth().padding(top = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    amountInWords(amountUsd),
                    fontFamily = FontFamily.Serif, fontStyle = FontStyle.Italic, fontSize = 11.sp,
                    fontWeight = FontWeight.Medium, color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Box(Modifier.weight(1f).height(1.dp).background(Rule.copy(alpha = 0.6f)))
                Text("USDsui", fontFamily = FontFamily.Serif, fontSize = 9.sp, color = InkSoft)
            }

            Spacer(Modifier.weight(1f))

            // Memo + signature
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        memo.ifEmpty { " " },
                        fontFamily = FontFamily.Serif, fontSize = 10.sp, color = Ink, maxLines = 1,
                    )
                    Box(Modifier.width(110.dp).height(1.dp).background(Rule.copy(alpha = 0.5f)))
                    Text("MEMO", fontFamily = FontFamily.Monospace, fontSize = 6.sp, color = InkSoft)
                }
                Spacer(Modifier.weight(1f))
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        signature.ifEmpty { " " },
                        fontFamily = FontFamily.Cursive, fontWeight = FontWeight.Bold, fontSize = 18.sp,
                        color = TaliseColors.greenDeep, maxLines = 1,
                    )
                    Box(Modifier.width(120.dp).height(1.dp).background(Rule.copy(alpha = 0.5f)))
                    Text("AUTHORIZED SIGNATURE", fontFamily = FontFamily.Monospace, fontSize = 6.sp, color = InkSoft)
                }
            }
        }

        if (stamp != null) {
            Box(
                Modifier.align(Alignment.Center).rotate(-14f).alpha(0.9f)
                    .border(3.dp, StampRed.copy(alpha = 0.85f), RoundedCornerShape(6.dp))
                    .padding(8.dp),
            ) {
                Text(
                    stamp,
                    fontWeight = FontWeight.Black, fontSize = 26.sp, letterSpacing = 2.sp,
                    color = StampRed.copy(alpha = 0.85f),
                )
            }
        }
    }
}
