import SwiftUI

enum AppTheme {
    static let backgroundTop = Color(red: 0.08, green: 0.095, blue: 0.13)
    static let backgroundBottom = Color(red: 0.018, green: 0.024, blue: 0.04)
    static let glassTint = Color.white.opacity(0.055)
    static let glassTintRaised = Color.white.opacity(0.085)
    static let card = Color(red: 0.095, green: 0.11, blue: 0.15)
    static let cardRaised = Color(red: 0.13, green: 0.15, blue: 0.19)
    static let border = Color.white.opacity(0.16)
    static let primary = Color(red: 0.32, green: 0.94, blue: 0.42)
    static let primaryDim = Color(red: 0.15, green: 0.42, blue: 0.22)
    static let text = Color(red: 0.94, green: 0.96, blue: 0.94)
    static let mutedText = Color(red: 0.61, green: 0.67, blue: 0.66)
    static let warning = Color(red: 1.0, green: 0.74, blue: 0.32)
    static let danger = Color(red: 1.0, green: 0.38, blue: 0.32)

    static let cardRadius: CGFloat = 18
    static let controlRadius: CGFloat = 12
}

struct GlassPanel<Content: View>: View {
    let radius: CGFloat
    @ViewBuilder let content: Content

    init(radius: CGFloat = AppTheme.cardRadius, @ViewBuilder content: () -> Content) {
        self.radius = radius
        self.content = content()
    }

    var body: some View {
        content
            .background(.ultraThinMaterial)
            .background(AppTheme.glassTint)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(AppTheme.border, lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.28), radius: 22, y: 14)
    }
}

extension Font {
    static func vocal(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }
}
