package io.talise.app.feature.profile

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.AlternateEmail
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.PersonOff
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.UnfoldMore
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.outlined.AllInbox
import androidx.compose.material.icons.outlined.MonetizationOn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import coil.compose.SubcomposeAsyncImage
import io.talise.app.BuildConfig
import io.talise.app.core.model.UserDTO
import io.talise.app.core.session.AppSession
import io.talise.app.feature.wallet.TaliseCurrency
import io.talise.app.ui.components.Eyebrow
import io.talise.app.ui.components.LiquidGlassPill
import io.talise.app.ui.nav.Routes
import io.talise.app.ui.theme.TaliseColors
import io.talise.app.ui.theme.TaliseType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Profile tab — exact port of iOS `ProfileView`.
 *
 * Hierarchy:
 *   1. Hero block — big avatar (profile pic or initials) + display name +
 *      claimed `@handle` chip (or claim CTA) + account email.
 *   2. Stats strip — KYC tier x Rewards tier x Points.
 *   3. Wallet section — Sui address + actions (copy, Suiscan).
 *   4. Preferences section — display currency + currency pockets.
 *   5. Help section — support, legal.
 *   6. Sign out — destructive footer button (custom confirm sheet).
 *   7. Delete account link + version footer.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ProfileScreen(nav: NavController, vm: ProfileViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val phase by AppSession.phase.collectAsStateWithLifecycle()
    val user: UserDTO? = (phase as? AppSession.Phase.Ready)?.user ?: AppSession.currentUser

    val clipboard = LocalClipboardManager.current
    val uriHandler = LocalUriHandler.current
    val context = LocalContext.current

    var copiedAddress by remember { mutableStateOf(false) }
    var signOutConfirm by remember { mutableStateOf(false) }
    var deleteConfirm by remember { mutableStateOf(false) }
    var showNftPicker by remember { mutableStateOf(false) }
    var showClaim by remember { mutableStateOf(false) }
    var showIdentity by remember { mutableStateOf(false) }
    var showBankAccounts by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { CurrencySettings.load(context) }
    LaunchedEffect(copiedAddress) {
        if (copiedAddress) {
            delay(1500)
            copiedAddress = false
        }
    }
    // Close the confirm sheet so the failure alert shows (iOS sets deleteConfirm = false).
    LaunchedEffect(state.deleteError) { if (state.deleteError != null) deleteConfirm = false }

    Column(
        Modifier
            .fillMaxSize()
            .background(TaliseColors.bg)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp)
            .padding(top = 12.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp),
    ) {
        Hero(
            user = user,
            onEditAvatar = { showNftPicker = true },
            onClaim = { showClaim = true },
        )
        StatsStrip(kyc = state.kyc, rewards = state.rewards)
        WalletSection(
            address = user?.suiAddress,
            copied = copiedAddress,
            onCopy = {
                user?.suiAddress?.let {
                    clipboard.setText(AnnotatedString(it))
                    copiedAddress = true
                }
            },
            onSuiscan = {
                user?.suiAddress?.let { uriHandler.openUri("https://suiscan.xyz/mainnet/account/$it") }
            },
        )
        if (PROFILE_KYC_ENABLED) {
            VerificationSection(kyc = state.kyc, onClick = { showIdentity = true })
        }
        // Bank-account linking deferred — entry removed for now (mirrors iOS).
        PreferencesSection(onPockets = { nav.navigate(Routes.WALLET) })
        HelpSection(
            onSupport = { openSupport(context, onFallback = { uriHandler.openUri("https://talise.io") }) },
            onOpen = { uriHandler.openUri(it) },
        )
        SignOutButton(onClick = { signOutConfirm = true })
        DeleteAccountLink(enabled = !state.deletingAccount, onClick = { deleteConfirm = true })
        VersionFooter()
        Spacer(Modifier.height(140.dp))
    }

    // Clean custom sign-out sheet — calm, on-brand, reassures that the
    // self-custodial wallet is safe.
    if (signOutConfirm) {
        ModalBottomSheet(
            onDismissRequest = { signOutConfirm = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = TaliseColors.bg,
        ) {
            SignOutSheet(
                onConfirm = { AppSession.signOut() },
                onDismiss = { signOutConfirm = false },
            )
        }
    }

    // Account deletion (Guideline 5.1.1(v)) — clean confirmation sheet with the
    // consequences laid out; the wallet is self-custodial so "withdraw first" is
    // unmistakable.
    if (deleteConfirm) {
        ModalBottomSheet(
            onDismissRequest = { if (!state.deletingAccount) deleteConfirm = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = TaliseColors.bg,
        ) {
            DeleteAccountSheet(
                deleting = state.deletingAccount,
                onConfirm = { vm.deleteAccount() },
                onDismiss = { deleteConfirm = false },
            )
        }
    }

    state.deleteError?.let { err ->
        AlertDialog(
            onDismissRequest = { vm.clearDeleteError() },
            containerColor = TaliseColors.surface,
            title = {
                Text(
                    "Couldn't delete account",
                    style = TaliseType.heading(17.sp, FontWeight.Medium),
                    color = TaliseColors.fg,
                )
            },
            text = {
                Text(err, style = TaliseType.body(14.sp, FontWeight.Light), color = TaliseColors.fgMuted)
            },
            confirmButton = {
                TextButton(onClick = { vm.clearDeleteError() }) {
                    Text("OK", style = TaliseType.body(14.sp, FontWeight.Medium), color = TaliseColors.accent)
                }
            },
        )
    }

    if (showNftPicker) {
        ModalBottomSheet(
            onDismissRequest = { showNftPicker = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = TaliseColors.bg,
        ) {
            NftPickerSheet(
                currentPfp = user?.pfpUrl,
                onChanged = { vm.refreshUser() },
                onDismiss = { showNftPicker = false },
            )
        }
    }

    if (showClaim) {
        ClaimHandleSheet(
            user = user,
            onClaimed = { vm.refreshUser() },
            onDismiss = { showClaim = false },
        )
    }

    if (showIdentity) {
        IdentityVerificationSheet(
            onDismiss = {
                showIdentity = false
                vm.loadKyc()
            },
        )
    }

    if (showBankAccounts) {
        BankAccountsSheet(onDismiss = { showBankAccounts = false })
    }
}

// MARK: - Hero

/**
 * Hero CARD (2026-06-10 restyle): one solid forest card with the avatar centered,
 * the name, the handle chip, and the account email — identity at a glance.
 */
@Composable
private fun Hero(user: UserDTO?, onEditAvatar: () -> Unit, onClaim: () -> Unit) {
    val forest = Brush.linearGradient(listOf(Color(0xFF3A6E2A), Color(0xFF224417)))
    val shape = RoundedCornerShape(26.dp)
    Column(
        Modifier
            .padding(top = 4.dp)
            .fillMaxWidth()
            .clip(shape)
            .background(forest, shape)
            .border(1.dp, Color.White.copy(alpha = 0.08f), shape)
            .padding(vertical = 26.dp, horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        HeroAvatar(user = user, onClick = onEditAvatar)
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Text(
                user?.name ?: "-",
                style = TaliseType.heading(21.sp, FontWeight.SemiBold),
                letterSpacing = (-0.5).sp,
                color = Color.White,
                maxLines = 1,
            )
            HandleLine(handle = user?.taliseHandle, onClaim = onClaim)
            // Apple hide-my-email users get gibberish relay addresses — label the
            // sign-in method instead.
            val email = user?.email ?: ""
            Text(
                if (email.lowercase().endsWith("@privaterelay.appleid.com"))
                    "Signed in with Apple · private email"
                else email,
                style = TaliseType.mono(11.sp, FontWeight.Light),
                color = Color.White.copy(alpha = 0.6f),
                maxLines = 1,
            )
        }
    }
}

/** 88dp avatar — profile picture (avatar override preferred) or initials disc, with an edit badge. */
@Composable
private fun HeroAvatar(user: UserDTO?, onClick: () -> Unit) {
    val initials = profileInitials(user)
    Box(
        Modifier
            .size(88.dp)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            ),
    ) {
        val url = user?.pfpUrl ?: user?.picture
        Box(
            Modifier
                .size(88.dp)
                .clip(CircleShape)
                .border(2.dp, Color.White.copy(alpha = 0.25f), CircleShape),
        ) {
            if (url != null) {
                SubcomposeAsyncImage(
                    model = url,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(88.dp).clip(CircleShape),
                    loading = { InitialsDisc(initials) },
                    error = { InitialsDisc(initials) },
                )
            } else {
                InitialsDisc(initials)
            }
        }
        // "edit avatar" affordance
        Box(
            Modifier
                .align(Alignment.BottomEnd)
                .size(26.dp)
                .clip(CircleShape)
                .background(TaliseColors.greenMint)
                .border(2.dp, Color(0xFF224417), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.Edit,
                contentDescription = null,
                tint = Color(0xFF224417),
                modifier = Modifier.size(12.dp),
            )
        }
    }
}

/** Avatar fallback — a flat solid disc carrying the user's initials. */
@Composable
private fun InitialsDisc(initials: String) {
    Box(
        Modifier.size(88.dp).clip(CircleShape).background(TaliseColors.surface2),
        contentAlignment = Alignment.Center,
    ) {
        Text(initials, style = TaliseType.heading(32.sp, FontWeight.Medium), color = TaliseColors.fg)
    }
}

/** `handle@talise` chip with the green check, or a "Claim your name" CTA. */
@Composable
private fun HandleLine(handle: String?, onClaim: () -> Unit) {
    if (!handle.isNullOrEmpty()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.12f), CircleShape)
                .padding(horizontal = 11.dp, vertical = 5.dp),
        ) {
            Icon(
                Icons.Filled.Verified,
                contentDescription = null,
                tint = TaliseColors.greenMint,
                modifier = Modifier.size(12.dp),
            )
            Text(
                "$handle@talise",
                style = TaliseType.mono(12.sp),
                color = Color.White.copy(alpha = 0.9f),
            )
        }
    } else {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier.clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClaim,
            ),
        ) {
            Text(
                "Claim your name",
                style = TaliseType.body(13.sp, FontWeight.Light),
                color = TaliseColors.greenMint,
            )
            Icon(
                Icons.AutoMirrored.Filled.OpenInNew,
                contentDescription = null,
                tint = TaliseColors.greenMint,
                modifier = Modifier.size(11.dp),
            )
        }
    }
}

// MARK: - Stats strip

/** A single card divided into three equal columns by 1dp hairlines. */
@Composable
private fun StatsStrip(kyc: KycStatus?, rewards: ProfileRewardsSummary?) {
    val tierLabel = rewards?.tier?.label ?: "Bronze"
    val points = rewards?.pointsTotal ?: 0
    Row(
        Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .clip(RoundedCornerShape(20.dp))
            .background(TaliseColors.surface, RoundedCornerShape(20.dp)),
    ) {
        StatCell(
            label = "KYC",
            value = if (PROFILE_KYC_ENABLED) (kyc ?: KycStatus.UNVERIFIED).label else "-",
            accent = PROFILE_KYC_ENABLED && kyc == KycStatus.APPROVED,
            modifier = Modifier.weight(1f),
        )
        StatDivider()
        StatCell(label = "Rewards", value = tierLabel, accent = tierLabel != "Bronze", modifier = Modifier.weight(1f))
        StatDivider()
        StatCell(
            label = "Points",
            value = "%,d".format(points),
            accent = points > 0,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun StatCell(label: String, value: String, accent: Boolean, modifier: Modifier = Modifier) {
    Column(
        modifier.padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Eyebrow(label)
        Text(
            value,
            style = TaliseType.heading(14.sp, FontWeight.Medium),
            color = if (accent) TaliseColors.accent else TaliseColors.fg,
            maxLines = 1,
        )
    }
}

@Composable
private fun StatDivider() {
    Box(
        Modifier
            .width(1.dp)
            .fillMaxHeight()
            .padding(vertical = 12.dp)
            .background(TaliseColors.line),
    )
}

// MARK: - Wallet section

@Composable
private fun WalletSection(
    address: String?,
    copied: Boolean,
    onCopy: () -> Unit,
    onSuiscan: () -> Unit,
) {
    ProfileSection(title = "Wallet") {
        Column {
            // Address row — mono, middle-truncated so both the 0x prefix and the
            // last 4 chars are always visible.
            Text(
                address?.let(::middleTruncate) ?: "-",
                style = TaliseType.mono(12.sp, FontWeight.Light),
                color = TaliseColors.fg,
                maxLines = 1,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp, vertical = 14.dp),
            )
            SectionDivider()
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                LiquidGlassPill(title = if (copied) "Copied" else "Copy", onClick = onCopy)
                LiquidGlassPill(title = "Suiscan", onClick = onSuiscan)
            }
        }
    }
}

// MARK: - Bank accounts section
//
// Off-ramp Phase 2 entry — a single row that opens the bank-account management
// screen (link / list / remove). Deferred on iOS too; kept here so restoring the
// entry is one call-site flip (place it between Wallet and Preferences).

@Suppress("unused")
@Composable
private fun BankAccountsSection(onClick: () -> Unit) {
    ProfileSection(title = "Cash out") {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(horizontal = 18.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.width(22.dp), contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Filled.AccountBalance,
                    contentDescription = null,
                    tint = TaliseColors.fgMuted,
                    modifier = Modifier.size(16.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Text(
                "Bank accounts",
                style = TaliseType.body(14.sp, FontWeight.Light),
                color = TaliseColors.fg,
                modifier = Modifier.weight(1f),
            )
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = TaliseColors.fgDim,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

// MARK: - Verification section (Bridge identity KYC — gated off, mirrors iOS)

@Composable
private fun VerificationSection(kyc: KycStatus?, onClick: () -> Unit) {
    ProfileSection(title = "Cash out") {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(horizontal = 18.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.width(22.dp), contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Filled.VerifiedUser,
                    contentDescription = null,
                    tint = TaliseColors.fgMuted,
                    modifier = Modifier.size(16.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Text(
                "Identity verification",
                style = TaliseType.body(14.sp, FontWeight.Light),
                color = TaliseColors.fg,
                modifier = Modifier.weight(1f),
            )
            Text(
                (kyc ?: KycStatus.UNVERIFIED).label,
                style = TaliseType.mono(11.sp),
                color = if (kyc == KycStatus.APPROVED) TaliseColors.greenMint else TaliseColors.fgMuted,
            )
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = TaliseColors.fgDim,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

// MARK: - Preferences section

@Composable
private fun PreferencesSection(onPockets: () -> Unit) {
    ProfileSection(title = "Preferences") {
        Column {
            CurrencyRow()
            SectionDivider()
            PocketsRow(onClick = onPockets)
        }
    }
}

@Composable
private fun CurrencyRow() {
    val context = LocalContext.current
    val current by CurrencySettings.current
    var menuOpen by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable { menuOpen = true }
                .padding(horizontal = 18.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ProfileRowLabel(title = "Display currency", icon = Icons.Outlined.MonetizationOn)
            Spacer(Modifier.weight(1f))
            // Capsule chip — symbol + code + up/down chevron, same recipe as iOS.
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier
                    .clip(CircleShape)
                    .background(TaliseColors.surface2, CircleShape)
                    .padding(horizontal = 10.dp, vertical = 6.dp),
            ) {
                Text(current.symbol, style = TaliseType.heading(13.sp, FontWeight.Medium), color = TaliseColors.fg)
                Text(current.code, style = TaliseType.mono(11.sp, FontWeight.Light), color = TaliseColors.fgMuted)
                Icon(
                    Icons.Filled.UnfoldMore,
                    contentDescription = null,
                    tint = TaliseColors.fgDim,
                    modifier = Modifier.size(12.dp),
                )
            }
        }
        DropdownMenu(
            expanded = menuOpen,
            onDismissRequest = { menuOpen = false },
            modifier = Modifier.background(TaliseColors.surface2),
        ) {
            TaliseCurrency.allSupported.forEach { c ->
                DropdownMenuItem(
                    text = {
                        Text(
                            "${c.symbol}  ${c.name}",
                            style = TaliseType.body(14.sp),
                            color = TaliseColors.fg,
                        )
                    },
                    leadingIcon = {
                        if (c.code == current.code) {
                            Icon(
                                Icons.Filled.Check,
                                contentDescription = null,
                                tint = TaliseColors.accent,
                                modifier = Modifier.size(16.dp),
                            )
                        }
                    },
                    onClick = {
                        CurrencySettings.set(context, c)
                        menuOpen = false
                    },
                )
            }
        }
    }
}

/** Entry into the multi-currency pockets surface (master plan §8). */
@Composable
private fun PocketsRow(onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ProfileRowLabel(title = "Currency pockets", icon = Icons.Outlined.AllInbox)
        Spacer(Modifier.weight(1f))
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = TaliseColors.fgDim,
            modifier = Modifier.size(18.dp),
        )
    }
}

// MARK: - Help section

@Composable
private fun HelpSection(onSupport: () -> Unit, onOpen: (String) -> Unit) {
    ProfileSection(title = "Help") {
        Column {
            LinkRow(Icons.AutoMirrored.Filled.HelpOutline, "Support", onSupport)
            SectionDivider()
            // App Review requires Privacy Policy + Terms reachable in-app as
            // distinct destinations (Guidelines 5.1.1 / 5.1.2).
            LinkRow(Icons.Filled.Shield, "Privacy Policy") { onOpen("https://talise.io/privacy") }
            SectionDivider()
            LinkRow(Icons.Filled.Description, "Terms of Service") { onOpen("https://talise.io/terms") }
        }
    }
}

@Composable
private fun LinkRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(22.dp), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = TaliseColors.fgMuted, modifier = Modifier.size(16.dp))
        }
        Spacer(Modifier.width(12.dp))
        Text(
            label,
            style = TaliseType.body(14.sp, FontWeight.Light),
            color = TaliseColors.fg,
            modifier = Modifier.weight(1f),
        )
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = TaliseColors.fgDim,
            modifier = Modifier.size(18.dp),
        )
    }
}

// MARK: - Sign-out + delete + version footer

@Composable
private fun SignOutButton(onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(50.dp)
            .clip(CircleShape)
            .background(TaliseColors.surface2, CircleShape)
            .clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Icon(
            Icons.AutoMirrored.Filled.Logout,
            contentDescription = null,
            tint = SignOutRed,
            modifier = Modifier.size(16.dp),
        )
        Spacer(Modifier.width(8.dp))
        Text("Sign out", style = TaliseType.heading(15.sp, FontWeight.Medium), color = SignOutRed)
    }
}

/**
 * "Delete account" — a calm, de-emphasized text link (NOT a loud red button). The
 * weight lives in the confirmation sheet, not the trigger. Required in-app entry
 * point for account deletion (Guideline 5.1.1(v)).
 */
@Composable
private fun DeleteAccountLink(enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(32.dp)
            .clickable(enabled = enabled, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Text(
            "Delete account",
            style = TaliseType.body(13.sp),
            color = TaliseColors.fgDim,
            textDecoration = TextDecoration.Underline,
        )
    }
}

@Composable
private fun VersionFooter() {
    Row(
        Modifier.fillMaxWidth().padding(top = 4.dp),
        horizontalArrangement = Arrangement.Center,
    ) {
        Text(
            "Talise · v${BuildConfig.VERSION_NAME}",
            style = TaliseType.mono(8.sp),
            letterSpacing = 1.sp,
            color = TaliseColors.fgDim,
        )
    }
}

// MARK: - Layout helpers

/** Section with an outside eyebrow title sitting 8dp above a flat solid card. */
@Composable
internal fun ProfileSection(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Eyebrow(title)
        Box(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(20.dp))
                .background(TaliseColors.surface, RoundedCornerShape(20.dp)),
        ) { content() }
    }
}

/** Inter-row hairline used inside section cards — iOS `LiquidGlassDivider(inset: 18)`. */
@Composable
internal fun SectionDivider() {
    Box(
        Modifier
            .fillMaxWidth()
            .padding(start = 18.dp)
            .height(1.dp)
            .background(TaliseColors.line),
    )
}

/** Row label — single line with an optional leading icon (iOS `rowLabel`). */
@Composable
private fun ProfileRowLabel(title: String, subtitle: String? = null, icon: ImageVector? = null) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (icon != null) {
            Box(Modifier.width(22.dp), contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = null, tint = TaliseColors.fgMuted, modifier = Modifier.size(16.dp))
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = TaliseType.body(14.sp, FontWeight.Light), color = TaliseColors.fg)
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = TaliseType.mono(10.sp, FontWeight.Light),
                    color = TaliseColors.fgDim,
                    maxLines = 1,
                )
            }
        }
    }
}

// MARK: - Sign-out confirmation sheet

/** Muted red shared by the sign-out affordances (iOS `Color(hex: 0xE08D8A)`). */
private val SignOutRed = Color(0xFFE08D8A)

/**
 * Clean, on-brand sign-out confirmation — replaces the default system alert. Calm
 * (sign-out isn't destructive): mint accent, reassures the self-custodial wallet is
 * untouched and re-entry is one Google sign-in away.
 */
@Composable
private fun SignOutSheet(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().height(300.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .padding(top = 10.dp)
                .size(64.dp)
                .clip(CircleShape)
                .background(TaliseColors.accent.copy(alpha = 0.14f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.AutoMirrored.Filled.Logout,
                contentDescription = null,
                tint = TaliseColors.accent,
                modifier = Modifier.size(24.dp),
            )
        }
        Text(
            "Sign out?",
            style = TaliseType.heading(22.sp, FontWeight.Medium),
            letterSpacing = (-0.4).sp,
            color = TaliseColors.fg,
            modifier = Modifier.padding(top = 16.dp),
        )
        Text(
            "Your wallet stays safe. Sign back in anytime.",
            style = TaliseType.body(14.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 32.dp).padding(top = 8.dp),
        )
        Spacer(Modifier.weight(1f))
        Column(
            Modifier.padding(horizontal = 22.dp).padding(bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(52.dp)
                    .clip(CircleShape)
                    .background(TaliseColors.surface2, CircleShape)
                    .clickable(onClick = onConfirm),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
            ) {
                Text("Sign out", style = TaliseType.body(16.sp, FontWeight.SemiBold), color = SignOutRed)
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .clickable(onClick = onDismiss),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
            ) {
                Text("Stay signed in", style = TaliseType.body(15.sp, FontWeight.Medium), color = TaliseColors.fgMuted)
            }
        }
    }
}

// MARK: - Delete account confirmation sheet

/**
 * A calm, on-brand confirmation — leads with the ONE thing that matters (withdraw
 * first; the wallet is self-custodial), lists the consequences cleanly, and keeps
 * the destructive action a deliberate second tap.
 */
@Composable
private fun DeleteAccountSheet(deleting: Boolean, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val points = listOf(
        Icons.Filled.AlternateEmail to "Releases your @handle and removes linked bank accounts.",
        Icons.Filled.History to "Some records are kept where the law requires.",
        Icons.Filled.Block to "This can't be undone.",
    )
    Column(
        Modifier.fillMaxWidth().height(560.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .padding(top = 8.dp)
                .size(64.dp)
                .clip(CircleShape)
                .background(TaliseColors.danger.copy(alpha = 0.12f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.PersonOff,
                contentDescription = null,
                tint = TaliseColors.danger,
                modifier = Modifier.size(26.dp),
            )
        }
        Text(
            "Delete your account?",
            style = TaliseType.heading(22.sp, FontWeight.Medium),
            letterSpacing = (-0.4).sp,
            color = TaliseColors.fg,
            modifier = Modifier.padding(top = 16.dp),
        )
        // The one thing that matters most.
        Text(
            buildAnnotatedString {
                append("Your wallet is self-custodial. ")
                withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) {
                    append("Withdraw or transfer your balance first.")
                }
                append(" You'll need a new account to use it here again.")
            },
            style = TaliseType.body(14.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 28.dp).padding(top = 10.dp),
        )
        Column(
            Modifier
                .padding(horizontal = 22.dp)
                .padding(top = 22.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(TaliseColors.surface, RoundedCornerShape(18.dp))
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            points.forEach { (icon, text) ->
                Row(
                    verticalAlignment = Alignment.Top,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box(Modifier.width(18.dp), contentAlignment = Alignment.Center) {
                        Icon(icon, contentDescription = null, tint = TaliseColors.fgDim, modifier = Modifier.size(14.dp))
                    }
                    Text(
                        text,
                        style = TaliseType.body(13.5.sp, FontWeight.Light),
                        color = TaliseColors.fgMuted,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
        Spacer(Modifier.weight(1f))
        Column(
            Modifier.padding(horizontal = 22.dp).padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(52.dp)
                    .clip(CircleShape)
                    .background(TaliseColors.danger, CircleShape)
                    .clickable(enabled = !deleting, onClick = onConfirm),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            ) {
                if (deleting) {
                    CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
                }
                Text(
                    if (deleting) "Deleting…" else "Delete account",
                    style = TaliseType.body(16.sp, FontWeight.SemiBold),
                    color = Color.White,
                )
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(50.dp)
                    .clickable(enabled = !deleting, onClick = onDismiss),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
            ) {
                Text("Keep my account", style = TaliseType.body(15.sp, FontWeight.Medium), color = TaliseColors.fg)
            }
        }
    }
}

// MARK: - NFT avatar picker

/**
 * Pick a Sui NFT from the wallet as the profile picture. Loads `/api/me/nfts`,
 * sets the choice via `/api/me/avatar`, and (when an override already exists)
 * offers to remove it back to the Google photo.
 */
@Composable
private fun NftPickerSheet(currentPfp: String?, onChanged: () -> Unit, onDismiss: () -> Unit) {
    var nfts by remember { mutableStateOf<List<NftItem>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        loading = true
        nfts = runCatching { profileApi.nfts().nfts }.getOrDefault(emptyList())
        loading = false
    }

    fun save(body: AvatarBody) {
        if (saving) return
        saving = true
        scope.launch {
            runCatching { profileApi.setAvatar(body) }
            saving = false
            onChanged()
            onDismiss()
        }
    }

    Column(Modifier.fillMaxWidth().fillMaxHeight(0.92f)) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(top = 10.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Choose a picture",
                style = TaliseType.heading(20.sp, FontWeight.Medium),
                color = TaliseColors.fg,
                modifier = Modifier.weight(1f),
            )
            if (currentPfp != null) {
                Text(
                    "Remove",
                    style = TaliseType.body(14.sp, FontWeight.Medium),
                    color = TaliseColors.danger,
                    modifier = Modifier.clickable(enabled = !saving) { save(AvatarBody(clear = true)) },
                )
            }
        }
        Text(
            "Pick an NFT from your wallet.",
            style = TaliseType.body(13.sp, FontWeight.Light),
            color = TaliseColors.fgMuted,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 14.dp),
        )
        when {
            loading -> {
                Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = TaliseColors.greenMint, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
                }
            }
            nfts.isEmpty() -> {
                Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            Icons.Filled.PhotoLibrary,
                            contentDescription = null,
                            tint = TaliseColors.fgDim,
                            modifier = Modifier.size(30.dp),
                        )
                        Text(
                            "No NFTs in your wallet yet",
                            style = TaliseType.body(14.sp, FontWeight.Light),
                            color = TaliseColors.fgMuted,
                        )
                    }
                }
            }
            else -> {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(3),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 28.dp),
                    modifier = Modifier.weight(1f),
                ) {
                    items(nfts, key = { it.objectId }) { nft ->
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(108.dp)
                                .clip(RoundedCornerShape(16.dp))
                                .background(TaliseColors.surface2, RoundedCornerShape(16.dp))
                                .border(1.dp, TaliseColors.line, RoundedCornerShape(16.dp))
                                .clickable(enabled = !saving) { save(AvatarBody(imageUrl = nft.imageUrl)) },
                        ) {
                            SubcomposeAsyncImage(
                                model = nft.imageUrl,
                                contentDescription = nft.name,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.fillMaxSize(),
                                loading = { Box(Modifier.fillMaxSize().background(TaliseColors.surface2)) },
                                error = { Box(Modifier.fillMaxSize().background(TaliseColors.surface2)) },
                            )
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Data helpers

private fun profileInitials(user: UserDTO?): String {
    user?.taliseHandle?.firstOrNull()?.let { return it.uppercaseChar().toString() }
    user?.name?.trim()?.split(" ")?.firstOrNull()?.firstOrNull()?.let { return it.uppercaseChar().toString() }
    user?.email?.substringBefore("@")?.firstOrNull()?.let { return it.uppercaseChar().toString() }
    return "·"
}

/** Middle truncation so the 0x prefix and last 4 chars are always visible (iOS `.truncationMode(.middle)`). */
private fun middleTruncate(a: String, max: Int = 34): String =
    if (a.length <= max) a else a.take(max - 5) + "…" + a.takeLast(4)

/**
 * Support: open the mail composer pre-addressed to Talise support with a subject.
 * Falls back to the website when no mail app is available — Support always does
 * something instead of feeling broken.
 */
private fun openSupport(context: android.content.Context, onFallback: () -> Unit) {
    try {
        val subject = Uri.encode("Talise support")
        val intent = Intent(Intent.ACTION_SENDTO).apply {
            data = Uri.parse("mailto:support@talise.io?subject=$subject")
        }
        context.startActivity(intent)
    } catch (_: Exception) {
        onFallback()
    }
}
