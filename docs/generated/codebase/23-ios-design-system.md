# 23. iOS Design System

The visual language is dark-mode-only "Liquid Glass" over a pure black background. Everything composes from `DesignSystem/` plus a few primitives under `DesignSystem/Components/`.

## Tokens

`DesignSystem/Tokens.swift`. Four namespaces:

### `TaliseColor`

```swift
static let bg                = Color(hex: 0x000000)   // page background
static let surface           = Color(hex: 0x252525)   // activity card
static let surface2          = Color(hex: 0x3E3E3E)   // small action buttons
static let surfaceGlass      = Color.white.opacity(0.08)
static let surfaceGlassStrong = Color.white.opacity(0.14)
static let usernameCard      = Color(hex: 0x504F4F).opacity(0.2)
static let fg                = Color(hex: 0xFFFFFF)
static let fgSubtle          = Color(hex: 0xFAFAFA)
static let fgMuted           = Color(hex: 0xB5B5B5)
static let fgDim             = Color(hex: 0x636363)
static let line              = Color.white.opacity(0.08)
static let accent            = Color(hex: 0x79D96C)   // canonical green
static let warmGold          = Color(hex: 0xC08A3E)
static let danger            = Color(hex: 0xA05A3E)
// activity badges
static let badgeSent     = Color(hex: 0x6C3A38).opacity(0.5)
static let badgeReceived = Color(hex: 0x355F40).opacity(0.5)
static let badgeNeutral  = Color(hex: 0x4A4A4A).opacity(0.6)
```

The header comment at `Tokens.swift:5` notes the palette is sourced from Figma node `42-1819` (Home, dark mode). A future shared design system will thread these through `@Environment(\.colorScheme)`; today iOS is dark by spec.

### `TaliseSpacing`, `TaliseRadius`, `TaliseHeight`

Standard rungs, e.g. `lg = 16`, `xl = 24`, radius `xl = 25` (large cards), `pill = 40` (nav). `Color(hex:)` initializer is an extension at `Tokens.swift:57`.

## Typography

`DesignSystem/Typography.swift`. `TaliseFont` exposes four families with graceful fallback (`UIFont(name:size:) != nil` decides whether to use the bundled custom or `.system`):

```swift
static func display(_ size: CGFloat, weight: Font.Weight = .medium) -> Font  // DM Sans
static func heading(_ size: CGFloat, weight: Font.Weight = .medium) -> Font  // DM Sans
static func body(_ size: CGFloat = 14, weight: Font.Weight = .light) -> Font // DM Sans
static func mono(_ size: CGFloat = 11, weight: Font.Weight = .light) -> Font // JetBrains Mono
```

Two reusable Text components:

- `MicroLabel(text:color:size:)` — JetBrains Mono micro-label, tracking `-0.32`. Used for "$0.00 FEE", "YOUR MONEY LANDS HERE", timestamps, and "Details" tails.
- `Eyebrow(text:)` — uppercase 10pt mono with `tracking(2.0)` and `fgDim`.

`TaliseApp.registerFonts()` registers `GoogleSans-Variable.ttf` (Resources/GoogleSans). DM Sans + JetBrains Mono are referenced by name; they fall back to SF Pro / SF Mono cleanly if the .ttf files are not bundled.

## TaliseFormat

`DesignSystem/TaliseFormat.swift`. Numbers always render as `$1,234.50`-style USD (`en_US` locale, literal `$`) unless `local(_:)` / `local2(_:)` are used, which run through `CurrencySettings.shared.convert(usd:)` and render `<symbol><amount>` (e.g. `₦1,234.50`). The `usd` formatter switches to 4 decimals under $1 so daily yields don't collapse to `$0.00`.

## TopGlow

`DesignSystem/TopGlow.swift`. A radial-gradient "horizon glow" pinned to the top of every authenticated tab. Two stacked `RadialGradient`s plus a `.blur(radius: 24)`:

- Wide base wash with center at `(0.5, -0.6)` and `endRadius: 600` so only the lower arc of the radial peeks below the status bar.
- Tighter bright accent at `(0.5, 0.0)` with `endRadius: 320` to give the wash a "lit point" right under the notch.
- 360pt total band height so the gradient decays to clear well before the history rows.

Apply with the `taliseScreenBackground()` view modifier (`TopGlow.swift:65`), which composes `TaliseColor.bg.ignoresSafeArea() + TopGlow().ignoresSafeArea(edges: .top) + content` as a single root. Used on Home, Earn, Rewards, Profile.

Color is a desaturated derivative of `TaliseColor.accent` (the Talise green). An earlier blue + 320pt band was reverted because it competed with the green Earn accent.

## Glass card

`DesignSystem/TopGlow.swift:109`. `TaliseGlassCard` is a `ViewModifier` exposed as `.taliseGlass(cornerRadius:tint:interactive:)`. Layer recipe (outer → inner):

1. `shape.fill(.ultraThinMaterial)` — system blur backdrop.
2. `shape.fill(Color.black.opacity(0.42))` — dark tint anchors the material in dark mode.
3. Optional directional `LinearGradient(tint.opacity(0.22) → tint.opacity(0.06))` for Sent (red), Received (green), Invest (accent green) cards.
4. `shape.strokeBorder(LinearGradient(white .24 → .04 → .10))` — top specular highlight.
5. `.clipShape(shape)`, then `shadow(.55 radius 22 y 10)` + `shadow(.32 radius 3 y 1)` for the two-layer drop shadow.

Pair with `.taliseGlassPressable(cornerRadius:)` (`TopGlow.swift:207`) on a Button to add the press-down pulse via `LiquidGlassPressStyle`: a momentary white wash (`0.06` opacity) and `scaleEffect(0.985)`.

## Component primitives

`DesignSystem/Components/`:

- **`LiquidGlassButton`** — primary CTA with the glass treatment. Sizes `sm/md/lg` (`TaliseButtonSize`). `tint` defaults to `TaliseColor.accent`; pass `nil` for neutral glass or `.danger` / `.warmGold` for variants. Internally just composes a `Button` with `.taliseGlass(cornerRadius:tint:)` and `.taliseGlassPressable(cornerRadius:)`.
- **`LiquidGlassPill`** — capsule-shaped variant of the glass button.
- **`LiquidGlassSheet`** — sheet container with the standard glass background.
- **`LiquidGlassDivider`** — hairline separator with white opacity matching the spec.
- **`TaliseButton`** — the original flat-fill button (variants `primary/secondary/ghost/danger`). Used in onboarding and a handful of legacy places; new buttons should prefer `LiquidGlassButton`.
- **`HeroNumber`** — the big balance / amount display.
- **`PageHeader`** — eyebrow + title block.

## Bottom nav pill

`App/AppRoot.swift:147` (`BottomNavPill`). Floating pill rendered above the tab content. Layering matches `TaliseGlassCard` but with a higher dark-tint opacity (`0.45`) and only the top specular hairline. The active tab gets its own inner capsule (`activeBackdrop`) with `surfaceGlassStrong` + accent stroke gradient. When a sheet is up the underlying tab content gets `.blur(radius: 14)` and `allowsHitTesting(false)` for a true glass-depth read (`AppRoot.swift:87`).

## Animations / transitions

- Phase transitions in `AppRoot`: `.animation(.easeInOut(duration: 0.2), value: phaseKey)`.
- Tab switches: `withAnimation(.spring(response: 0.32, dampingFraction: 0.78))`.
- Sheet up/down blur: `.easeInOut(duration: 0.22)`.
- Press pulse on glass buttons: `.easeOut(duration: 0.12)`.
- Onboarding step changes: `.easeInOut(duration: 0.32)` with `.opacity` (splash) and `.slide` (everything else).
- `SendPaperPlane.swift` carries the animated illustration during sponsor-execute.
- `HistoryRow` uses `contentTransition(.numericText())` on its amount and animates the tint cross-fade with `.easeOut(duration: 0.18)` on `configuration.isPressed`.
