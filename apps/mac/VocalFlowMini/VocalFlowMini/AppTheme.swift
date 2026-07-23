import SwiftUI

enum AppTheme {
    static let brandBase = Color(red: 85 / 255, green: 98 / 255, blue: 78 / 255)
    static let logoLeaf = Color(red: 146 / 255, green: 166 / 255, blue: 136 / 255)
    static let backgroundTop = Color(red: 0.12, green: 0.15, blue: 0.13)
    static let backgroundBottom = Color(red: 0.045, green: 0.06, blue: 0.05)
    static let glassTint = Color.white.opacity(0.035)
    static let glassTintRaised = Color.white.opacity(0.075)
    static let card = Color(red: 0.15, green: 0.18, blue: 0.16)
    static let cardRaised = Color(red: 0.20, green: 0.24, blue: 0.21)
    static let border = Color(red: 0.66, green: 0.72, blue: 0.63).opacity(0.24)
    static let primary = logoLeaf
    static let primaryDim = Color(red: 0.33, green: 0.38, blue: 0.31)
    static let action = Color(red: 0.72, green: 0.43, blue: 0.30)
    static let text = Color(red: 0.94, green: 0.95, blue: 0.91)
    static let mutedText = Color(red: 0.65, green: 0.70, blue: 0.63)
    static let warning = Color(red: 0.88, green: 0.64, blue: 0.35)
    static let danger = Color(red: 0.86, green: 0.38, blue: 0.31)

    static let cardRadius: CGFloat = 18
    static let controlRadius: CGFloat = 12
}

struct VocalFlowMarkShape: Shape {
    private let sourceWidth: CGFloat = 622
    private let sourceHeight: CGFloat = 334

    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width / sourceWidth, rect.height / sourceHeight)
        let offsetX = rect.minX + (rect.width - sourceWidth * scale) / 2
        let offsetY = rect.minY + (rect.height - sourceHeight * scale) / 2

        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: offsetX + x * scale, y: offsetY + y * scale)
        }

        var path = Path()
        path.move(to: point(195.976, 134.507))
        path.addLine(to: point(271.811, 0))
        path.addLine(to: point(583.270, 0))
        path.addLine(to: point(621.895, 63.6709))
        path.addLine(to: point(582.905, 134.507))
        path.addLine(to: point(429.175, 134.507))
        path.addLine(to: point(506.675, 268.231))
        path.addLine(to: point(468.938, 333.117))
        path.addLine(to: point(391.587, 333.117))
        path.addLine(to: point(312.836, 200.223))
        path.addLine(to: point(236.109, 333.117))
        path.addLine(to: point(158.618, 333.117))
        path.addLine(to: point(120.440, 268.231))
        path.addLine(to: point(120.734, 268.231))
        path.addLine(to: point(0, 63.6709))
        path.addLine(to: point(44.2031, 0))
        path.addLine(to: point(120.588, 0))
        path.closeSubpath()
        return path
    }
}

struct VocalFlowMark: View {
    var lineWidth: CGFloat = 1

    var body: some View {
        VocalFlowMarkShape()
            .fill(
                LinearGradient(
                    colors: [AppTheme.logoLeaf, Color.white.opacity(0.2)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .overlay {
                VocalFlowMarkShape()
                    .stroke(Color.white.opacity(0.76), lineWidth: lineWidth)
            }
            .aspectRatio(622 / 334, contentMode: .fit)
            .accessibilityHidden(true)
    }
}

struct VocalFlowBadge: View {
    let size: CGFloat

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [AppTheme.brandBase.opacity(0.98), AppTheme.brandBase.opacity(0.74)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            VocalFlowMark(lineWidth: max(0.65, size * 0.018))
                .frame(width: size * 0.78, height: size * 0.5)
        }
        .frame(width: size, height: size)
        .overlay {
            RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
                .stroke(Color.white.opacity(0.13), lineWidth: 1)
        }
        .shadow(color: Color.black.opacity(0.2), radius: size * 0.16, y: size * 0.08)
        .accessibilityLabel("VocalFlow")
    }
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
            .shadow(color: .black.opacity(0.24), radius: 18, y: 12)
    }
}

extension Font {
    static func vocal(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .default)
    }
}
