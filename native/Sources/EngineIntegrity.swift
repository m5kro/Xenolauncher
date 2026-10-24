import SwiftUI

struct EngineIntegrityReport: Identifiable {
    struct Issue: Identifiable {
        let path: String
        let reason: String
        var id: String { path + reason }
    }
    let id: String
    let status: String
    let checkedFiles: Int
    let issues: [Issue]
    let unverified: [String]
    let localVersion: String
    let remoteVersion: String
    let remoteError: String
    let moduleUpdate: Bool
    var canRepair: Bool { status != "healthy" || moduleUpdate }

    init(_ value: JSONValue) {
        id = value["folder"].stringValue
        status = value["status"].stringValue
        checkedFiles = Int(value["checkedFiles"].doubleValue)
        issues = value["issues"].arrayValue.map { Issue(path: $0["path"].stringValue, reason: $0["reason"].stringValue) }
        unverified = value["unverified"].arrayValue.map(\.stringValue)
        localVersion = value["localVersion"].stringValue
        remoteVersion = value["remoteVersion"].stringValue
        remoteError = value["remoteError"].stringValue
        moduleUpdate = value["moduleUpdate"].boolValue
    }
}

struct EngineIntegrityView: View {
    @EnvironmentObject private var store: LauncherStore
    let report: EngineIntegrityReport

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label(store.t("integrity.title", ["module": store.engineName(for: report.id)]), systemImage: "checkmark.shield")
                .font(.title2.bold())
            Text(store.t("integrity.result." + report.status)).font(.headline)
                .foregroundStyle(report.status == "healthy" ? Color.green : Color.orange)
            Text(store.t("integrity.count", ["count": String(report.checkedFiles), "issues": String(report.issues.count)]))
                .foregroundStyle(.secondary)
            if report.moduleUpdate {
                Text(store.t("integrity.newVersion", ["local": report.localVersion, "remote": report.remoteVersion]))
            }
            if !report.remoteError.isEmpty {
                Text(store.t("integrity.remoteFailed") + " " + report.remoteError)
                    .font(.callout).foregroundStyle(.orange).textSelection(.enabled)
            }
            if !report.unverified.isEmpty {
                Text(store.t("integrity.noBaseline")).font(.callout).foregroundStyle(.secondary)
            }
            if !report.issues.isEmpty || !report.unverified.isEmpty {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(report.issues) { issue in
                            Text(store.t("integrity.issue." + issue.reason) + ": " + issue.path)
                        }
                        ForEach(report.unverified, id: \.self) { path in
                            Text(store.t("integrity.issue.unverified") + ": " + path)
                        }
                    }.font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }.frame(maxHeight: 220)
            }
            if report.canRepair {
                Text(store.t("integrity.repairHint")).font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                Spacer()
                Button(store.t("common.close")) { store.integrityReport = nil }.keyboardShortcut(.cancelAction)
                if report.canRepair {
                    Button(store.t(report.moduleUpdate ? "integrity.update" : "integrity.repair")) {
                        store.integrityReport = nil
                        Task { await store.repairEngine(report.id) }
                    }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                }
            }
        }.padding(24).frame(width: 580)
    }
}
