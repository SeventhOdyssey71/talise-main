package io.talise.app.ui.nav

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CardGiftcard
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.outlined.Spa
import androidx.compose.ui.graphics.vector.ImageVector

/** Top-level navigation routes (NavHost destinations beyond the tab scaffold). */
object Routes {
    const val MAIN = "main"
    const val MOVE_MONEY = "move_money"
    const val DEPOSIT = "deposit"
    const val PAYROLL = "payroll"
    const val SEND = "send"
    const val COPILOT = "copilot"
}

/** The four bottom-nav tabs — Home / Invest / Rewards / Profile, mirroring iOS `MainTabView`. */
enum class TaliseTab(val label: String, val icon: ImageVector) {
    Home("Home", Icons.Filled.Home),
    Invest("Invest", Icons.Outlined.Spa),
    Rewards("Rewards", Icons.Filled.CardGiftcard),
    Profile("Profile", Icons.Filled.Person),
}
