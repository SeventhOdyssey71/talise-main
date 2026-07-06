package io.talise.app.ui.nav

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import io.talise.app.core.session.AppSession
import io.talise.app.feature.chat.ChatScreen
import io.talise.app.feature.deposit.DepositScreen
import io.talise.app.feature.movemoney.MoveMoneyScreen
import io.talise.app.feature.onboarding.SignInScreen
import io.talise.app.feature.receive.ReceiveScreen
import io.talise.app.feature.wallet.WalletScreen
import io.talise.app.feature.ramps.RampsScreen
import io.talise.app.feature.kyc.KycScreen
import io.talise.app.feature.scan.ScanScreen
import io.talise.app.feature.cheques.ChequesScreen
import io.talise.app.feature.stream.StreamScreen
import io.talise.app.feature.pin.PinEntryScreen
import io.talise.app.feature.invoices.InvoicesScreen
import io.talise.app.feature.contracts.ContractsScreen
import io.talise.app.feature.requests.RequestsScreen
import io.talise.app.feature.rules.RulesScreen
import io.talise.app.feature.payroll.PayrollScreen
import io.talise.app.feature.send.SendFlow
import io.talise.app.ui.theme.TaliseColors

/**
 * Phase router — the Android equivalent of iOS `AppRoot`. Renders off [AppSession.phase]:
 *   Launching → splash · SignedOut/Onboarding → SignIn · Ready → the tab scaffold + flows.
 */
@Composable
fun TaliseRoot() {
    val phase by AppSession.phase.collectAsStateWithLifecycle()

    when (phase) {
        is AppSession.Phase.Launching -> Splash()
        is AppSession.Phase.SignedOut -> SignInScreen()
        // A signed-in but not-yet-onboarded user enters the app and claims their
        // @handle from Home (matching iOS), rather than bouncing back to SignIn.
        is AppSession.Phase.Onboarding -> MainNavHost()
        is AppSession.Phase.Ready -> MainNavHost()
    }
}

@Composable
private fun MainNavHost() {
    val nav = rememberNavController()
    NavHost(navController = nav, startDestination = Routes.MAIN) {
        composable(Routes.MAIN) { MainScaffold(nav) }
        composable(Routes.MOVE_MONEY) { MoveMoneyScreen(nav) }
        composable(Routes.DEPOSIT) { DepositScreen(onClose = { nav.popBackStack() }) }
        composable(Routes.PAYROLL) { PayrollScreen(onClose = { nav.popBackStack() }) }
        composable(Routes.SEND) { SendFlow(onClose = { nav.popBackStack() }) }
        composable(Routes.COPILOT) { ChatScreen(onClose = { nav.popBackStack() }) }
        composable(Routes.RECEIVE) { ReceiveScreen(onClose = { nav.popBackStack() }) }
        composable(Routes.WALLET) { WalletScreen(onClose = { nav.popBackStack() }) }
        composable(Routes.RAMPS) { RampsScreen(onClose = { nav.popBackStack() }) }
        composable(Routes.KYC) { KycScreen(onClose = { nav.popBackStack() }) }
        composable(Routes.SCAN) { ScanScreen(onClose = { nav.popBackStack() }) }
        composable(Routes.CHEQUES) { ChequesScreen(onClose = { nav.popBackStack() }) }
        composable(Routes.STREAM) { StreamScreen(onClose = { nav.popBackStack() }) }
        composable(Routes.PIN) { PinEntryScreen(onComplete = { nav.popBackStack() }, onClose = { nav.popBackStack() }) }
        composable(Routes.INVOICES) { InvoicesScreen(onClose = { nav.popBackStack() }) }
        composable(Routes.CONTRACTS) { ContractsScreen(onClose = { nav.popBackStack() }) }
        composable(Routes.REQUESTS) { RequestsScreen(onClose = { nav.popBackStack() }) }
        composable(Routes.RULES) { RulesScreen(onClose = { nav.popBackStack() }) }
    }
}

@Composable
private fun Splash() {
    Box(Modifier.fillMaxSize().background(TaliseColors.bg), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = TaliseColors.accent)
    }
}
