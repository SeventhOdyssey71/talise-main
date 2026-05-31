import SwiftUI
import AVFoundation
#if canImport(UIKit)
import UIKit
#endif

/// Full-screen Scan-to-Pay surface. The user lands here from the Home
/// top-right disc (the slot previously occupied by Contacts).
///
/// The live camera feed (`QRScannerView`) mounts behind the overlay; the
/// corner brackets + caption float on top. Camera permission is requested
/// in onboarding (`PermissionsScreen`) but we never assume it — we
/// re-check `AVCaptureDevice.authorizationStatus(for: .video)` on appear
/// and request if undetermined. Denied/restricted → an inline Settings
/// prompt. Simulator / no camera → an "unavailable" state. A successful
/// scan parses the QR (`ScanPayload`), dismisses, and opens the Send flow
/// pre-filled with the recipient.
struct ScanToPayView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var balance: BalancesDTO?
    @State private var flashOn = false

    /// Camera authorization gate. Drives which surface we paint.
    enum CameraState {
        case checking      // resolving authorizationStatus / requesting
        case scanning      // authorized + camera present → live preview
        case denied        // .denied / .restricted → Settings prompt
        case unavailable   // no capture device (simulator, no back camera)
    }
    @State private var cameraState: CameraState = .checking
    /// Whether the active device has a torch. Hides the flash toggle when
    /// false (front-only devices, simulator).
    @State private var hasTorch = false
    /// Brief "Not a Talise payment code" pill, auto-dismissed.
    @State private var showUnrecognized = false
    /// Latches once we've handed a valid scan to the Send flow so a second
    /// frame can't double-route.
    @State private var didRoute = false
    /// Bumped after an unrecognized scan to re-arm QRScannerView's
    /// debounce so the next code is read.
    @State private var resumeToken = 0

    /// Same formatter HomeView uses for the headline figure — keeps the
    /// pill consistent with the user's "Balance $X.XX" elsewhere in the
    /// app. Empty wallet renders as "$0.00".
    private var balanceFormatted: String {
        TaliseFormat.local2(balance?.usdsui ?? 0)
    }

    var body: some View {
        ZStack {
            // Black backdrop — always present so any letterboxing around
            // the aspect-fill preview reads as intentional black.
            Color.black.ignoresSafeArea()

            // Live camera feed sits behind the overlay so the corner
            // brackets + caption float on top of the frame.
            if cameraState == .scanning {
                QRScannerView(
                    torchOn: flashOn,
                    resumeToken: resumeToken,
                    onCode: handleScan,
                    onCameraAvailability: { available in
                        // The representable resolves availability after we
                        // optimistically entered .scanning; demote to the
                        // unavailable surface if there's no usable device.
                        if !available { cameraState = .unavailable }
                    },
                    onTorchAvailability: { hasTorch = $0 }
                )
                .ignoresSafeArea()
            }

            overlay

            // Permission / availability surfaces sit above the overlay so
            // their copy isn't competing with the viewfinder caption.
            switch cameraState {
            case .denied:       deniedState
            case .unavailable:  unavailableState
            case .checking, .scanning: EmptyView()
            }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden(false)
        .task { await loadBalance() }
        .onAppear(perform: resolveCameraAuthorization)
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

            // Swap the instruction caption for the "unrecognized code"
            // pill when a scan didn't parse — keeps the same vertical slot
            // so the layout doesn't jump.
            if showUnrecognized {
                unrecognizedPill
                    .padding(.bottom, 48)
                    .transition(.opacity)
            } else {
                Text("Center the QR code within the frame to scan and pay instantly.")
                    .font(TaliseFont.body(13, weight: .light))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 48)
                    .padding(.bottom, 48)
            }
        }
    }

    /// Transient "not a Talise code" feedback. We keep scanning underneath
    /// — this just tells the user the last code wasn't routable.
    private var unrecognizedPill: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white.opacity(0.9))
            Text("Not a Talise payment code")
                .font(TaliseFont.body(13, weight: .regular))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Capsule().fill(.ultraThinMaterial))
        .overlay(Capsule().stroke(Color.white.opacity(0.14), lineWidth: 1))
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
            // Only paint the flash toggle when the active device actually
            // has a torch (hidden on the simulator + front-only devices).
            if hasTorch {
                flashToggle
            }
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
            // Drives AVCaptureDevice.torchMode via QRScannerView's
            // `torchOn` binding (applied in updateUIViewController →
            // setTorch). The icon swap mirrors the device state.
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

    // MARK: - Permission states

    /// Shown for `.denied` / `.restricted`. The user already chose to deny
    /// (here or in onboarding) so a re-request would be a silent no-op —
    /// the only path forward is Settings.
    private var deniedState: some View {
        VStack(spacing: 14) {
            Image(systemName: "camera.metering.none")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(.white.opacity(0.8))
            Text("Camera access needed to scan")
                .font(TaliseFont.heading(17, weight: .semibold))
                .foregroundStyle(.white)
            Text("Enable camera access in Settings to scan a payment QR code.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(.white.opacity(0.7))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 48)
            Button(action: openSettings) {
                Text("Open Settings")
                    .font(TaliseFont.heading(15, weight: .medium))
                    .foregroundStyle(.black)
                    .frame(height: 48)
                    .padding(.horizontal, 28)
                    .background(Capsule().fill(.white))
            }
            .buttonStyle(.plain)
            .padding(.top, 4)
        }
        .padding(24)
    }

    /// Shown when there's no usable capture device — the iOS Simulator
    /// (no camera hardware) and devices without a back camera. Keeps the
    /// view testable instead of a frozen black screen.
    private var unavailableState: some View {
        VStack(spacing: 12) {
            Image(systemName: "video.slash")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(.white.opacity(0.8))
            Text("Camera unavailable on this device")
                .font(TaliseFont.heading(17, weight: .semibold))
                .foregroundStyle(.white)
            Text("Scan-to-Pay needs a camera. Try this on a physical iPhone.")
                .font(TaliseFont.body(13, weight: .light))
                .foregroundStyle(.white.opacity(0.7))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 48)
        }
        .padding(24)
    }

    // MARK: - Authorization

    private func resolveCameraAuthorization() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            cameraState = .scanning
        case .notDetermined:
            // Request inline — onboarding may have been skipped, or this
            // is the user's first camera touchpoint. Don't assume grant.
            Task {
                let granted = await AVCaptureDevice.requestAccess(for: .video)
                await MainActor.run {
                    cameraState = granted ? .scanning : .denied
                }
            }
        case .denied, .restricted:
            cameraState = .denied
        @unknown default:
            cameraState = .denied
        }
    }

    private func openSettings() {
        #if canImport(UIKit)
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
        #endif
    }

    // MARK: - Scan routing

    /// Called once per detected QR (QRScannerView debounces). Valid codes
    /// seed the Send recipient bridge + open the Send cover; unrecognized
    /// codes flash a pill and keep scanning.
    private func handleScan(_ raw: String) {
        guard !didRoute else { return }

        guard let parsed = ScanPayload.parse(raw) else {
            // Unrecognized code — flash the pill (auto-dismisses) and
            // re-arm the scanner so the next code is read. We deliberately
            // do NOT set `didRoute`. Bumping `resumeToken` clears
            // QRScannerView's `didEmit` latch via resumeDetection().
            withAnimation { showUnrecognized = true }
            resumeToken &+= 1
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 1_600_000_000)
                withAnimation { showUnrecognized = false }
            }
            return
        }

        didRoute = true
        // Reuse the exact path ContactsSheet uses to pre-fill Send: write
        // the recipient token to the shared UserDefaults bridge, then post
        // the Send-cover request. SendRecipientView (new flow) and
        // LegacySendView both read + clear `io.talise.send.prefillRecipient`
        // on appear and auto-resolve it.
        UserDefaults.standard.set(
            parsed.recipient,
            forKey: "io.talise.send.prefillRecipient"
        )
        dismiss()
        // Small delay so this full-screen scanner finishes dismissing
        // before MainTabView presents the Send cover — back-to-back
        // present/dismiss on the same hierarchy otherwise drops the
        // second presentation.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            NotificationCenter.default.post(
                name: .taliseRequestSendCover, object: nil
            )
        }
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
