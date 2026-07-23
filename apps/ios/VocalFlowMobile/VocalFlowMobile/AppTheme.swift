import SwiftUI

enum AppTheme {
    static let brandBase = Color(red: 85 / 255, green: 98 / 255, blue: 78 / 255)
    static let logoLeaf = Color(red: 146 / 255, green: 166 / 255, blue: 136 / 255)
    static let background = Color(red: 0.035, green: 0.047, blue: 0.043)
    static let surface = Color(red: 0.075, green: 0.094, blue: 0.084)
    static let elevatedSurface = Color(red: 0.11, green: 0.13, blue: 0.118)
    static let primary = logoLeaf
    static let warm = Color(red: 0.93, green: 0.48, blue: 0.29)
    static let text = Color(red: 0.95, green: 0.96, blue: 0.93)
    static let secondaryText = Color(red: 0.63, green: 0.69, blue: 0.63)
    static let border = Color.white.opacity(0.1)
}

struct VocalFlowMark: View {
    var body: some View {
        Image("VocalFlowMark")
            .resizable()
            .scaledToFit()
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

            VocalFlowMark()
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

struct VocalFlowLockup: View {
    var badgeSize: CGFloat = 32
    var caption = "LOCAL KARAOKE"

    var body: some View {
        HStack(spacing: 9) {
            VocalFlowBadge(size: badgeSize)
            VStack(alignment: .leading, spacing: 1) {
                Text("VocalFlow")
                    .font(.system(size: badgeSize * 0.48, weight: .bold, design: .rounded))
                    .foregroundStyle(AppTheme.text)
                Text(caption)
                    .font(.system(size: max(7, badgeSize * 0.22), weight: .semibold, design: .monospaced))
                    .tracking(1.1)
                    .foregroundStyle(AppTheme.secondaryText)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("VocalFlow \(caption)")
    }
}

struct PressScaleButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(.easeOut(duration: 0.14), value: configuration.isPressed)
    }
}
