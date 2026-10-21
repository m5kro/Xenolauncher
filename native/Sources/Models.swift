import Foundation

enum JSONValue: Codable, Hashable {
    case string(String), number(Double), bool(Bool), array([JSONValue]), object([String: JSONValue]), null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
    subscript(_ key: String) -> JSONValue { objectValue[key] ?? .null }
    var objectValue: [String: JSONValue] { if case .object(let v) = self { return v }; return [:] }
    var arrayValue: [JSONValue] { if case .array(let v) = self { return v }; return [] }
    var stringValue: String {
        switch self {
        case .string(let v): return v
        case .number(let v): return v == v.rounded() ? String(format: "%.0f", v) : String(v)
        case .bool(let v): return v ? "true" : "false"
        default: return ""
        }
    }
    var boolValue: Bool { if case .bool(let v) = self { return v }; return false }
    var doubleValue: Double { if case .number(let v) = self { return v }; return 0 }
}

struct GameRecord: Identifiable, Hashable {
    var data: [String: JSONValue]
    var id: String { data["id"]?.stringValue ?? "" }
    var title: String { data["gameTitle"]?.stringValue ?? "" }
    var path: String { data["gamePath"]?.stringValue ?? "" }
    var iconPath: String { data["iconPath"]?.stringValue ?? "" }
    var engine: String { data["gameEngine"]?.stringValue ?? "" }
    var tags: [String] { data["tags"]?.arrayValue.map(\.stringValue) ?? [] }
    var arguments: [String: JSONValue] { data["gameArgs"]?.objectValue ?? [:] }
}

struct EngineModule: Identifiable, Hashable {
    var data: [String: JSONValue]
    var id: String { data["id"]?.stringValue ?? data["folder"]?.stringValue ?? "" }
    var name: String { data["name"]?.stringValue ?? id }
    var version: String { data["version"]?.stringValue ?? "—" }
    var description: String { data["description"]?.stringValue ?? "" }
    var arguments: [ArgumentDefinition] {
        let raw = data["gameArgs"]?.objectValue ?? data["raw"]?["gameArgs"].objectValue ?? [:]
        return raw.keys.sorted().map { ArgumentDefinition(id: $0, data: raw[$0]!.objectValue) }
    }
}

struct ArgumentDefinition: Identifiable, Hashable {
    var id: String
    var data: [String: JSONValue]
    var label: String { data["label"]?.stringValue ?? id }
    var type: String { data["type"]?.stringValue ?? "string" }
    var defaultValue: JSONValue {
        if let value = data["default"] { return value }
        if type == "boolean" { return .bool(false) }
        if type == "array" { return .array([]) }
        if type == "int" || type == "float" { return .number(0) }
        return .string("")
    }
    var options: [(label: String, value: String)] {
        (data["options"]?.arrayValue ?? []).map {
            if case .object = $0 { return ($0["label"].stringValue, $0["value"].stringValue) }
            return ($0.stringValue, $0.stringValue)
        }
    }
}
