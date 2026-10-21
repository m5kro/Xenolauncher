import SwiftUI

struct EngineManagerView: View {
    @EnvironmentObject private var store: LauncherStore
    @State private var showAvailable = false
    private var displayed: [EngineModule] {
        (showAvailable ? store.remoteModules : store.modules).filter {
            store.search.isEmpty || $0.id.localizedCaseInsensitiveContains(store.search)
                || $0.name.localizedCaseInsensitiveContains(store.search)
                || $0.description.localizedCaseInsensitiveContains(store.search)
        }.sorted {
            let firstUpdates = store.engineUpdate(for: $0.id)?.action != nil
            let secondUpdates = store.engineUpdate(for: $1.id)?.action != nil
            if firstUpdates != secondUpdates { return firstUpdates }
            return $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 7) {
                    Text(store.t("engines.manage")).font(.title2.bold())
                }
                Spacer()
                Button {
                    showAvailable = true
                    Task { await store.fetchRemote() }
                } label: {
                    Label(store.t("engines.fetch"), systemImage: "arrow.down.circle")
                }.launcherSecondaryActionStyle().disabled(store.busy)
            }
            HStack(spacing: 12) {
                Button { Task { await store.checkEngineUpdates() } } label: {
                    Label(store.t("updates.check"), systemImage: "arrow.triangle.2.circlepath")
                }.launcherSecondaryActionStyle().disabled(store.busy || !store.bridge.connected)
                if store.engineUpdateCount > 0 {
                    Button(store.t("updates.all", ["count": String(store.engineUpdateCount)])) {
                        Task { await store.updateAllEngines() }
                    }.launcherPrimaryActionStyle().disabled(store.busy)
                }
                Spacer()
            }
            if let error = store.updateCheckError {
                Text(store.t("updates.failed") + " " + error).font(.callout).foregroundStyle(.orange).textSelection(.enabled)
            } else if let report = store.engineUpdates {
                VStack(alignment: .leading, spacing: 5) {
                    Text(store.t(report.incomplete ? "updates.partial" : report.available.isEmpty ? "updates.none" : "updates.found", count: report.available.count))
                        .foregroundStyle(report.incomplete ? Color.orange : Color.secondary)
                    if report.cachedRemote { Text(store.t("updates.cached")).foregroundStyle(.secondary) }
                    if let checkedAt = report.checkedAt {
                        HStack(spacing: 5) {
                            Text(store.t("updates.checkedAt"))
                            Text(checkedAt, style: .date)
                            Text(checkedAt, style: .time)
                        }.foregroundStyle(.secondary)
                    }
                }.font(.caption)
            } else {
                Text(store.t("updates.unchecked")).font(.caption).foregroundStyle(.secondary)
            }
            Picker(store.t("engines.filter"), selection: $showAvailable) {
                Text(store.t("engines.installedCount", ["count": String(store.modules.count)])).tag(false)
                Text(store.t("engines.available")).tag(true)
            }.pickerStyle(.segmented).frame(width: 280)
            if displayed.isEmpty {
                Spacer()
                VStack(spacing: 12) {
                    Image(systemName: "shippingbox").font(.system(size: 48, weight: .light))
                        .foregroundStyle(.secondary)
                    Text(showAvailable ? store.t("engines.fetchHint") : store.t("engines.empty")).font(.title3)
                    Text(store.t("engines.source")).font(.caption).foregroundStyle(
                        .secondary)
                }.frame(maxWidth: .infinity)
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(displayed) { module in
                            let installed = store.modules.first { $0.id == module.id }
                            let update = store.engineUpdate(for: module.id)
                            HStack(alignment: .top, spacing: 16) {
                                Image(systemName: "shippingbox.fill").font(.system(size: 28))
                                    .foregroundStyle(.tint).frame(width: 40).padding(.top, 4)
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text(module.name).font(.headline)
                                        Text(module.version).font(.caption).foregroundStyle(
                                            .secondary)
                                        if installed != nil {
                                            Text(store.t("engines.installed")).font(.caption2).foregroundStyle(.green)
                                        }
                                    }
                                    Text(module.description).font(.callout).foregroundStyle(
                                        .secondary
                                    ).fixedSize(horizontal: false, vertical: true)
                                    if let installed,
                                        showAvailable && installed.version != module.version
                                    {
                                        Text(store.t("engines.localVersion", ["version": installed.version])).font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    if let update {
                                        if update.moduleUpdate {
                                            Label(store.t("updates.moduleVersion", ["local": update.localVersion, "remote": update.remoteVersion]), systemImage: "arrow.up.circle.fill")
                                                .font(.caption).foregroundStyle(.orange)
                                        } else if update.dependencyUpdate {
                                            Label(store.t("updates.dependencies"), systemImage: "arrow.up.circle.fill")
                                                .font(.caption).foregroundStyle(.orange)
                                        }
                                        if update.checkFailed {
                                            Text(store.t("updates.rowFailed")).font(.caption).foregroundStyle(.orange)
                                        }
                                    }
                                }
                                Spacer(minLength: 12)
                                if installed == nil {
                                    Button(store.t("common.install")) {
                                        Task { await store.moduleTask(module, action: "install") }
                                    }.launcherPrimaryActionStyle().disabled(store.busy)
                                } else {
                                    if let action = update?.action {
                                        Button(store.t(action == "update" ? "updates.updateModule" : "updates.updateRuntime")) {
                                            Task { await store.moduleTask(module, action: action) }
                                        }.launcherPrimaryActionStyle().disabled(store.busy)
                                    }
                                    Menu(store.t("common.manage")) {
                                        Button(store.t("engines.update")) {
                                            Task {
                                                await store.moduleTask(module, action: "update")
                                            }
                                        }
                                        Button(store.t("engines.updateDependencies")) {
                                            Task {
                                                await store.moduleTask(
                                                    module, action: "dependencies")
                                            }
                                        }
                                        Divider()
                                        Button(store.t("engines.uninstallMenu"), role: .destructive) {
                                            Task {
                                                await store.moduleTask(module, action: "uninstall")
                                            }
                                        }
                                    }.fixedSize().disabled(store.busy)
                                }
                            }.padding(18).background(
                                .quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 12))
                        }
                    }
                }
            }
        }.padding(28)
    }
}
