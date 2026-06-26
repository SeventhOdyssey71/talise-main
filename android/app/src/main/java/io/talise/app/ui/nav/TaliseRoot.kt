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
import io.talise.app.feature.deposit.DepositScreen
import io.talise.app.feature.movemoney.MoveMoneyScreen
import io.talise.app.feature.onboarding.SignInScreen
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
        is AppSession.Phase.Onboarding -> SignInScreen() // handle-claim/onboarding lands here (phase 1)
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
    }
}

@Composable
private fun Splash() {
    Box(Modifier.fillMaxSize().background(TaliseColors.bg), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = TaliseColors.accent)
    }
}
