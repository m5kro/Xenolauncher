import SwiftUI

enum PlatformStyle {
    case traditional, liquidGlass

    static var current: Self {
        if #available(macOS 26.0, *) { return .liquidGlass }
        return .traditional
    }
}

private struct PlatformStyleKey: EnvironmentKey {
    static let defaultValue = PlatformStyle.current
}

private struct PlatformReduceTransparencyKey: EnvironmentKey {
    static let defaultValue: Bool? = nil
}

extension EnvironmentValues {
    // Injectable for legacy-layout regression tests on newer macOS versions.
    var platformStyle: PlatformStyle {
        get { self[PlatformStyleKey.self] }
        set { self[PlatformStyleKey.self] = newValue }
    }

    // The system accessibility value is read-only. Tests can override this
    // input without changing the user's global accessibility preferences.
    var platformReduceTransparency: Bool? {
        get { self[PlatformReduceTransparencyKey.self] }
        set { self[PlatformReduceTransparencyKey.self] = newValue }
    }
}

extension View {
    func launcherPrimaryActionStyle() -> some View {
        modifier(PlatformActionStyle(prominent: true))
    }

    func launcherSecondaryActionStyle() -> some View {
        modifier(PlatformActionStyle(prominent: false))
    }

    func launcherStatusBar<Status: View>(@ViewBuilder _ status: () -> Status) -> some View {
        modifier(PlatformStatusBar(status: status()))
    }
}

private struct PlatformActionStyle: ViewModifier {
    @Environment(\.platformStyle) private var style
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.platformReduceTransparency) private var transparencyOverride
    let prominent: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(macOS 26.0, *), style == .liquidGlass, !(transparencyOverride ?? reduceTransparency) {
            if prominent { content.buttonStyle(.glassProminent) }
            else { content.buttonStyle(.glass) }
        } else {
            if prominent { content.buttonStyle(.borderedProminent) }
            else { content.buttonStyle(.bordered) }
        }
    }
}

private struct FloatingControlSurface: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.platformReduceTransparency) private var transparencyOverride

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(macOS 26.0, *), !(transparencyOverride ?? reduceTransparency) {
            content.glassEffect(.regular, in: Capsule())
        } else {
            // Preserve the layout while honoring Reduce Transparency.
            content.background(.background, in: Capsule())
                .overlay(Capsule().strokeBorder(.primary.opacity(0.08)))
        }
    }
}

private struct PlatformStatusBar<Status: View>: ViewModifier {
    @Environment(\.platformStyle) private var style
    let status: Status

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(macOS 26.0, *), style == .liquidGlass {
            content.safeAreaInset(edge: .bottom, spacing: 0) {
                status
                    .buttonStyle(.borderless)
                    .modifier(FloatingControlSurface())
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .padding(.bottom, 12)
            }
        } else {
            VStack(spacing: 0) {
                content
                Divider()
                status
            }
        }
    }
}
