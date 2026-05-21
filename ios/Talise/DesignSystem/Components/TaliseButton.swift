import SwiftUI

enum TaliseButtonVariant {
    case primary
    case secondary
    case ghost
    case danger
}

enum TaliseButtonSize {
    case sm, md, lg

    var height: CGFloat {
        switch self {
        case .sm: return TaliseHeight.buttonSm
        case .md: return TaliseHeight.buttonMd
        case .lg: return TaliseHeight.buttonLg
        }
    }

    var hPadding: CGFloat {
        switch self {
        case .sm: return 12
        case .md: return 16
        case .lg: return 20
        }
    }

    var fontSize: CGFloat {
        switch self {
        case .sm: return 12
        case .md: return 13
        case .lg: return 14
        }
    }
}

struct TaliseButton: View {
    let title: String
    var variant: TaliseButtonVariant = .primary
    var size: TaliseButtonSize = .md
    var icon: String? = nil
    var loading: Bool = false
    var action: () -> Void

    var body: some View {
        Button(action: { if !loading { action() } }) {
            HStack(spacing: 8) {
                if loading {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .controlSize(.small)
                        .tint(foreground)
                } else if let icon {
                    Image(systemName: icon)
                        .font(.system(size: size.fontSize, weight: .medium))
                }
                Text(title)
                    .font(TaliseFont.heading(size.fontSize))
            }
            .foregroundStyle(foreground)
            .frame(maxWidth: .infinity)
            .frame(height: size.height)
            .padding(.horizontal, size.hPadding)
            .background(background)
            .overlay(
                RoundedRectangle(cornerRadius: TaliseRadius.sm)
                    .stroke(border, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: TaliseRadius.sm))
            .opacity(loading ? 0.85 : 1.0)
        }
        .buttonStyle(.plain)
        .disabled(loading)
    }

    private var background: Color {
        switch variant {
        case .primary: return TaliseColor.fg
        case .secondary: return TaliseColor.surface
        case .ghost: return .clear
        case .danger: return TaliseColor.danger
        }
    }

    private var foreground: Color {
        switch variant {
        case .primary: return TaliseColor.bg
        case .secondary: return TaliseColor.fg
        case .ghost: return TaliseColor.fgMuted
        case .danger: return .white
        }
    }

    private var border: Color {
        switch variant {
        case .primary: return TaliseColor.fg
        case .secondary: return TaliseColor.line
        case .ghost: return .clear
        case .danger: return TaliseColor.danger
        }
    }
}

#Preview {
    VStack(spacing: 12) {
        TaliseButton(title: "Send money", variant: .primary, icon: "arrow.up.right") {}
        TaliseButton(title: "Receive", variant: .secondary, icon: "arrow.down.left") {}
        TaliseButton(title: "Skip", variant: .ghost) {}
        TaliseButton(title: "Loading...", loading: true) {}
    }
    .padding()
}
