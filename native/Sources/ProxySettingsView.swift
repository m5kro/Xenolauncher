import SwiftUI

struct ProxySettingsView: View {
    @EnvironmentObject private var store: LauncherStore
    @EnvironmentObject private var bridge: NodeBridge
    @State private var mode = "system"
    @State private var scheme = "http"
    @State private var host = ""
    @State private var port = ""
    @State private var username = ""
    @State private var password = ""

    var body: some View {
        Section(store.t("proxy.title")) {
            Picker(store.t("proxy.mode"), selection: $mode) {
                Text(store.t("proxy.off")).tag("off")
                Text(store.t("proxy.system")).tag("system")
                Text(store.t("proxy.custom")).tag("custom")
            }
            if mode == "custom" {
                Picker(store.t("proxy.protocol"), selection: $scheme) {
                    Text("HTTP").tag("http")
                    Text("HTTPS").tag("https")
                    Text("SOCKS5").tag("socks5h")
                    Text("SOCKS4").tag("socks4")
                    Text("SOCKS4a").tag("socks4a")
                }
                TextField(store.t("proxy.host"), text: $host, prompt: Text("127.0.0.1"))
                TextField(store.t("proxy.port"), text: $port, prompt: Text("7890"))
                TextField(store.t("proxy.username"), text: $username)
                SecureField(store.t("proxy.password"), text: $password)
                Text(store.t("proxy.credentialsHint")).font(.caption).foregroundStyle(.secondary)
            }
            Text(store.t(mode == "system" ? "proxy.systemHint" : "proxy.scopeHint"))
                .font(.caption).foregroundStyle(.secondary)
            Button(store.t("proxy.save")) {
                Task { await store.updateSetting("networkProxy", draft) }
            }
            .disabled(!bridge.connected || unchanged || (mode == "custom" && customURL == nil))
        }
        .onAppear(perform: load)
        .onChange(of: saved) { _ in load() }
    }

    private var saved: JSONValue { store.settings["networkProxy"] ?? .object(["mode": .string("system"), "url": .string("")]) }
    private var customURL: String? {
        let server = host.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !server.isEmpty, !server.contains(where: { $0.isWhitespace || "/@?#".contains($0) }),
              let number = Int(port), (1...65535).contains(number) else { return nil }
        var url = URLComponents()
        url.scheme = scheme
        url.host = server
        url.port = number
        if !username.isEmpty { url.user = username }
        if !password.isEmpty { url.password = password }
        return url.url?.absoluteString
    }
    private var draft: JSONValue {
        .object(["mode": .string(mode), "url": .string(customURL ?? saved["url"].stringValue)])
    }
    private var unchanged: Bool {
        guard mode == saved["mode"].stringValue else { return false }
        if mode != "custom" { return true }
        guard let url = URLComponents(string: saved["url"].stringValue) else { return false }
        let defaultPort = scheme == "https" ? 443 : scheme == "http" ? 80 : 1080
        return (url.scheme == scheme || (url.scheme == "socks5" && scheme == "socks5h"))
            && url.host == host && (url.port ?? defaultPort) == Int(port)
            && (url.user ?? "") == username && (url.password ?? "") == password
    }
    private func load() {
        mode = saved["mode"].stringValue
        guard let url = URLComponents(string: saved["url"].stringValue), let protocolName = url.scheme else { return }
        scheme = protocolName == "socks5" ? "socks5h" : protocolName
        host = url.host ?? ""
        port = url.port.map(String.init) ?? (scheme == "https" ? "443" : scheme == "http" ? "80" : "1080")
        username = url.user ?? ""
        password = url.password ?? ""
    }
}
