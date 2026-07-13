import SwiftUI

/// The chosen look of the Talise Copilot mascot — a body "skin" (colour) the
/// user picks on the profile-picture page. Persisted locally so the Copilot
/// wears the same skin everywhere it appears (Home top bar, Chat hero).
///
/// This drives the DRAWN mascot's colour. An NFT worn as a skin is handled
/// separately through the avatar override (`/api/me/avatar`), which replaces the
/// mascot with the NFT image. When neither is set, the classic Copilot shows —
/// so a user who owns nothing still has a face, never an empty avatar.
@Observable
final class CopilotSkin {
    static let shared = CopilotSkin()

    struct Preset: Identifiable, Equatable {
        let id: String
        let name: String
        let hex: UInt32
        var color: Color { Color(hex: hex) }
    }

    /// Free built-in skins. Pastel bodies that keep the deep-ink face legible.
    static let presets: [Preset] = [
        .init(id: "classic", name: "Classic", hex: 0xCAFFB8),
        .init(id: "sky",     name: "Sky",     hex: 0x8FD3FF),
        .init(id: "coral",   name: "Coral",   hex: 0xFFB4A6),
        .init(id: "violet",  name: "Violet",  hex: 0xCBB8FF),
        .init(id: "gold",    name: "Gold",    hex: 0xFFE08A),
    ]

    /// A Copilot background — a wallpaper the mascot sits on. Assets live in
    /// Assets.xcassets (generated art). World Cup is the default.
    struct Background: Identifiable, Equatable {
        let id: String
        let name: String
        let asset: String
    }

    static let backgrounds: [Background] = [
        .init(id: "worldcup", name: "World Cup", asset: "CopilotBgWorldCup"),
        .init(id: "field",    name: "Field",     asset: "CopilotBgField"),
        .init(id: "beach",    name: "Beach",     asset: "CopilotBgBeach"),
        .init(id: "office",   name: "Office",    asset: "CopilotBgOffice"),
    ]

    private let key = "talise.copilot.skin"
    private let bgKey = "talise.copilot.bg"
    private let pfpKey = "talise.copilot.pfp"

    var selectedId: String {
        didSet { UserDefaults.standard.set(selectedId, forKey: key) }
    }
    var selectedBgId: String {
        didSet { UserDefaults.standard.set(selectedBgId, forKey: bgKey) }
    }
    /// When true, the profile avatar renders the Copilot (mascot on its
    /// background) instead of a photo/initials. Set from "Save as profile image".
    var useAsProfileImage: Bool {
        didSet { UserDefaults.standard.set(useAsProfileImage, forKey: pfpKey) }
    }

    private init() {
        selectedId = UserDefaults.standard.string(forKey: key) ?? "classic"
        selectedBgId = UserDefaults.standard.string(forKey: bgKey) ?? "worldcup"
        useAsProfileImage = UserDefaults.standard.bool(forKey: pfpKey)
    }

    var preset: Preset { Self.presets.first { $0.id == selectedId } ?? Self.presets[0] }
    var color: Color { preset.color }

    var background: Background { Self.backgrounds.first { $0.id == selectedBgId } ?? Self.backgrounds[0] }
}
