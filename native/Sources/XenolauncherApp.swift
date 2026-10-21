import SwiftUI

@main
struct XenolauncherApp: App {
    @NSApplicationDelegateAdaptor(LauncherAppDelegate.self) private var appDelegate
    @StateObject private var store = LauncherStore()

    var body: some Scene {
        WindowGroup("Xenolauncher") {
            ContentView()
                .environmentObject(store)
                .environmentObject(store.bridge)
                .environment(\.locale, store.localization.locale)
                .frame(minWidth: 900, minHeight: 600)
                .task { if store.dataPath.isEmpty { await store.start() } }
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in store.bridge.stop() }
        }
        .defaultSize(width: 1120, height: 740)
        .windowToolbarStyle(.unifiedCompact(showsTitle: true))
        .commands {
            CommandGroup(replacing: .newItem) {
                Button(store.t("library.addMenu")) { store.edit() }.keyboardShortcut("n").disabled(store.busy)
            }
            CommandGroup(after: .newItem) {
                Button(store.t("task.refresh")) { Task { await store.refresh() } }.keyboardShortcut("r").disabled(store.busy)
                Button(store.t("commands.logs")) { store.showingLog = true }.keyboardShortcut("l", modifiers: [.command, .shift])
            }
        }
        Settings {
            SettingsView().environmentObject(store).environmentObject(store.bridge)
                .environment(\.locale, store.localization.locale)
                .frame(width: 620, height: 570)
        }
    }
}

@MainActor
final class LauncherAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // SwiftPM/Xcode executable launches also use the bundled icon in the Dock.
        guard let url = Bundle.module.url(forResource: "AppIcon", withExtension: "icns"),
              let icon = NSImage(contentsOf: url) else { return }
        NSApplication.shared.applicationIconImage = icon
    }
}
