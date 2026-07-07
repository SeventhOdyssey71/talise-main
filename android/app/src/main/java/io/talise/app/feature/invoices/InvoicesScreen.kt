package io.talise.app.feature.invoices

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.components.LiquidGlassButton
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Invoices hub, ported from iOS `InvoicesView`. Lists the user's issued
 * invoices (GET /api/invoices) with status pills, a "New invoice" button that
 * opens the create form (POST /api/invoices), and a per-row "Share pay link"
 * action. Bill anyone in USDsui, share a link, get settled.
 */

private fun usd2(v: Double): String = "$" + String.format(Locale.US, "%,.2f", v)

private fun dateText(ms: Double): String =
    SimpleDateFormat("MMM d, yyyy", Locale.US).format(Date(ms.toLong()))

@Composable
fun InvoicesScreen(onClose: () -> Unit) {
    val context = LocalContext.current
    val vm: InvoicesViewModel = viewModel()
    val list by vm.list.collectAsStateWithLifecycle()
    val create by vm.create.collectAsStateWithLifecycle()
    var creating by remember { mutableStateOf(false) }

    // Share as a STRING via the system share sheet — iOS `ShareSheet(items:)`.
    fun share(url: String) {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, url)
        }
        context.startActivity(Intent.createChooser(intent, null))
    }

    LaunchedEffect(Unit) { vm.load() }

    // Create-form success: close the cover, reload the list, open the share sheet.
    LaunchedEffect(create.createdUrl) {
        val url = create.createdUrl ?: return@LaunchedEffect
        creating = false
        vm.load()
        vm.resetCreate()
        share(url)
    }

    Box(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp)
                .padding(top = 18.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Header(onClose = onClose)

            LiquidGlassButton(
                title = "New invoice",
                onClick = {
                    vm.resetCreate()
                    creating = true
                },
                tint = TaliseColors.greenMint,
            )

            when {
                list.loading -> LoadingState()
                list.error != null -> ErrorState(list.error!!) { vm.load() }
                list.rows.isEmpty() -> EmptyState()
                else -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    list.rows.forEach { inv -> InvoiceRow(inv) { share(payUrl(inv.id)) } }
                }
            }
            Spacer(Modifier.height(40.dp))
        }

        if (creating) {
            CreateInvoiceScreen(
                create = create,
                onCreate = { amountUsd, name, memo -> vm.createInvoice(amountUsd, name, memo) },
                onClose = {
                    creating = false
                    vm.resetCreate()
                },
            )
        }
    }
}

@Composable
private fun Header(onClose: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Eyebrow("Invoices")
            Text(
                "Get paid",
                style = TaliseType.heading(24.sp, FontWeight.Medium),
                letterSpacing = (-0.8).sp,
                color = TaliseColors.fg,
            )
            Text(
                "Bill anyone in USDsui. Share a link, they pay, you're settled.",
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
            )
        }
        CloseButton(onClose)
    }
}

@Composable
private fun CloseButton(onClose: () -> Unit) {
    Box(
        Modifier
            .size(32.dp)
            .clip(CircleShape)
            .background(TaliseColors.surface2)
            .clickableNoRipple(onClose),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Filled.Close, contentDescription = "Close", tint = TaliseColors.fg, modifier = Modifier.size(15.dp))
    }
}

@Composable
private fun LoadingState() {
    Box(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            repeat(3) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(84.dp)
                        .clip(RoundedCornerShape(20.dp))
                        .background(TaliseColors.surface),
                )
            }
        }
        CircularProgressIndicator(
            color = TaliseColors.fgMuted,
            strokeWidth = 2.dp,
            modifier = Modifier.size(24.dp).align(Alignment.Center),
        )
    }
}

@Composable
private fun ErrorState(msg: String, onRetry: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(top = 60.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            msg,
            style = TaliseType.body(13.sp),
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
        )
        LiquidGlassButton(
            title = "Try again",
            onClick = onRetry,
            tint = null,
            fullWidth = false,
        )
    }
}

@Composable
private fun EmptyState() {
    Column(
        Modifier.fillMaxWidth().padding(top = 50.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            Icons.Filled.Description,
            contentDescription = null,
            tint = TaliseColors.fgDim,
            modifier = Modifier.size(40.dp),
        )
        Text(
            "No invoices yet",
            style = TaliseType.heading(18.sp, FontWeight.Medium),
            color = TaliseColors.fg,
        )
        Text(
            "Create one to bill a client and get paid in USDsui.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 24.dp),
        )
    }
}

@Composable
private fun InvoiceRow(inv: WorkInvoiceDTO, onShare: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(TaliseColors.surface)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    usd2(inv.amountUsd),
                    style = TaliseType.display(20.sp, FontWeight.Medium),
                    color = TaliseColors.fg,
                )
                if (!inv.customerName.isNullOrEmpty()) {
                    Text(
                        "To ${inv.customerName}",
                        style = TaliseType.body(13.sp, FontWeight.Light),
                        color = TaliseColors.fgMuted,
                    )
                }
            }
            StatusPill(inv.status)
        }
        if (!inv.memo.isNullOrEmpty()) {
            Text(
                inv.memo,
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = TaliseColors.fgMuted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(
            dateText(inv.createdAt),
            style = TaliseType.mono(10.sp),
            color = TaliseColors.fgDim,
        )
        if (inv.status == "open") {
            LiquidGlassButton(
                title = "Share pay link",
                onClick = onShare,
                tint = null,
            )
        }
    }
}

@Composable
private fun StatusPill(status: String) {
    val tint = when (status) {
        "paid" -> TaliseColors.greenMint
        "open" -> TaliseColors.accent
        else -> TaliseColors.fgDim
    }
    Text(
        status.replaceFirstChar { it.uppercase() },
        style = TaliseType.mono(9.sp, FontWeight.Light),
        letterSpacing = 0.6.sp,
        color = tint,
        modifier = Modifier
            .clip(CircleShape)
            .background(tint.copy(alpha = 0.15f))
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

// MARK: - Create invoice

@Composable
private fun CreateInvoiceScreen(
    create: InvoicesViewModel.CreateUi,
    onCreate: (Double, String, String) -> Unit,
    onClose: () -> Unit,
) {
    var amountText by remember { mutableStateOf("") }
    var customerName by remember { mutableStateOf("") }
    var memo by remember { mutableStateOf("") }

    val amountUsd = amountText.toDoubleOrNull() ?: 0.0
    val canCreate = amountUsd >= 0.01

    BackHandler(onBack = onClose)

    Box(Modifier.fillMaxSize().background(TaliseColors.bg)) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp)
                .padding(top = 18.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Eyebrow("New invoice")
                    Text(
                        "Bill a client",
                        style = TaliseType.heading(24.sp, FontWeight.Medium),
                        letterSpacing = (-0.8).sp,
                        color = TaliseColors.fg,
                    )
                }
                CloseButton(onClose)
            }

            FieldsCard(
                amountText = amountText,
                onAmount = { amountText = it.filter { c -> c.isDigit() || c == '.' } },
                customerName = customerName,
                onCustomerName = { customerName = it },
                memo = memo,
                onMemo = { memo = it },
            )

            create.error?.let { err ->
                Text(err, style = TaliseType.body(12.sp), color = TaliseColors.danger)
            }

            Spacer(Modifier.height(80.dp))
        }

        Box(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .background(
                    Brush.verticalGradient(
                        listOf(TaliseColors.bg.copy(alpha = 0f), TaliseColors.bg),
                    ),
                )
                .padding(horizontal = 22.dp)
                .padding(top = 12.dp, bottom = 24.dp),
        ) {
            LiquidGlassButton(
                title = if (create.creating) "Creating…" else "Create invoice",
                onClick = { onCreate(amountUsd, customerName, memo) },
                tint = TaliseColors.greenMint,
                enabled = canCreate && !create.creating,
                loading = create.creating,
            )
        }
    }
}

@Composable
private fun FieldsCard(
    amountText: String,
    onAmount: (String) -> Unit,
    customerName: String,
    onCustomerName: (String) -> Unit,
    memo: String,
    onMemo: (String) -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(TaliseColors.surface)
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Labeled("AMOUNT (USDsui)") {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("$", style = TaliseType.heading(18.sp), color = TaliseColors.fgMuted)
                PlainField(
                    value = amountText,
                    onValueChange = onAmount,
                    placeholder = "0.00",
                    textStyle = TaliseType.display(22.sp, FontWeight.Medium),
                    keyboardType = KeyboardType.Decimal,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        Labeled("BILL TO (optional)") {
            PlainField(
                value = customerName,
                onValueChange = onCustomerName,
                placeholder = "Client name",
                textStyle = TaliseType.body(15.sp),
            )
        }
        Labeled("MEMO (optional)") {
            PlainField(
                value = memo,
                onValueChange = onMemo,
                placeholder = "What's it for?",
                textStyle = TaliseType.body(15.sp),
            )
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
private fun PlainField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    textStyle: androidx.compose.ui.text.TextStyle,
    keyboardType: KeyboardType = KeyboardType.Text,
    modifier: Modifier = Modifier,
) {
    Box(modifier) {
        if (value.isEmpty()) {
            Text(placeholder, style = textStyle, color = TaliseColors.fgDim)
        }
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            textStyle = textStyle.copy(color = TaliseColors.fg),
            singleLine = true,
            cursorBrush = SolidColor(TaliseColors.greenMint),
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

// A ripple-free clickable so the small close chip matches the iOS `.plain` button.
internal fun Modifier.clickableNoRipple(onClick: () -> Unit): Modifier =
    this.then(
        Modifier.clickable(
            interactionSource = MutableInteractionSource(),
            indication = null,
        ) { onClick() },
    )
