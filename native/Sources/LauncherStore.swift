import AppKit
import Combine
import Foundation

@MainActor
final class LauncherStore: ObservableObject {
    let bridge: NodeBridge
    let localization: Localization
    private var languageChanges: AnyCancellable?

    init(localization: Localization? = nil) {
        let localization = localization ?? Localization()
        self.localization = localization
        self.bridge = NodeBridge(localization: localization)
        languageChanges = localization.objectWillChange.sink { [weak self] _ in
            self?.objectWillChange.send()
        }
        localization.diagnostics.forEach { bridge.appendLog($0) }
    }
    func t(_ key: String, _ arguments: [String: String] = [:], count: Int? = nil) -> String {
        localization.text(key, arguments, count: count)
    }
    func gameTitle(_ game: GameRecord) -> String {
        game.title.isEmpty ? t("game.untitled") : game.title
    }
    func engineName(for id: String) -> String {
        let module = modules.first { $0.id == id } ?? remoteModules.first { $0.id == id }
        guard let name = module?.name, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return id }
        return name
    }
    var language: String { settings["language"]?.stringValue ?? "system" }
    var taskTitle: String { taskMessage.map { localization.text($0) } ?? "" }
    var status: String { localization.text(statusMessage) }
    @Published var games: [GameRecord] = []
    @Published var modules: [EngineModule] = []
    @Published var remoteModules: [EngineModule] = []
    @Published var engineUpdates: EngineUpdateReport?
    @Published var updateCheckError: String?
    private var startupUpdateCheckDone = false
    var engineUpdateCount: Int { engineUpdates?.available.count ?? 0 }
    func engineUpdate(for id: String) -> EngineUpdate? { engineUpdates?.updates.first { $0.id == id } }
    @Published var settings: [String: JSONValue] = [:]
    @Published var route: String? = "library"
    @Published var search = ""
    @Published var busy = false
    @Published var taskMessage: LocalizedMessage?
    @Published var statusMessage: LocalizedMessage = "status.connecting"
    @Published var error: String?
    @Published var dataPath = ""
    @Published var showingEditor = false
    @Published var editingGame: GameRecord?
    @Published var showingLog = false

    var tags: [String] { Array(Set(games.flatMap(\.tags))).sorted() }
    var listView: Bool { settings["listView"]?.boolValue ?? false }
    var appearance: AppearanceMode { AppearanceMode(settings: settings) }
    var filteredGames: [GameRecord] {
        games.filter { game in
            let tag = route?.hasPrefix("tag:") == true ? String(route!.dropFirst(4)) : nil
            let matchesTag = tag == nil || game.tags.contains(tag!)
            let matchesSearch =
                search.isEmpty
                || ([game.title, game.engine, engineName(for: game.engine)] + game.tags).contains {
                    $0.localizedCaseInsensitiveContains(search)
                }
            return matchesTag && matchesSearch
        }.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }
    func start() async {
        guard !busy else { return }
        await perform("task.connect") {
            try self.bridge.start()
            self.apply(try await self.bridge.call("snapshot"))
            self.statusMessage = "status.ready"
        }
        if bridge.connected && !startupUpdateCheckDone {
            startupUpdateCheckDone = true
            if settings["checkModuleUpdatesOnStartup"]?.boolValue != false && !modules.isEmpty {
                await checkEngineUpdates(automatic: true)
            }
        }
    }
    func refresh() async {
        await perform("task.refresh") {
            self.apply(try await self.bridge.call("snapshot"))
            self.statusMessage = "status.refreshed"
            if self.route == "engines" { try await self.loadEngineUpdates() }
        }
    }
    func apply(_ snapshot: JSONValue) {
        games = snapshot["games"].arrayValue.map { GameRecord(data: $0.objectValue) }
        modules = snapshot["modules"].arrayValue.map { EngineModule(data: $0.objectValue) }.sorted {
            $0.name < $1.name
        }
        settings = snapshot["settings"].objectValue
        if case .object = snapshot["engineUpdates"] { engineUpdates = EngineUpdateReport(snapshot["engineUpdates"]) }
        else { engineUpdates = nil }
        localization.select(language)
        ApplicationAppearance.apply(appearance)
        dataPath = snapshot["dataPath"].stringValue
    }
    func perform(_ title: LocalizedMessage, presentError: Bool = true, operation: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        taskMessage = title
        bridge.progressMessage = title
        bridge.progressLabel = ""
        bridge.fraction = nil
        defer {
            busy = false
            taskMessage = nil
        }
        do { try await operation() } catch {
            if presentError { self.error = error.localizedDescription }
            else { bridge.appendLog(error.localizedDescription) }
            statusMessage = "error.title"
        }
    }
    func edit(_ game: GameRecord? = nil) {
        editingGame = game
        showingEditor = true
    }
    func saveGame(id: String?, data: [String: JSONValue]) async -> Bool {
        var saved = false
        await perform("task.saveGame") {
            var params: [String: JSONValue] = ["game": .object(data)]
            if let id { params["id"] = .string(id) }
            self.apply(try await self.bridge.call("saveGame", params))
            self.statusMessage = "status.savedGame"
            saved = true
        }
        return saved
    }
    func launch(_ game: GameRecord) async {
        await perform(LocalizedMessage("task.launch", ["game": gameTitle(game)])) {
            _ = try await self.bridge.call("launch", ["id": .string(game.id)], tracked: true)
            self.statusMessage = LocalizedMessage("status.launched", ["engine": self.engineName(for: game.engine)])
        }
    }
    func delete(_ game: GameRecord) async {
        if settings["deletionConfirmation"]?.boolValue != false {
            guard await confirm(t("confirm.removeGame", ["game": gameTitle(game)]), detail: t("confirm.removeGameDetail")) else {
                return
            }
        }
        await perform("task.removeGame") {
            self.apply(
                try await self.bridge.call("deleteGame", ["id": .string(game.id)], tracked: true))
            self.statusMessage = "status.removedGame"
        }
    }
    func updateSetting(_ key: String, _ value: JSONValue) async {
        await perform("task.settings") {
            self.apply(try await self.bridge.call("saveSettings", [key: value]))
            self.statusMessage = "status.settings"
        }
    }
    func fetchRemote() async {
        await perform("engines.fetch") {
            try await self.loadEngineUpdates()
        }
    }
    func checkEngineUpdates(automatic: Bool = false) async {
        await perform("updates.checking", presentError: !automatic) {
            try await self.loadEngineUpdates()
        }
    }
    private func loadEngineUpdates() async throws {
        updateCheckError = nil
        do {
            let response = try await bridge.call("checkEngineUpdates", ["forceRefresh": .bool(true)], tracked: true)
            let report = EngineUpdateReport(response)
            engineUpdates = report
            remoteModules = response["remoteModules"].arrayValue.map { EngineModule(data: $0.objectValue) }.sorted { $0.name < $1.name }
            report.warnings.forEach { bridge.appendLog($0) }
            statusMessage = report.incomplete ? "updates.partial" : report.available.isEmpty ? "updates.none"
                : LocalizedMessage("updates.found", count: report.available.count)
        } catch {
            updateCheckError = error.localizedDescription
            throw error
        }
    }
    private func recheckAfterModuleTask() async {
        do { try await loadEngineUpdates() }
        catch { bridge.appendLog(error.localizedDescription) }
    }
    func updateAllEngines() async {
        guard engineUpdateCount > 0 else { return }
        await perform("updates.updatingAll") {
            do {
                self.apply(try await self.bridge.call("updateAllEngines", tracked: true))
            } catch {
                // Earlier items may have succeeded; show their actual state even
                // if a later item failed or was cancelled and restored.
                if let snapshot = try? await self.bridge.call("snapshot") { self.apply(snapshot) }
                throw error
            }
            await self.recheckAfterModuleTask()
            self.statusMessage = "status.engineTask"
        }
    }
    func moduleTask(_ module: EngineModule, action: String) async {
        if action == "uninstall" {
            guard await confirm(t("confirm.uninstall", ["module": module.name]), detail: t("confirm.uninstallDetail")) else {
                return
            }
        }
        await perform(LocalizedMessage(action == "uninstall" ? "task.uninstall" : "task.installUpdate", ["module": module.name])) {
            self.apply(
                try await self.bridge.call(
                    "moduleTask", ["folder": .string(module.id), "action": .string(action)],
                    tracked: true))
            await self.recheckAfterModuleTask()
            self.statusMessage = "status.engineTask"
        }
    }
    func confirm(_ title: String, detail: String) async -> Bool {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = detail
        alert.addButton(withTitle: t("common.ok"))
        alert.addButton(withTitle: t("common.cancel"))
        guard let window = NSApp.keyWindow else {
            return alert.runModal() == .alertFirstButtonReturn
        }
        return await withCheckedContinuation { continuation in
            alert.beginSheetModal(for: window) {
                continuation.resume(returning: $0 == .alertFirstButtonReturn)
            }
        }
    }
}
