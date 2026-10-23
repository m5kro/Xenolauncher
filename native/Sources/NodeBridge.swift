import AppKit
import Combine
import Foundation

struct LauncherError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

@MainActor
final class NodeBridge: ObservableObject {
    @Published var connected = false
    @Published var logs: [String] = []
    @Published var progressLabel = ""
    @Published var progressMessage: LocalizedMessage?
    var progressText: String { progressMessage.map { localization.text($0) } ?? progressLabel }
    private let localization: Localization

    init(localization: Localization? = nil) {
        self.localization = localization ?? Localization()
    }
    @Published var fraction: Double?
    @Published var activeRequestID: String?
    @Published var nodeVersion = ""
    var onDisconnect: (() -> Void)?
    private var process: Process?
    private var input: FileHandle?
    private var output: FileHandle?
    private var errors: FileHandle?
    private var buffer = Data()
    private var pending: [String: CheckedContinuation<JSONValue, Error>] = [:]
    private var dialogQueue: [JSONValue] = []
    private var presentingDialog = false
    private var stopped = false

    func start() throws {
        guard process == nil else { return }
        stopped = false
        let bundleBackend = Bundle.main.resourceURL?.appendingPathComponent("Backend")
        let packageBackend = Bundle.module.resourceURL!.appendingPathComponent("Backend")
        let backend = [bundleBackend, packageBackend].compactMap { $0 }.first {
            FileManager.default.fileExists(atPath: $0.appendingPathComponent("worker.cjs").path)
        } ?? packageBackend
        let candidates = [
            ProcessInfo.processInfo.environment["XENO_NODE_PATH"],
            backend.appendingPathComponent("node").path,
            "/opt/homebrew/bin/node", "/usr/local/bin/node"
        ].compactMap { $0 }
        guard let node = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
            throw LauncherError(message: localization.text("bridge.missingNode"))
        }
        let task = Process()
        let stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
        task.executableURL = URL(fileURLWithPath: node)
        task.arguments = [backend.appendingPathComponent("worker.cjs").path]
        task.standardInput = stdin
        task.standardOutput = stdout
        task.standardError = stderr
        var environment = ProcessInfo.processInfo.environment
        // Development builds can locate the source without duplicating it.
        if !FileManager.default.fileExists(atPath: backend.appendingPathComponent("upstream/module.js").path) {
            let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("app/module.js")
            environment["XENO_CORE_PATH"] = source.path
        }
        task.environment = environment
        input = stdin.fileHandleForWriting
        output = stdout.fileHandleForReading
        errors = stderr.fileHandleForReading
        output?.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if !data.isEmpty { Task { @MainActor in self?.receive(data) } }
        }
        errors?.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if let text = String(data: data, encoding: .utf8), !text.isEmpty {
                Task { @MainActor in self?.appendLog(text.trimmingCharacters(in: .whitespacesAndNewlines)) }
            }
        }
        task.terminationHandler = { [weak self] task in
            Task { @MainActor in self?.disconnected(status: task.terminationStatus) }
        }
        process = task
        do { try task.run() }
        catch { stop(); throw error }
    }

    func call(_ method: String, _ params: [String: JSONValue] = [:], tracked: Bool = false) async throws -> JSONValue {
        guard let process, process.isRunning else { throw LauncherError(message: localization.text("bridge.notConnected")) }
        let id = UUID().uuidString
        if tracked { activeRequestID = id; fraction = nil; progressMessage = "bridge.preparing"; progressLabel = "" }
        defer { if activeRequestID == id { activeRequestID = nil } }
        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            do { try send(.object(["id": .string(id), "method": .string(method), "params": .object(params)])) }
            catch { pending.removeValue(forKey: id)?.resume(throwing: error) }
        }
    }

    func cancel() {
        guard let id = activeRequestID else { return }
        try? send(.object(["method": .string("cancel"), "params": .object(["requestID": .string(id)])]))
        progressMessage = "bridge.cancelling"
    }

    private func send(_ value: JSONValue) throws {
        guard let input else { throw LauncherError(message: localization.text("bridge.disconnected")) }
        var data = try JSONEncoder().encode(value)
        data.append(0x0a)
        try input.write(contentsOf: data)
    }
    private func receive(_ data: Data) {
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 0x0a) {
            let line = buffer[..<newline]
            buffer.removeSubrange(...newline)
            guard let message = try? JSONDecoder().decode(JSONValue.self, from: Data(line)) else { continue }
            if !message["id"].stringValue.isEmpty {
                guard let continuation = pending.removeValue(forKey: message["id"].stringValue) else { continue }
                if case .object = message["error"] {
                    let error = message["error"]
                    let key = error["key"].stringValue
                    let arguments = error["arguments"].objectValue.mapValues(\.stringValue)
                    continuation.resume(throwing: LauncherError(message: key.isEmpty
                        ? error["message"].stringValue : localization.text(key, arguments)))
                } else { continuation.resume(returning: message["result"]) }
                continue
            }
            switch message["event"].stringValue {
            case "ready": connected = true; nodeVersion = message["nodeVersion"].stringValue
            case "log": appendLog(message["message"].stringValue)
            case "dialog": dialogQueue.append(message); presentNextDialog()
            case "progress":
                let detail = message["detail"]
                if !message["key"].stringValue.isEmpty {
                    progressMessage = LocalizedMessage(message["key"].stringValue, message["arguments"].objectValue.mapValues(\.stringValue))
                } else if !detail["label"].stringValue.isEmpty {
                    progressMessage = nil
                    progressLabel = detail["label"].stringValue
                }
                let total = detail["totalBytes"].doubleValue
                if total > 0 { fraction = min(1, max(0, detail["downloadedBytes"].doubleValue / total)) }
                else if detail["total"].doubleValue > 0 && detail["current"].doubleValue > 0 {
                    fraction = detail["current"].doubleValue / detail["total"].doubleValue
                }
            default: break
            }
        }
    }
    func appendLog(_ message: String) {
        logs.append(message)
        if logs.count > 400 { logs.removeFirst(logs.count - 400) }
    }
    private func presentNextDialog() {
        guard !presentingDialog, !dialogQueue.isEmpty else { return }
        let message = dialogQueue.removeFirst()
        presentingDialog = true
        let alert = NSAlert()
        alert.messageText = message["title"].stringValue
        alert.informativeText = message["message"].stringValue
        alert.addButton(withTitle: localization.text("common.ok"))
        if message["kind"].stringValue == "confirm" { alert.addButton(withTitle: localization.text("common.cancel")) }
        let finish: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard let self else { return }
            try? self.send(.object(["method": .string("dialogReply"), "params": .object([
                "dialogID": message["dialogID"], "accepted": .bool(response == .alertFirstButtonReturn)
            ])]))
            self.presentingDialog = false
            self.presentNextDialog()
        }
        if let window = NSApp.keyWindow { alert.beginSheetModal(for: window, completionHandler: finish) }
        else { finish(alert.runModal()) }
    }
    private func disconnected(status: Int32) {
        connected = false
        let failure = LauncherError(message: localization.text("bridge.exited", ["status": String(status)]))
        let continuations = Array(pending.values)
        pending.removeAll()
        continuations.forEach { $0.resume(throwing: failure) }
        if !stopped { appendLog(failure.message); onDisconnect?() }
        output?.readabilityHandler = nil
        errors?.readabilityHandler = nil
        input = nil; process = nil
    }
    func stop() {
        stopped = true
        try? input?.close()
        if process?.isRunning == true { process?.terminate() }
        output?.readabilityHandler = nil
        errors?.readabilityHandler = nil
        connected = false
    }
}
