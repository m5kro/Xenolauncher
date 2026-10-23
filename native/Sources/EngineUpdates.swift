import Foundation

struct EngineUpdate: Equatable {
    let id: String
    let localVersion: String
    let remoteVersion: String
    let moduleUpdate: Bool
    let dependencyUpdate: Bool
    let checkFailed: Bool
    var action: String? { moduleUpdate ? "update" : dependencyUpdate ? "dependencies" : nil }

    init(_ value: JSONValue) {
        id = value["id"].stringValue
        localVersion = value["localVersion"].stringValue
        remoteVersion = value["remoteVersion"].stringValue
        moduleUpdate = value["moduleUpdate"].boolValue
        dependencyUpdate = value["dependencyUpdate"].boolValue
        checkFailed = value["checkFailed"].boolValue
    }
}

struct EngineUpdateReport {
    let checkedAt: Date?
    let cachedRemote: Bool
    let warnings: [String]
    let updates: [EngineUpdate]
    var available: [EngineUpdate] { updates.filter { $0.action != nil } }
    var incomplete: Bool { !warnings.isEmpty || updates.contains { $0.checkFailed } }

    init(_ value: JSONValue) {
        checkedAt = ISO8601DateFormatter().date(from: value["checkedAt"].stringValue)
            ?? ISO8601DateFormatter.withMilliseconds.date(from: value["checkedAt"].stringValue)
        cachedRemote = value["cachedRemote"].boolValue
        warnings = value["warnings"].arrayValue.map(\.stringValue)
        updates = value["updates"].arrayValue.map(EngineUpdate.init)
    }
}

private extension ISO8601DateFormatter {
    static var withMilliseconds: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }
}
