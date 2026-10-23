import AppKit

@MainActor
enum ApplicationAppearance {
    static func apply(_ mode: AppearanceMode) {
        let application = NSApplication.shared
        let name: NSAppearance.Name?
        switch mode {
        case .light: name = .aqua
        case .dark: name = .darkAqua
        case .system: name = nil
        }
        guard application.appearance?.name != name else { return }
        // Keep AppKit and SwiftUI on the same inheritance chain. In particular,
        // nil removes the app override, including for windows, panels and sheets.
        application.appearance = name.flatMap { NSAppearance(named: $0) }
    }
}
