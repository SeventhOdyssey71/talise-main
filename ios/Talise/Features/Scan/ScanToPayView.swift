import SwiftUI

/// Full-screen Scan-to-Pay surface. The user lands here from the Home
/// top-right disc (the slot previously occupied by Contacts). This is the
/// *visual* stub — there is intentionally no AVCaptureSession wired up.
///
/// The live camera feed mounts at the `TODO(scan-camera)` site below.
/// Permission gating (NSCameraUsageDescription + AVCaptureDevice
/// authorizationStatus) is unlocked by the Permissions onboarding screen,
/// so by the time the camera plumbing lands here the user will have
/// already granted access in onboarding. Until then: black background +
/// corner-bracket viewfinder + balance pill + dismiss affordance.
struct ScanToPayView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var balance: BalancesDTO?
    @State private var flashOn = false

    /// Same formatter HomeView uses for the headline figure — keeps the
    /// pill consistent with the user's "Balance $X.XX" elsewhere in the
    /// app. Empty wallet renders as "$0.00".
    private var balanceFormatted: String {
        TaliseFormat.local2(balance?.usdsui ?? 0)
    }

    var body: some View {
        ZStack {
            // Black backdrop — the camera preview layer will replace this
            // when wired (it lives behind every overlay, full-bleed, so
            // the corner brackets sit *on top* of the live frame).
            Color.black.ignoresSafeArea()

            // TODO(scan-camera): mount AVCaptureVideoPreviewLayer here,
            // ignoringSafeArea, with the AVCaptureMetadataOutput wired
            // to .qr. Permission grant comes from onboarding (other
            // agent's territory). Keep the overlays (status bar + frame
            // + caption) painted *above* the preview.

            overlay
        }
        .preferredColorScheme(.dark)
        .statusBarHidden(false)
        .task { await loadBalance() }
    }

    // MARK: - Overlay

    private var overlay: some View {
        VStack(spacing: 0) {
            topStatusBar
                .padding(.horizontal, 24)
                .padding(.top, 8)

            // The "Scan to pay" title sits just below the status bar.
            // Kerning ratio matches the Figma spec for the design
            // language (-size × 0.03 ≈ -0.51 at 17pt).
            Text("Scan to pay")
                .font(TaliseFont.heading(17, weight: .semibold))
                .kerning(-17 * 0.03)
                .foregroundStyle(.white)
                .padding(.top, 26)

            Spacer(minLength: 0)

            // Viewfinder frame — four corner brackets, 280×280 box.
            ScanFrame(size: 280, bracketLength: 30, lineWidth: 3)
                .frame(width: 280, height: 280)
                // TODO(scan-camera): once the preview is wired, this
                // frame becomes the metadataObjectsOutput's rectOfInterest
                // so the scanner only reads codes inside the brackets.

            Spacer(minLength: 0)

            Text("Center the QR code within the frame to scan and pay instantly.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 48)
                .padding(.bottom, 48)
        }
    }

    // MARK: - Top status bar

    /// Three-up row: a glass dismiss disc on the leading edge, the
    /// balance pill anchored top-leading per the design, and the flash
    /// toggle on the trailing edge. The dismiss button is not in the
    /// reference screenshot but a full-screen sheet MUST be dismissible.
    private var topStatusBar: some View {
        HStack(alignment: .center, spacing: 12) {
            dismissButton
            balancePill
            Spacer()
            flashToggle
        }
    }

    private var dismissButton: some View {
        Button(action: { dismiss() }) {
            Image(systemName: "xmark")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(
                    Circle().fill(.ultraThinMaterial)
                )
                .overlay(
                    Circle().stroke(Color.white.opacity(0.12), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    /// Inline balance block — eyebrow + amount sit directly on the
    /// scanner background per the design reference. No glass pill, no
    /// border. Reads as a status overlay rather than a chip.
    private var balancePill: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Balance")
                .font(TaliseFont.mono(10, weight: .regular))
                .foregroundStyle(Color.white.opacity(0.7))
            Text(balanceFormatted)
                .font(TaliseFont.heading(22, weight: .semibold))
                .kerning(-0.66)
                .foregroundStyle(.white)
        }
    }

    private var flashToggle: some View {
        Button(action: { flashOn.toggle() }) {
            // Visual stub — toggles icon state but does not invoke
            // AVCaptureDevice.torchMode (no capture session yet).
            // TODO(scan-camera): wire to device.setTorchModeOn() when
            // the capture session lands.
            Image(systemName: flashOn ? "bolt.fill" : "bolt.slash.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(
                    Circle().fill(.ultraThinMaterial)
                )
                .overlay(
                    Circle().stroke(Color.white.opacity(0.12), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Data

    private func loadBalance() async {
        do {
            let r: BalancesDTO = try await APIClient.shared.get("/api/balances")
            await MainActor.run { self.balance = r }
        } catch {
            // Silent — pill falls back to "$0.00" which is the design's
            // empty state anyway.
        }
    }
}

// MARK: - Viewfinder frame

/// Four corner brackets drawn around a centered square. Each bracket is
/// a short L drawn with `Path` so the shape can scale crisply at any DPI
/// and so we get rounded line caps without leaning on a `Shape` per
/// corner.
private struct ScanFrame: View {
    /// Outer side of the square the brackets enclose.
    let size: CGFloat
    /// Length of each leg of the L.
    let bracketLength: CGFloat
    /// Bracket stroke thickness.
    let lineWidth: CGFloat

    var body: some View {
        Canvas { ctx, _ in
            let half = lineWidth / 2
            // Inset each path by half the lineWidth so the outer edge of
            // the stroke aligns with the bounding box.
            let minX: CGFloat = half
            let minY: CGFloat = half
            let maxX: CGFloat = size - half
            let maxY: CGFloat = size - half
            let L = bracketLength

            // Top-left
            var p = Path()
            p.move(to: CGPoint(x: minX, y: minY + L))
            p.addLine(to: CGPoint(x: minX, y: minY))
            p.addLine(to: CGPoint(x: minX + L, y: minY))
            ctx.stroke(p, with: .color(.white), style: bracketStyle)

            // Top-right
            p = Path()
            p.move(to: CGPoint(x: maxX - L, y: minY))
            p.addLine(to: CGPoint(x: maxX, y: minY))
            p.addLine(to: CGPoint(x: maxX, y: minY + L))
            ctx.stroke(p, with: .color(.white), style: bracketStyle)

            // Bottom-right
            p = Path()
            p.move(to: CGPoint(x: maxX, y: maxY - L))
            p.addLine(to: CGPoint(x: maxX, y: maxY))
            p.addLine(to: CGPoint(x: maxX - L, y: maxY))
            ctx.stroke(p, with: .color(.white), style: bracketStyle)

            // Bottom-left
            p = Path()
            p.move(to: CGPoint(x: minX + L, y: maxY))
            p.addLine(to: CGPoint(x: minX, y: maxY))
            p.addLine(to: CGPoint(x: minX, y: maxY - L))
            ctx.stroke(p, with: .color(.white), style: bracketStyle)
        }
    }

    private var bracketStyle: StrokeStyle {
        StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round)
    }
}

#Preview {
    ScanToPayView()
}
