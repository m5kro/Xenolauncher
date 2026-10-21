import SwiftUI
import AppKit

struct SettingsView: View {
    @EnvironmentObject private var store: LauncherStore
    @EnvironmentObject private var bridge: NodeBridge
    var body: some View {
        Form {
            Section(store.t("settings.languageSection")) {
                Picker(store.t("settings.language"), selection: Binding(
                    get: { store.language },
                    set: { language in
                        Task { await store.updateSetting("language", .string(language)) }
                    }
                )) {
                    Text(store.t("language.system")).tag("system")
                    ForEach(store.localization.choices, id: \.language) { catalog in
                        Text(catalog.name).tag(catalog.language)
                    }
                    if store.language != "system" && store.localization.catalogs[store.language] == nil {
                        Text(store.language).tag(store.language)
                    }
                }
                Text(store.t("language.hint")).font(.caption).foregroundStyle(.secondary)
            }
            Section(store.t("settings.appearance")) {
                Picker(store.t("settings.appearanceMode"), selection: Binding(
                    get: { store.appearance },
                    set: { mode in
                        Task { await store.updateSetting("appearance", .string(mode.rawValue)) }
                    }
                )) {
                    ForEach(AppearanceMode.allCases) { mode in
                        Text(store.t(mode.titleKey)).tag(mode)
                    }
                }
                Toggle(store.t("settings.listView"), isOn: setting("listView"))
            }
            Section(store.t("library.title")) {
                Toggle(store.t("settings.confirmDeletion"), isOn: setting("deletionConfirmation", defaultValue: true))
                Toggle(store.t("settings.detectRemote"), isOn: setting("nonInstalledAutodetect", defaultValue: true))
            }
            Section(store.t("updates.settings")) {
                Toggle(store.t("updates.onStartup"), isOn: setting("checkModuleUpdatesOnStartup", defaultValue: true))
                Button(store.t("updates.check")) { Task { await store.checkEngineUpdates() } }
                    .disabled(!bridge.connected)
            }
            Section(store.t("settings.runtime")) {
                LabeledContent(store.t("settings.service"), value: bridge.connected ? "Node.js \(bridge.nodeVersion)" : store.t("service.notConnected"))
                HStack {
                    Text(store.t("settings.data")); Spacer()
                    Button(store.t("settings.openFinder")) { NSWorkspace.shared.open(URL(fileURLWithPath: store.dataPath)) }.disabled(store.dataPath.isEmpty)
                }
                Text(store.dataPath).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
            }
            Section {
                LabeledContent(store.t("settings.version"), value: "SwiftUI Preview 1.3.1")
                Link(store.t("settings.project"), destination: URL(string: "https://github.com/m5kro/Xenolauncher")!)
            }
        }.formStyle(.grouped).disabled(store.busy)
    }
    private func setting(_ key: String, defaultValue: Bool = false) -> Binding<Bool> {
        Binding(get: { store.settings[key]?.boolValue ?? defaultValue }, set: { value in
            Task { await store.updateSetting(key, .bool(value)) }
        })
    }
}
