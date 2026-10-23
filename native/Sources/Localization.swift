import Combine
import Foundation

struct TranslationCatalog: Decodable {
    let language: String
    let name: String
    var strings: [String: String]
}

struct LocalizedMessage: ExpressibleByStringLiteral, Equatable {
    let key: String
    var arguments: [String: String] = [:]
    var count: Int?

    init(_ key: String, _ arguments: [String: String] = [:], count: Int? = nil) {
        self.key = key
        self.arguments = arguments
        self.count = count
    }
    init(stringLiteral value: String) { key = value }
}

@MainActor
final class Localization: ObservableObject {
    @Published private(set) var language = "en"
    private(set) var preference = "system"
    private(set) var catalogs: [String: TranslationCatalog] = [:]
    private(set) var diagnostics: [String] = []
    private let preferredLanguages: () -> [String]
    private var observers: [AnyCancellable] = []

    // External packs are data, separate from the executable and its signature.
    // A partial pack inherits missing strings from the bundled English catalog.
    init(externalDirectory: URL? = Localization.externalDirectory,
         preferredLanguages: @escaping () -> [String] = { Locale.preferredLanguages }) {
        self.preferredLanguages = preferredLanguages
        load(Bundle.module.resourceURL!.appendingPathComponent("Translations"))
        if let externalDirectory { load(externalDirectory) }
        precondition(catalogs["en"] != nil, "The English fallback catalog must be bundled")
        refresh()
        for name in [NSLocale.currentLocaleDidChangeNotification, Notification.Name("NSApplicationDidBecomeActiveNotification")] {
            NotificationCenter.default.publisher(for: name).sink { [weak self] _ in
                Task { @MainActor in self?.refresh() }
            }.store(in: &observers)
        }
    }

    nonisolated static var externalDirectory: URL {
        if let path = ProcessInfo.processInfo.environment["XENO_TRANSLATIONS_DIR"] {
            return URL(fileURLWithPath: path, isDirectory: true)
        }
        let data = ProcessInfo.processInfo.environment["XENO_DATA_DIR"].map { URL(fileURLWithPath: $0, isDirectory: true) }
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Xenolauncher")
        return data.appendingPathComponent("Translations", isDirectory: true)
    }
    var locale: Locale { Locale(identifier: language) }
    var choices: [TranslationCatalog] { catalogs.values.sorted { $0.language < $1.language } }

    func select(_ preference: String) {
        self.preference = preference
        refresh()
    }
    func refresh() {
        let next = preference != "system" && catalogs[preference] != nil
            ? preference : Self.resolve(preferredLanguages(), available: Set(catalogs.keys))
        if language != next { language = next }
    }
    nonisolated static func resolve(_ preferences: [String], available: Set<String>) -> String {
        for preference in preferences {
            let normalized = preference.replacingOccurrences(of: "_", with: "-")
            if let exact = available.first(where: { $0.caseInsensitiveCompare(normalized) == .orderedSame }) { return exact }
            let locale = Locale(identifier: normalized)
            guard let base = locale.language.languageCode?.identifier else { continue }
            if base == "zh" {
                let traditional = locale.language.script?.identifier == "Hant" || ["TW", "HK", "MO"].contains(locale.region?.identifier ?? "")
                let script = traditional ? "zh-Hant" : "zh-Hans"
                if available.contains(script) { return script }
            }
            if available.contains(base) { return base }
            if let sameLanguage = available.sorted().first(where: { $0.hasPrefix(base + "-") }) { return sameLanguage }
        }
        return "en"
    }
    func text(_ message: LocalizedMessage) -> String {
        text(message.key, message.arguments, count: message.count)
    }
    func text(_ key: String, _ arguments: [String: String] = [:], count: Int? = nil) -> String {
        let variant = count.map { key + ($0 == 1 ? ".one" : ".other") }
        let selected = catalogs[language]?.strings ?? [:]
        let fallback = catalogs["en"]!.strings
        let template = variant.flatMap { selected[$0] } ?? selected[key]
            ?? variant.flatMap { fallback[$0] } ?? fallback[key] ?? key
        var values = arguments
        if let count { values["count"] = String(count) }
        // Substitute in one pass, so braces in game names/paths stay verbatim.
        let pattern = try! NSRegularExpression(pattern: #"\{([A-Za-z][A-Za-z0-9_]*)\}"#)
        var result = template
        for match in pattern.matches(in: template, range: NSRange(template.startIndex..., in: template)).reversed() {
            guard let keyRange = Range(match.range(at: 1), in: template),
                  let range = Range(match.range, in: result), let value = values[String(template[keyRange])] else { continue }
            result.replaceSubrange(range, with: value)
        }
        return result
    }
    private func load(_ directory: URL) {
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        for file in files.filter({ $0.pathExtension == "json" }).sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            do {
                var catalog = try JSONDecoder().decode(TranslationCatalog.self, from: Data(contentsOf: file))
                guard catalog.language.range(of: #"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$"#, options: .regularExpression) != nil,
                      !catalog.name.isEmpty, !catalog.strings.isEmpty else {
                    throw CocoaError(.fileReadCorruptFile)
                }
                if let existing = catalogs[catalog.language] {
                    catalog.strings = existing.strings.merging(catalog.strings) { _, new in new }
                }
                catalogs[catalog.language] = catalog
            } catch { diagnostics.append("\(file.lastPathComponent): \(error.localizedDescription)") }
        }
    }
}
