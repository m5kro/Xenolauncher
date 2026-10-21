import SwiftUI
import AppKit

struct GameEditorView: View {
    @EnvironmentObject private var store: LauncherStore
    @EnvironmentObject private var bridge: NodeBridge
    @Environment(\.dismiss) private var dismiss
    let game: GameRecord?
    @State private var title: String
    @State private var gamePath: String
    @State private var iconPath: String
    @State private var tags: String
    @State private var engine: String
    @State private var arguments: [String: JSONValue]
    @State private var validation: String?
    @State private var versionsTarget: VersionTarget?

    init(game: GameRecord?) {
        self.game = game
        _title = State(initialValue: game?.title ?? "")
        _gamePath = State(initialValue: game?.path ?? "")
        _iconPath = State(initialValue: game?.iconPath ?? "")
        _tags = State(initialValue: game?.tags.joined(separator: ", ") ?? "")
        _engine = State(initialValue: game?.engine ?? "")
        _arguments = State(initialValue: game?.arguments ?? [:])
    }
    private var definitions: [ArgumentDefinition] { store.modules.first { $0.id == engine }?.arguments ?? [] }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Text(game == nil ? store.t("library.add") : store.t("game.settings")).font(.title2.bold())
                    Text(store.t("editor.description")).font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
            }.padding(24)
            Divider()
            Form {
                Section(store.t("editor.basic")) {
                    TextField(store.t("editor.name"), text: $title)
                    HStack {
                        TextField(store.t("editor.path"), text: $gamePath)
                        Button(store.t("common.choose")) { choosePath(icon: false) }
                    }
                    HStack {
                        TextField(store.t("editor.icon"), text: $iconPath)
                        Button(store.t("common.choose")) { choosePath(icon: true) }
                    }
                    TextField(store.t("editor.tags"), text: $tags)
                }
                Section(store.t("editor.runtime")) {
                    Picker(store.t("editor.engine"), selection: $engine) {
                        Text(store.t("editor.chooseEngine")).tag("")
                        ForEach(store.modules) { Text($0.name).tag($0.id) }
                        if !engine.isEmpty && !store.modules.contains(where: { $0.id == engine }) {
                            Text(store.t("editor.missingEngine", ["engine": store.engineName(for: engine)])).tag(engine)
                        }
                    }
                    HStack {
                        Button { Task { await detect() } } label: { Label(store.t("editor.detect"), systemImage: "wand.and.stars") }
                            .disabled(gamePath.isEmpty || store.busy)
                        Spacer()
                        Text(store.t("editor.engineCount", count: store.modules.count)).font(.caption).foregroundStyle(.secondary)
                    }
                    if !engine.isEmpty && !store.modules.contains(where: { $0.id == engine }) {
                        Text(store.t("editor.missingEngineHint")).font(.caption).foregroundStyle(.orange)
                    }
                    if store.modules.isEmpty {
                        Text(store.t("editor.noEnginesHint")).font(.callout).foregroundStyle(.secondary)
                    }
                }
                if !definitions.isEmpty {
                    Section(store.t("editor.arguments")) {
                        ForEach(definitions) { definition in
                            ArgumentField(definition: definition, value: argumentBinding(definition), engine: engine) {
                                versionsTarget = VersionTarget(engine: engine, definition: definition)
                            }.id(engine + ":" + definition.id)
                        }
                    }
                }
            }.formStyle(.grouped).disabled(store.busy)
            if let validation { Text(validation).foregroundStyle(.red).font(.callout).padding(.horizontal, 24).padding(.bottom, 12) }
            Divider()
            HStack {
                if store.busy { ProgressView().controlSize(.small); Text(store.taskTitle).font(.caption).foregroundStyle(.secondary) }
                Spacer()
                Button(store.t("common.cancel")) { dismiss() }.keyboardShortcut(.cancelAction).disabled(store.busy)
                Button(store.t("common.save")) { Task { await save() } }.launcherPrimaryActionStyle().keyboardShortcut(.defaultAction).disabled(store.busy)
            }.padding(20)
        }.frame(width: 650, height: 650)
            .interactiveDismissDisabled(store.busy)
            .task { initializeDefaults() }
            .onChange(of: engine) { _ in
                arguments = game?.engine == engine ? game?.arguments ?? [:] : [:]
                initializeDefaults()
            }
            .sheet(item: $versionsTarget) { target in
                VersionManagerView(target: target).environmentObject(store).environmentObject(bridge)
            }
    }
    private func initializeDefaults() {
        for definition in definitions where arguments[definition.id] == nil {
            if (definition.type == "dropdown" || definition.type == "select"), definition.data["default"] == nil, let first = definition.options.first {
                arguments[definition.id] = .string(first.value)
            } else { arguments[definition.id] = definition.defaultValue }
        }
    }
    private func argumentBinding(_ definition: ArgumentDefinition) -> Binding<JSONValue> {
        Binding(get: { arguments[definition.id] ?? definition.defaultValue }, set: { arguments[definition.id] = $0 })
    }
    private func choosePath(icon: Bool) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true; panel.canChooseDirectories = !icon
        panel.allowsMultipleSelection = false
        panel.message = icon ? store.t("editor.chooseIcon") : store.t("editor.choosePath")
        guard panel.runModal() == .OK, let url = panel.url else { return }
        if icon { iconPath = url.path }
        else {
            gamePath = url.path
            if title.isEmpty { title = url.deletingPathExtension().lastPathComponent }
        }
    }
    private func detect() async {
        await store.perform("editor.detectTask") {
            let result = try await bridge.call("detect", ["path": .string(gamePath), "includeRemote": .bool(store.settings["nonInstalledAutodetect"]?.boolValue != false)], tracked: true)
            let found = result["engine"].stringValue
            if found.isEmpty { validation = store.t("editor.detectFailed") }
            else { engine = found; validation = nil }
        }
        if let error = store.error { validation = error; store.error = nil }
    }
    private func save() async {
        guard !title.trimmingCharacters(in: .whitespaces).isEmpty, !gamePath.isEmpty, !engine.isEmpty else {
            validation = store.t("editor.required"); return
        }
        for def in definitions where def.type == "int" || def.type == "float" {
            guard case .number(let number) = arguments[def.id], number.isFinite, def.type != "int" || number == number.rounded() else {
                validation = store.t(def.type == "int" ? "editor.integerRequired" : "editor.numberRequired", ["label": def.label]); return
            }
        }
        for def in definitions where def.type == "array" {
            arguments[def.id] = .array((arguments[def.id]?.arrayValue ?? []).map {
                .string($0.stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
            }.filter { !$0.stringValue.isEmpty })
        }
        let normalizedTags = Array(Set(tags.replacingOccurrences(of: "，", with: ",").split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })).sorted()
        let data: [String: JSONValue] = [
            "gameTitle": .string(title), "gamePath": .string(gamePath), "iconPath": .string(iconPath),
            "tags": .array(normalizedTags.map(JSONValue.string)), "gameEngine": .string(engine), "gameArgs": .object(arguments)
        ]
        if await store.saveGame(id: game?.id, data: data) { dismiss() }
        else if let error = store.error { validation = error; store.error = nil }
    }
}

struct ArgumentField: View {
    @EnvironmentObject private var store: LauncherStore
    @EnvironmentObject private var bridge: NodeBridge
    let definition: ArgumentDefinition
    @Binding var value: JSONValue
    let engine: String
    let manageVersions: () -> Void
    @State private var installed: [String] = []
    @State private var numericText = ""
    var body: some View {
        Group {
            switch definition.type {
            case "boolean":
                Toggle(definition.label, isOn: Binding(get: { value.boolValue }, set: { value = .bool($0) }))
            case "dropdown", "select":
                Picker(definition.label, selection: textBinding) {
                    if !definition.options.contains(where: { $0.value == value.stringValue }) {
                        Text(value.stringValue.isEmpty ? store.t("argument.choose") : value.stringValue).tag(value.stringValue)
                    }
                    ForEach(definition.options, id: \.value) { option in Text(option.label).tag(option.value) }
                }
            case "multi-version":
                HStack {
                    Picker(definition.label, selection: textBinding) {
                        Text(store.t("argument.unselected")).tag("")
                        if !value.stringValue.isEmpty && !installed.contains(value.stringValue) {
                            Text(store.t("versions.notFound", ["version": value.stringValue])).tag(value.stringValue)
                        }
                        ForEach(installed, id: \.self) { Text($0).tag($0) }
                    }
                    Button(store.t("versions.manage"), action: manageVersions)
                }.task(id: engine + definition.id) { await refreshInstalled() }
                .onReceive(NotificationCenter.default.publisher(for: .engineVersionsChanged)) { _ in Task { await refreshInstalled() } }
            case "int", "float", "number":
                TextField(definition.label, text: $numericText)
                    .onAppear { numericText = value.stringValue }
                    .onChange(of: numericText) { text in
                        if let number = Double(text), number.isFinite { value = .number(number) }
                        else { value = .string(text) }
                    }
            case "array":
                VStack(alignment: .leading, spacing: 8) {
                    Text(definition.label)
                    ForEach(Array(value.arrayValue.enumerated()), id: \.offset) { index, _ in
                        HStack {
                            TextField(store.t("argument.value"), text: Binding(get: {
                                let values = value.arrayValue
                                return index < values.count ? values[index].stringValue : ""
                            }, set: { text in
                                var values = value.arrayValue
                                if index < values.count { values[index] = .string(text); value = .array(values) }
                            }))
                            Button { var values = value.arrayValue; values.remove(at: index); value = .array(values) } label: { Image(systemName: "minus.circle") }.buttonStyle(.borderless)
                        }
                    }
                    Button(store.t("argument.add")) { value = .array(value.arrayValue + [.string("")]) }.controlSize(.small)
                }
            default:
                TextField(definition.label, text: textBinding)
            }
        }
    }
    private var textBinding: Binding<String> {
        Binding(get: { value.stringValue }, set: { value = .string($0) })
    }
    private func refreshInstalled() async {
        do {
            let response = try await bridge.call("installedVersions", ["folder": .string(engine), "argKey": .string(definition.id)])
            installed = response.arrayValue.map(\.stringValue).sorted { $0.localizedStandardCompare($1) == .orderedDescending }
            if value.stringValue.isEmpty, let first = installed.first { value = .string(first) }
        } catch { bridge.appendLog(error.localizedDescription) }
    }
}

extension Notification.Name { static let engineVersionsChanged = Notification.Name("XenoEngineVersionsChanged") }
struct VersionTarget: Identifiable {
    let engine: String
    let definition: ArgumentDefinition
    var id: String { engine + ":" + definition.id }
}

struct VersionManagerView: View {
    @EnvironmentObject private var store: LauncherStore
    @EnvironmentObject private var bridge: NodeBridge
    @Environment(\.dismiss) private var dismiss
    let target: VersionTarget
    @State private var installed: [String] = []
    @State private var available: [String] = []
    @State private var selected = ""
    @State private var localError: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(target.definition.label).font(.title2.bold())
            Text(store.t("versions.count", ["engine": store.engineName(for: target.engine)], count: installed.count)).foregroundStyle(.secondary)
            if let localError { Text(localError).font(.callout).foregroundStyle(.red).textSelection(.enabled) }
            HStack {
                Picker(store.t("versions.available"), selection: $selected) {
                    Text(store.t("versions.choose")).tag("")
                    ForEach(available, id: \.self) { Text($0).tag($0) }
                }
                Button(store.t("common.install")) { Task { await run("installVersion", version: selected) } }.launcherPrimaryActionStyle().disabled(selected.isEmpty || installed.contains(selected) || store.busy)
            }
            List(installed, id: \.self) { version in
                HStack {
                    Label(version, systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    Spacer()
                    Button(store.t("common.remove"), role: .destructive) { Task {
                        if await store.confirm(store.t("versions.removeConfirm", ["version": version]), detail: store.t("versions.removeDetail")) { await run("removeVersion", version: version) }
                    } }.disabled(store.busy)
                }
            }.overlay { if installed.isEmpty { Text(store.t("versions.empty")).foregroundStyle(.secondary) } }
            if store.busy {
                HStack {
                    ProgressView().controlSize(.small)
                    Text(bridge.progressText).font(.caption).lineLimit(1)
                    Spacer()
                    if bridge.activeRequestID != nil { Button(store.t("common.cancelTask")) { bridge.cancel() } }
                }
            }
            HStack {
                Button(store.t("common.refresh")) { Task { await load() } }.disabled(store.busy)
                Spacer()
                Button(store.t("common.done")) { dismiss() }.keyboardShortcut(.cancelAction).disabled(store.busy)
            }
        }.padding(24).frame(width: 560, height: 460).task { await load() }.interactiveDismissDisabled(store.busy)
    }
    private var baseParams: [String: JSONValue] { ["folder": .string(target.engine), "argKey": .string(target.definition.id)] }
    private func apply(_ value: JSONValue) {
        installed = value["installed"].arrayValue.map(\.stringValue).sorted { $0.localizedStandardCompare($1) == .orderedDescending }
        if case .object = value["available"] {
            available = value["available"].objectValue.keys.sorted { $0.localizedStandardCompare($1) == .orderedDescending }
        }
        NotificationCenter.default.post(name: .engineVersionsChanged, object: nil)
    }
    private func load() async { await run("versions", version: nil) }
    private func run(_ method: String, version: String?) async {
        await store.perform("versions.task") {
            localError = nil
            var params = baseParams
            if let version { params["version"] = .string(version) }
            do { apply(try await bridge.call(method, params, tracked: true)) }
            catch { localError = error.localizedDescription }
        }
    }
}
