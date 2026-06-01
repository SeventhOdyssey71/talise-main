import SwiftUI

/// Intermediate state for a Send that failed with
/// `ACCUMULATOR_UNDERFUNDED` AND where the server confirmed the user
/// holds `Coin<USDsui>` objects that can be consolidated.
///
/// We don't drop the user on the failure screen — we offer them the
/// one-tap "Enable gasless balance" path instead. Onara pays the
/// (~$0.001 SUI) gas; the user pays nothing. After consolidation lands,
/// every future gasless send works for amounts up to the new
/// accumulator total — including the send the user was just trying to
/// make, which SendFlowView automatically resubmits on success.
///
/// User flow:
///   1. Original send failed → SendFlowView routed here.
///   2. User taps "Enable gasless balance · free" →
///      ZkLoginCoordinator.consolidateToAccumulator runs.
///   3a. Success → SendFlowView immediately resubmits the original
///       send, which now succeeds gasless. User sees the regular
///       success screen — the consolidation is invisible to them
///       beyond the one extra tap.
///   3b. Failure → SendFlowView falls through to the regular failure
///       screen with the underlying error.
///   4. Or: user taps Cancel → falls through to the regular failure
///      screen (same as if consolidation wasn't offered).
struct SendConsolidationOfferView: View {
    @Bindable var draft: SendDraft
    /// Server-blessed total of µ-USDsui in Coin<USDsui> objects (the
    /// amount that will move into the accumulator on tap). Nil falls
    /// back to a generic phrasing. Stored as String because the
    /// underlying value is u64 — outside JS Double safe range for very
    /// large bags.
    var coinBalanceMicros: String?
    /// Called when the user taps the primary button.
    var onEnable: () -> Void
    /// Called when the user taps Cancel.
    var onCancel: () -> Void

    /// Convert micro-USDsui to a friendly dollar string. We don't
    /// bother with locale formatting — the rest of the send flow uses
    /// the user's display currency, but the consolidation amount is
    /// always shown in USDsui so the user can verify it matches what
    /// the chain is about to move.
    private var amountText: String {
        guard let s = coinBalanceMicros, let micros = UInt64(s) else {
            return "Your USDsui"
        }
        let usd = Double(micros) / 1_000_000.0
        return String(format: "$%.2f USDsui", usd)
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: 22) {
                ZStack {
                    Circle()
                        .fill(TaliseColor.accent.opacity(0.12))
                        .frame(width: 96, height: 96)
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 36, weight: .semibold))
                        .foregroundStyle(TaliseColor.accent)
                }

                VStack(spacing: 8) {
                    Text("Enable gasless balance")
                        .font(TaliseFont.heading(34, weight: .medium))
                        .kerning(-1)
                        .foregroundStyle(TaliseColor.fg)
                    Text("\(amountText) is in Coin objects that aren't on the gasless rail. One free tap moves it into your accumulator so every future send is gasless.")
                        .font(TaliseFont.body(14, weight: .light))
                        .foregroundStyle(TaliseColor.fgMuted)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }
            }

            Spacer()

            VStack(spacing: 10) {
                Button(action: onEnable) {
                    HStack(spacing: 8) {
                        Text("Enable gasless balance")
                            .font(TaliseFont.heading(16, weight: .medium))
                        Text("· free")
                            .font(TaliseFont.body(14, weight: .light))
                            .opacity(0.7)
                    }
                    .foregroundStyle(TaliseColor.bg)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(TaliseColor.fg)
                    .clipShape(Capsule())
                }
                Button(action: onCancel) {
                    Text("Cancel")
                        .font(TaliseFont.heading(16, weight: .medium))
                        .foregroundStyle(TaliseColor.fg)
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(
                            Capsule().fill(TaliseColor.surfaceGlass)
                        )
                        .overlay(
                            Capsule().stroke(TaliseColor.line, lineWidth: 0.5)
                        )
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 18)
        }
        .background(TaliseColor.bg.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }
}
