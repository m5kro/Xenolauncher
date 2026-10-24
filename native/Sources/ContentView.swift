import SwiftUI
import AppKit

struct ContentView: View {
    @EnvironmentObject private var store: LauncherStore
    @EnvironmentObject private var bridge: NodeBridge

    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: "gamecontroller.fill").font(.system(size: 25)).foregroundStyle(.tint)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Xenolauncher").font(.headline)
                    }
                }.padding(20)
                List(selection: $store.route) {
                    Section(store.t("sidebar.library")) {
                        Label(store.t("library.all"), systemImage: "square.grid.2x2").badge(store.games.count).tag("library")
                        Label(store.t("engines.title"), systemImage: "shippingbox").badge(store.modules.count).tag("engines")
                    }
                    if !store.tags.isEmpty {
                        Section(store.t("sidebar.tags")) {
                            ForEach(store.tags, id: \.self) { tag in
                                Label(tag, systemImage: "tag").tag("tag:" + tag)
                            }
                        }
                    }
                    Section {
                        Label(store.t("settings.title"), systemImage: "gearshape").tag("settings")
                    }
                }.listStyle(.sidebar)
                Divider()
                HStack(spacing: 7) {
                    Circle().fill(bridge.connected ? Color.green : Color.orange).frame(width: 7, height: 7)
                    Text(bridge.connected ? store.t("service.connected") : store.t("service.offline")).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button { store.showingLog = true } label: { Image(systemName: "text.alignleft") }
                        .buttonStyle(.borderless).help(store.t("logs.title"))
                }.padding(16)
            }.navigationSplitViewColumnWidth(min: 210, ideal: 230, max: 280)
        } detail: {
            Group {
                if store.route == "engines" { EngineManagerView() }
                else if store.route == "settings" { SettingsView() }
                else { LibraryView() }
            }
            .launcherStatusBar { StatusBar() }
            .navigationTitle(title)
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    if store.route != "settings" && store.route != "engines" {
                        Button { Task { await store.updateSetting("listView", .bool(!store.listView)) } } label: {
                            Image(systemName: store.listView ? "square.grid.2x2" : "list.bullet")
                        }.help(store.t("library.toggleLayout")).disabled(store.busy)
                        Button { store.edit() } label: { Label(store.t("library.add"), systemImage: "plus") }
                            .help(store.t("library.addHelp")).disabled(store.busy || !bridge.connected)
                    }
                    Button { Task { await store.refresh() } } label: { Image(systemName: "arrow.clockwise") }
                        .help(store.t("common.refreshHelp")).disabled(store.busy || !bridge.connected)
                }
            }
        }
        // Draw one continuous window background beneath the title bar instead
        // of a separate toolbar backdrop scoped to the detail column.
        .background(Color(nsColor: .windowBackgroundColor).ignoresSafeArea())
        .toolbarBackground(.hidden, for: .windowToolbar)
        .searchable(text: $store.search, placement: .toolbar, prompt: store.t("search.prompt"))
        .sheet(isPresented: $store.showingEditor) {
            GameEditorView(game: store.editingGame).environmentObject(store).environmentObject(bridge)
        }
        .sheet(isPresented: $store.showingLog) { LogView().environmentObject(bridge) }
        .alert(store.t("error.title"), isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
            Button(store.t("common.ok")) { store.error = nil }
        } message: { Text(store.error ?? "") }
    }
    private var title: String {
        if store.route == "engines" { return store.t("engines.title") }
        if store.route == "settings" { return store.t("settings.title") }
        if store.route?.hasPrefix("tag:") == true { return String(store.route!.dropFirst(4)) }
        return store.t("library.title")
    }
}

struct LibraryView: View {
    @EnvironmentObject private var store: LauncherStore
    @EnvironmentObject private var bridge: NodeBridge

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(store.route?.hasPrefix("tag:") == true ? String(store.route!.dropFirst(4)) : store.t("library.all"))
                    .font(.largeTitle.bold())
                Text(store.t("library.count", count: store.filteredGames.count)).foregroundStyle(.secondary)
                Spacer()
            }.padding(.horizontal, 28).padding(.top, 24).padding(.bottom, 20)
            if store.filteredGames.isEmpty {
                Spacer()
                VStack(spacing: 14) {
                    Image(systemName: store.games.isEmpty ? "gamecontroller" : "magnifyingglass").font(.system(size: 52, weight: .light)).foregroundStyle(.secondary)
                    Text(store.games.isEmpty ? store.t("library.emptyTitle") : store.t("library.noMatches")).font(.title2.bold())
                    Text(store.games.isEmpty ? store.t("library.emptyDescription") : store.t("library.searchHint")).foregroundStyle(.secondary)
                    if store.games.isEmpty {
                        Button(store.t("library.addMenu")) { store.edit() }.launcherPrimaryActionStyle().disabled(store.busy || !bridge.connected)
                    }
                    if !bridge.connected {
                        Button(store.t("service.reconnectFull")) { Task { await store.start() } }.disabled(store.busy)
                    }
                }.frame(maxWidth: .infinity)
                Spacer()
            } else {
                ScrollView {
                    if store.listView {
                        LazyVStack(spacing: 10) {
                            ForEach(store.filteredGames) { GameRow(game: $0) }
                        }.padding(.horizontal, 28).padding(.bottom, 24)
                    } else {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 185, maximum: 260), spacing: 18)], spacing: 18) {
                            ForEach(store.filteredGames) { GameCard(game: $0) }
                        }.padding(.horizontal, 28).padding(.bottom, 24)
                    }
                }
            }
        }
    }
}

struct GameArtwork: View {
    let game: GameRecord
    var size: CGFloat = 64
    var body: some View {
        Group {
            if !game.iconPath.isEmpty, let icon = NSImage(contentsOfFile: game.iconPath) {
                Image(nsImage: icon).resizable().scaledToFit()
            } else {
                Image(nsImage: NSWorkspace.shared.icon(forFile: game.path)).resizable().scaledToFit()
            }
        }.frame(width: size, height: size).accessibilityHidden(true)
    }
}

struct GameCard: View {
    @EnvironmentObject private var store: LauncherStore
    let game: GameRecord
    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            ZStack {
                RoundedRectangle(cornerRadius: 12).fill(Color.accentColor.opacity(0.08))
                GameArtwork(game: game, size: 76)
            }.frame(height: 128)
            VStack(alignment: .leading, spacing: 5) {
                Text(store.gameTitle(game)).font(.headline).lineLimit(1).help(store.gameTitle(game))
                Text(store.engineName(for: game.engine)).font(.caption).foregroundStyle(.secondary)
                Text(game.tags.isEmpty ? store.t("game.uncategorized") : game.tags.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            HStack {
                Button { Task { await store.launch(game) } } label: { Label(store.t("game.launch"), systemImage: "play.fill").frame(maxWidth: .infinity) }
                    .launcherPrimaryActionStyle().controlSize(.small).disabled(store.busy)
                GameMoreMenu(game: game)
            }
        }.padding(13)
            .background(.background, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(.primary.opacity(0.08)))
            .contextMenu { GameActions(game: game) }
            .onTapGesture(count: 2) { Task { await store.launch(game) } }
    }
}

struct GameRow: View {
    @EnvironmentObject private var store: LauncherStore
    let game: GameRecord
    var body: some View {
        HStack(spacing: 16) {
            GameArtwork(game: game, size: 48)
            VStack(alignment: .leading, spacing: 5) {
                Text(store.gameTitle(game)).font(.headline)
                Text(([store.engineName(for: game.engine)] + game.tags).joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button { Task { await store.launch(game) } } label: { Label(store.t("game.launch"), systemImage: "play.fill") }.launcherSecondaryActionStyle().disabled(store.busy)
            GameMoreMenu(game: game)
        }.padding(14).background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 12))
            .contextMenu { GameActions(game: game) }
            .onTapGesture(count: 2) { Task { await store.launch(game) } }
    }
}

struct GameMoreMenu: View {
    @EnvironmentObject private var store: LauncherStore
    let game: GameRecord

    var body: some View {
        Menu { GameActions(game: game) } label: {
            Label(store.t("game.more"), systemImage: "ellipsis")
                .labelStyle(.iconOnly)
                .frame(width: 28, height: 28)
        }
        .menuStyle(.button)
        .buttonStyle(.borderless)
        .menuIndicator(.hidden)
        .fixedSize()
        .help(store.t("game.more"))
        .disabled(store.busy)
    }
}

struct GameActions: View {
    @EnvironmentObject private var store: LauncherStore
    let game: GameRecord
    var body: some View {
        Button(store.t("game.settingsMenu")) { store.edit(game) }.disabled(store.busy)
        Button(store.t("game.reveal")) { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: game.path)]) }
        Divider()
        Button(store.t("game.removeMenu"), role: .destructive) { Task { await store.delete(game) } }.disabled(store.busy)
    }
}

struct StatusBar: View {
    @EnvironmentObject private var store: LauncherStore
    @EnvironmentObject private var bridge: NodeBridge
    var body: some View {
        HStack(spacing: 10) {
            if store.busy || store.checkingEngineUpdates { ProgressView().controlSize(.small) }
            Text(store.busy ? (bridge.progressText.isEmpty ? store.taskTitle : bridge.progressText)
                : store.checkingEngineUpdates ? store.t("updates.checking") : store.status)
                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            Spacer()
            if store.busy, let fraction = bridge.fraction { ProgressView(value: fraction).frame(width: 100) }
            if !store.busy && store.engineUpdateCount > 0 && store.route != "engines" {
                Button(store.t("updates.view", ["count": String(store.engineUpdateCount)])) { store.route = "engines" }
                    .controlSize(.small)
            }
            if store.busy && bridge.activeRequestID != nil {
                Button(store.t("common.cancel")) { bridge.cancel() }.controlSize(.small)
            }
            if !bridge.connected && !store.busy {
                Button(store.t("service.reconnect")) { Task { await store.start() } }.controlSize(.small)
            }
            Button { store.showingLog = true } label: { Image(systemName: "terminal") }.buttonStyle(.borderless).help(store.t("logs.title"))
        }.padding(.horizontal, 18).frame(height: 38)
    }
}

struct LogView: View {
    @EnvironmentObject private var store: LauncherStore
    @EnvironmentObject private var bridge: NodeBridge
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack { Text(store.t("logs.title")).font(.title2.bold()); Spacer(); Button(store.t("common.done")) { dismiss() }.keyboardShortcut(.cancelAction) }
            ScrollView {
                Text(bridge.logs.isEmpty ? store.t("logs.empty") : bridge.logs.joined(separator: "\n"))
                    .font(.system(.caption, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            }.padding(12).background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 10))
            HStack { Text("Node.js \(bridge.nodeVersion)").font(.caption).foregroundStyle(.secondary); Spacer(); Button(store.t("logs.clear")) { bridge.logs = [] } }
        }.padding(24).frame(width: 720, height: 450)
    }
}
