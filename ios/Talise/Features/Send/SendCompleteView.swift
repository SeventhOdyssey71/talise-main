import SwiftUI
import UIKit

/// Step 5: success. Renders the Figma "Successful PopUp" (node 132:2)
/// celebration — pastel-green field, coin-stack illustration, the sent
/// amount in the user's currency, "gas cost = 0 / money arrives < 1s",
/// and a Share Receipt + Done row. `onDone` lets the parent dismiss the
/// whole Send flow.
struct SendCompleteView: View {
    @Bindable var draft: SendDraft
    var onDone: () -> Void

    var body: some View {
        // Amount in the user's display currency (USDsui is 1:1 USD).
        // local2 mirrors what the rest of the app shows so a ₦ user
        // sees ₦ here, a $ user sees $.
        let amountText = TaliseFormat.local2(draft.success?.usdsui ?? draft.amountUsdsui)
        SuccessfulTxView(
            amountText: amountText,
            title: successTitle,
            subtitle: successSubtitle,
            onShareReceipt: shareReceipt,
            onDone: onDone
        )
        .toolbar(.hidden, for: .navigationBar)
    }

    /// Headline. Same-currency wallet sends keep the default
    /// celebration; cross-border fiat-payout sends say "Sent" to mark
    /// the chain leg as final WITHOUT overclaiming bank delivery
    /// (master plan §8: "sent" ≠ "landed in their bank").
    private var successTitle: String {
        guard draft.isCrossCurrency else { return "Transaction Successful!" }
        return "Sent"
    }

    /// Subtitle. Same-currency: the gasless wallet-to-wallet line.
    /// Cross-border: honest "on its way to their bank" copy — the chain
    /// send is final and irreversible, but the local payout rail hasn't
    /// confirmed, so we never claim "delivered" here. Home's optimistic
    /// stub resolves to "Delivered" on the payout webhook.
    private var successSubtitle: String {
        guard draft.isCrossCurrency else {
            return "gas cost = 0, money arrives < 1s"
        }
        let name = draft.success?.recipientDisplay ?? "their bank"
        return "Sent — on its way to \(name)'s bank"
    }

    /// Share the on-chain explorer link for this payment via the system
    /// share sheet. No-op if we somehow reached this screen without a
    /// digest (shouldn't happen — .complete is gated on a real digest).
    private func shareReceipt() {
        guard let digest = draft.success?.digest, !digest.isEmpty else { return }
        let url = "https://suivision.xyz/txblock/\(digest)"
        let av = UIActivityViewController(
            activityItems: [URL(string: url) ?? url],
            applicationActivities: nil
        )
        guard let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive }),
              let root = scene.keyWindow?.rootViewController else { return }
        // Walk to the top-most presented controller so the share sheet
        // mounts above the Send fullScreenCover.
        var top = root
        while let presented = top.presentedViewController { top = presented }
        av.popoverPresentationController?.sourceView = top.view
        top.present(av, animated: true)
    }
}
