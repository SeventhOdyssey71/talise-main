import SwiftUI

/// Matches the web `<PageIntro>` rhythm — eyebrow + 22-26pt title.
struct PageHeader: View {
    let eyebrow: String
    let title: String
    var trailing: AnyView? = nil

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow(text: eyebrow)
                Text(title)
                    .font(TaliseFont.heading(24))
                    .foregroundStyle(TaliseColor.fg)
            }
            Spacer()
            if let trailing {
                trailing
            }
        }
        .padding(.horizontal, TaliseSpacing.xl)
        .padding(.top, TaliseSpacing.xl)
        .padding(.bottom, TaliseSpacing.md)
    }
}

struct SectionHeader: View {
    let title: String
    var right: AnyView? = nil

    var body: some View {
        HStack {
            Eyebrow(text: title)
            Spacer()
            if let right {
                right
            }
        }
    }
}
