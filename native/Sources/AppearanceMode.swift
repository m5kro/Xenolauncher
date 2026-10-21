import SwiftUI

enum AppearanceMode: String, CaseIterable, Identifiable {
    case light, dark, system

    var id: String { rawValue }
    var titleKey: String {
        switch self {
        case .light: return "appearance.light"
        case .dark: return "appearance.dark"
        case .system: return "appearance.system"
        }
    }
    init(settings: [String: JSONValue]) {
        if let raw = settings["appearance"]?.stringValue, let mode = Self(rawValue: raw) {
            self = mode
        } else if case .bool(let dark) = settings["darkTheme"] {
            self = dark ? .dark : .light
        } else {
            self = .system
        }
    }
}
