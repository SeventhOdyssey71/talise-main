package io.talise.app.feature.requests

import android.content.Intent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.IosShare
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.talise.app.R
import io.talise.app.config.AppConfig
import io.talise.app.core.net.ApiClient
import io.talise.app.core.store.SecureStore
import io.talise.app.ui.components.rampCard
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Response
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import java.util.concurrent.TimeUnit

/**
 * Requests, "ask anyone for $X". A faithful Android port of iOS
 * `RequestsListView` + `RequestCreateView` combined into one screen.
 *
 * The list shows the payment links you've minted (with status + a share
 * affordance); "New request" opens the create flow (amount + optional note),
 * which mints a shareable link (talise.io/req/<id>) and flips to a share view
 * with a QR, the link, and Copy / Share actions.
 *
 * Wired to the real backend, POST/GET `/api/requests` (same wire as iOS/web),
 * via a self-contained Retrofit service that reuses `ApiClient.json`,
 * `AppConfig.apiBaseUrl`, and the `SecureStore` bearer.
 */
@Composable
fun RequestsScreen(onClose: () -> Unit) {
    var showCreate by remember { mutableStateOf(false) }
    var reloadKey by remember { mutableIntStateOf(0) }

    if (showCreate) {
        RequestCreate(onDone = { showCreate = false; reloadKey++ })
    } else {
        RequestsList(reloadKey = reloadKey, onNew = { showCreate = true })
    }
}

// MARK: - List

@Composable
private fun RequestsList(reloadKey: Int, onNew: () -> Unit) {
    var requests by remember { mutableStateOf<List<RequestDTO>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(reloadKey) {
        loading = true
        error = null
        try {
            requests = RequestsBackend.service.list().requests
        } catch (t: Throwable) {
            error = "Couldn't load your requests right now."
        } finally {
            loading = false
            loaded = true
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(TaliseColors.bg)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(top = 8.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        RequestsHeader(
            eyebrow = "REQUESTS",
            title = "Request money",
            subtitle = "Mint a link to ask anyone for a set amount, share it, and they pay you straight to your wallet.",
        )

        NewRequestButton(onClick = onNew)

        when {
            loading && !loaded -> LoadingState()
            error != null -> ErrorState(error!!)
            requests.isEmpty() -> EmptyState()
            else -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                requests.forEach { RequestRow(it) }
            }
        }

        Spacer(Modifier.height(28.dp))
    }
}

@Composable
private fun RequestsHeader(eyebrow: String, title: String, subtitle: String) {
    Column(
        modifier = Modifier.padding(top = 4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(eyebrow, style = TaliseType.mono(10.sp), letterSpacing = 1.4.sp, color = TaliseColors.fgDim)
        Text(title, style = TaliseType.heading(26.sp, FontWeight.Medium), letterSpacing = (-0.6).sp, color = TaliseColors.fg)
        Text(subtitle, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted)
    }
}

@Composable
private fun NewRequestButton(onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(54.dp)
            .clip(CircleShape)
            .background(TaliseColors.greenMint)
            .clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Icon(Icons.Filled.Add, contentDescription = null, tint = Color.Black, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(10.dp))
        Text("New request", style = TaliseType.body(16.sp, FontWeight.SemiBold), color = Color.Black)
    }
}

@Composable
private fun RequestRow(req: RequestDTO) {
    val context = LocalContext.current
    val tint = statusTint(req.status)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .rampCard()
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            modifier = Modifier
                .size(46.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(tint.copy(alpha = 0.12f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(statusIcon(req.status), contentDescription = null, tint = tint, modifier = Modifier.size(17.dp))
        }

        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(formatUsd2(req.amountUsd), style = TaliseType.heading(16.sp, FontWeight.Medium), color = TaliseColors.fg)
            val note = req.requesterNote
            if (!note.isNullOrEmpty()) {
                Text(note, style = TaliseType.body(12.5.sp, FontWeight.Light), color = TaliseColors.fgMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            } else {
                Text(
                    payUrlFor(req.id).replace("https://www.", ""),
                    style = TaliseType.mono(11.sp),
                    color = TaliseColors.fgDim,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(req.status.uppercase(), style = TaliseType.mono(10.sp), letterSpacing = 0.8.sp, color = tint)
            if (req.status == "open") {
                Box(
                    modifier = Modifier
                        .size(34.dp)
                        .clip(CircleShape)
                        .background(TaliseColors.surface2)
                        .clickable { shareText(context, payUrlFor(req.id)) },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Filled.IosShare, contentDescription = "Share", tint = TaliseColors.fg, modifier = Modifier.size(13.dp))
                }
            }
        }
    }
}

private fun statusTint(status: String): Color = when (status) {
    "paid" -> TaliseColors.greenMint
    "open" -> TaliseColors.accent
    else -> TaliseColors.fgDim // cancelled / expired
}

private fun statusIcon(status: String): ImageVector = when (status) {
    "paid" -> Icons.Filled.CheckCircle
    "open" -> Icons.Filled.Link
    "cancelled" -> Icons.Filled.Cancel
    else -> Icons.Filled.Schedule // expired
}

// MARK: - List states

@Composable
private fun LoadingState() {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
            repeat(3) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(78.dp)
                        .clip(RoundedCornerShape(20.dp))
                        .background(TaliseColors.surface),
                )
            }
        }
        CircularProgressIndicator(color = TaliseColors.fgMuted, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
    }
}

@Composable
private fun ErrorState(msg: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 50.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(msg, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.fgMuted)
    }
}

@Composable
private fun EmptyState() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 44.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(Icons.Filled.QrCode2, contentDescription = null, tint = TaliseColors.fgDim, modifier = Modifier.size(38.dp))
        Text("No requests yet", style = TaliseType.heading(18.sp, FontWeight.Medium), color = TaliseColors.fg)
        Text(
            "Create one to ask someone for a set amount.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            modifier = Modifier.padding(horizontal = 24.dp),
        )
    }
}

// MARK: - Create

@Composable
private fun RequestCreate(onDone: () -> Unit) {
    var amount by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var created by remember { mutableStateOf<RequestCreateResponse?>(null) }
    val scope = rememberCoroutineScope()

    val amountValue = amount.trim().toDoubleOrNull() ?: 0.0
    val canCreate = amountValue > 0 && !creating

    val done = created
    if (done != null) {
        ShareView(res = done, onDone = onDone)
        return
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(TaliseColors.bg)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(top = 8.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        RequestsHeader(
            eyebrow = "REQUEST",
            title = "Request money",
            subtitle = "Ask anyone for a set amount. Share a link or QR, they pay you straight to your wallet.",
        )

        AmountCard(amount = amount, onAmountChange = { amount = it })
        NoteCard(note = note, onNoteChange = { note = it })

        error?.let {
            Text(it, style = TaliseType.body(13.sp, FontWeight.Light), color = TaliseColors.danger)
        }

        CreateButton(
            enabled = canCreate,
            creating = creating,
            onClick = {
                if (!canCreate) return@CreateButton
                creating = true
                error = null
                scope.launch {
                    try {
                        val trimmedNote = note.trim()
                        created = RequestsBackend.service.create(
                            CreateRequestBody(
                                amountUsd = amountValue,
                                currency = null,
                                note = if (trimmedNote.isEmpty()) null else trimmedNote,
                            )
                        )
                    } catch (t: Throwable) {
                        error = "Couldn't create that request. Please try again."
                    } finally {
                        creating = false
                    }
                }
            },
        )

        Text(
            "You'll get a link anyone can open to pay you, no app required.",
            style = TaliseType.mono(11.sp),
            color = TaliseColors.fgMuted,
        )

        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun AmountCard(amount: String, onAmountChange: (String) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .rampCard()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text("AMOUNT", style = TaliseType.mono(10.sp), letterSpacing = 0.6.sp, color = TaliseColors.fgDim)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(54.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(TaliseColors.surface2)
                .padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text("$", style = TaliseType.heading(22.sp, FontWeight.Medium), color = TaliseColors.fgMuted)
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                if (amount.isEmpty()) {
                    Text("20.00", style = TaliseType.heading(22.sp, FontWeight.Medium), color = TaliseColors.fgDim)
                }
                BasicTextField(
                    value = amount,
                    onValueChange = onAmountChange,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    textStyle = TextStyle(
                        fontFamily = TaliseType.sansFamily,
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Medium,
                        color = TaliseColors.fg,
                    ),
                    cursorBrush = SolidColor(TaliseColors.accent),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun NoteCard(note: String, onNoteChange: (String) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .rampCard()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text("NOTE (OPTIONAL)", style = TaliseType.mono(10.sp), letterSpacing = 0.6.sp, color = TaliseColors.fgDim)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(TaliseColors.surface2)
                .padding(horizontal = 14.dp, vertical = 14.dp),
        ) {
            if (note.isEmpty()) {
                Text("e.g. Dinner last night", style = TaliseType.body(15.sp, FontWeight.Normal), color = TaliseColors.fgDim)
            }
            BasicTextField(
                value = note,
                onValueChange = onNoteChange,
                maxLines = 4,
                textStyle = TextStyle(
                    fontFamily = TaliseType.sansFamily,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Normal,
                    color = TaliseColors.fg,
                ),
                cursorBrush = SolidColor(TaliseColors.accent),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun CreateButton(enabled: Boolean, creating: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(54.dp)
            .clip(CircleShape)
            .background(if (enabled) TaliseColors.greenMint else TaliseColors.surface2)
            .alpha(if (enabled) 1f else 0.6f)
            .clickable(enabled = enabled, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (creating) {
            CircularProgressIndicator(color = Color.Black, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(
            if (creating) "Creating…" else "Create request",
            style = TaliseType.body(16.sp, FontWeight.SemiBold),
            color = Color.Black,
        )
    }
}

// MARK: - Share

@Composable
private fun ShareView(res: RequestCreateResponse, onDone: () -> Unit) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    var copied by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(TaliseColors.bg)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Column(
            modifier = Modifier.padding(top = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("Requesting", style = TaliseType.mono(10.sp), letterSpacing = 1.4.sp, color = TaliseColors.fgDim)
            Text(formatUsd2(res.request.amountUsd), style = TaliseType.heading(40.sp, FontWeight.Medium), letterSpacing = (-1).sp, color = TaliseColors.fg)
            val note = res.request.requesterNote
            if (!note.isNullOrEmpty()) {
                Text(note, style = TaliseType.body(14.sp, FontWeight.Light), color = TaliseColors.fgMuted)
            }
        }

        // QR card, the payable link, encoded. Rendered from the bundled hi_qr
        // drawable (no scanner dependency added), matching iOS's 220x220 white card.
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(28.dp))
                .background(TaliseColors.surface)
                .padding(vertical = 26.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(220.dp + 36.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(Color.White)
                    .padding(18.dp),
                contentAlignment = Alignment.Center,
            ) {
                Image(
                    painter = painterResource(R.drawable.hi_qr),
                    contentDescription = "Request QR code",
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.size(220.dp),
                )
            }
            Text(
                prettyLink(res.payUrl),
                style = TaliseType.mono(12.5.sp, FontWeight.Light),
                color = TaliseColors.fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            ShareActionButton(
                icon = if (copied) Icons.Filled.Check else Icons.Filled.ContentCopy,
                label = if (copied) "Copied" else "Copy link",
                primary = false,
                modifier = Modifier.weight(1f),
            ) {
                clipboard.setText(AnnotatedString(res.payUrl))
                copied = true
                scope.launch {
                    delay(1_500)
                    copied = false
                }
            }
            ShareActionButton(
                icon = Icons.Filled.IosShare,
                label = "Share",
                primary = true,
                modifier = Modifier.weight(1f),
            ) {
                shareText(context, res.payUrl)
            }
        }

        Text(
            "Done",
            style = TaliseType.body(14.sp),
            color = TaliseColors.fgMuted,
            modifier = Modifier
                .padding(top = 4.dp)
                .clickable(onClick = onDone),
        )

        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun ShareActionButton(
    icon: ImageVector,
    label: String,
    primary: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val fg = if (primary) TaliseColors.bg else TaliseColors.fg
    Row(
        modifier = modifier
            .height(48.dp)
            .clip(CircleShape)
            .background(if (primary) TaliseColors.fg else TaliseColors.surface2)
            .clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(13.dp))
        Spacer(Modifier.width(8.dp))
        Text(label, style = TaliseType.heading(14.sp, FontWeight.Medium), color = fg)
    }
}

// MARK: - Helpers

/** Two-decimal USD string, mirroring iOS `TaliseFormat.usd2`. */
private fun formatUsd2(v: Double): String = "$" + String.format("%,.2f", v)

/** Stable public pay link for a request slug (talise.io/req/<id>). */
private fun payUrlFor(id: String): String = "https://www.talise.io/req/$id"

/** Drop the scheme for a tidy on-card label ("talise.io/req/…"). */
private fun prettyLink(url: String): String = url
    .replace("https://", "")
    .replace("http://", "")
    .replace("www.", "")

private fun shareText(context: android.content.Context, text: String) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
    }
    context.startActivity(Intent.createChooser(intent, null))
}

// MARK: - Backend (self-contained; same wire as iOS/web)

@Serializable
private data class RequestDTO(
    val id: String,
    val amountUsd: Double,
    val currency: String = "USD",
    val requesterNote: String? = null,
    val status: String = "open",
    val expiresAt: Double? = null,
    val createdAt: Double? = null,
    val paidAt: Double? = null,
    val payDigest: String? = null,
)

@Serializable
private data class RequestsListResponse(val requests: List<RequestDTO> = emptyList())

@Serializable
private data class CreateRequestBody(
    val amountUsd: Double,
    val currency: String? = null,
    val note: String? = null,
)

@Serializable
private data class RequestCreateResponse(
    val ok: Boolean = true,
    val request: RequestDTO,
    val payUrl: String,
)

private interface RequestsService {
    @GET("api/requests")
    suspend fun list(): RequestsListResponse

    @POST("api/requests")
    suspend fun create(@Body body: CreateRequestBody): RequestCreateResponse
}

/**
 * Self-contained Retrofit stack for the Requests endpoints, reuses
 * `ApiClient.json`, `AppConfig.apiBaseUrl`, and the `SecureStore` bearer,
 * mirroring the shared [ApiClient] (which doesn't expose these routes yet).
 */
private object RequestsBackend {
    private val authInterceptor = Interceptor { chain ->
        val builder = chain.request().newBuilder()
        SecureStore.bearer?.let { builder.header("Authorization", "Bearer $it") }
        val response: Response = chain.proceed(builder.build())
        response
    }

    private val okhttp: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(authInterceptor)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val baseUrl: String = AppConfig.apiBaseUrl.let { if (it.endsWith("/")) it else "$it/" }

    val service: RequestsService = Retrofit.Builder()
        .baseUrl(baseUrl)
        .client(okhttp)
        .addConverterFactory(ApiClient.json.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(RequestsService::class.java)
}
