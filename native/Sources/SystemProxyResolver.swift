import CFNetwork
import Foundation

enum SystemProxyResolver {
    // CFNetwork applies macOS bypass rules and selects proxies for each URL.
    // PAC work runs on a private run loop, leaving the app's main actor free.
    static func resolve(_ url: URL) async throws -> [String] {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                do {
                    guard let settings = CFNetworkCopySystemProxySettings()?.takeRetainedValue() else {
                        throw ProxyError.unavailable
                    }
                    let list = CFNetworkCopyProxiesForURL(url as CFURL, settings).takeRetainedValue()
                    continuation.resume(returning: try routes(list as! [[String: Any]], for: url))
                } catch { continuation.resume(throwing: error) }
            }
        }
    }

    enum ProxyError: Error { case unavailable, invalid, timeout }

    static func routes(_ proxies: [[String: Any]], for url: URL) throws -> [String] {
        var result: [String] = []
        for proxy in proxies {
            let type = proxy[kCFProxyTypeKey as String] as? String
            if type == kCFProxyTypeNone as String { result.append(""); continue }
            if type == kCFProxyTypeAutoConfigurationURL as String || type == kCFProxyTypeAutoConfigurationJavaScript as String {
                result += try routes(evaluate(proxy, for: url), for: url)
                continue
            }
            // CFNetwork's HTTPS type means an HTTP CONNECT proxy, not TLS to
            // the proxy itself. System SOCKS proxies use remote DNS resolution.
            guard let scheme = type == kCFProxyTypeSOCKS as String ? "socks5h"
                : [kCFProxyTypeHTTP as String, kCFProxyTypeHTTPS as String].contains(type ?? "") ? "http" : nil,
                  let host = proxy[kCFProxyHostNameKey as String] as? String, !host.isEmpty,
                  let port = proxy[kCFProxyPortNumberKey as String] as? Int, (1...65535).contains(port)
            else { throw ProxyError.invalid }
            var components = URLComponents()
            components.scheme = scheme
            components.host = host
            components.port = port
            components.user = proxy[kCFProxyUsernameKey as String] as? String
            components.password = proxy[kCFProxyPasswordKey as String] as? String
            guard let route = components.string else { throw ProxyError.invalid }
            result.append(route)
        }
        guard !result.isEmpty else { throw ProxyError.unavailable }
        return result
    }

    private final class PACResult {
        var proxies: [[String: Any]]?
        var failed = false
        var complete = false
    }

    private static func evaluate(_ proxy: [String: Any], for url: URL) throws -> [[String: Any]] {
        let result = PACResult()
        var context = CFStreamClientContext(version: 0, info: Unmanaged.passUnretained(result).toOpaque(),
                                            retain: nil, release: nil, copyDescription: nil)
        let callback: CFProxyAutoConfigurationResultCallback = { info, proxies, error in
            let result = Unmanaged<PACResult>.fromOpaque(info).takeUnretainedValue()
            result.failed = error != nil
            result.proxies = proxies as? [[String: Any]]
            result.complete = true
        }
        let source: CFRunLoopSource
        if let pacURL = proxy[kCFProxyAutoConfigurationURLKey as String] as? URL {
            source = CFNetworkExecuteProxyAutoConfigurationURL(pacURL as CFURL, url as CFURL, callback, &context)
        } else if let script = proxy[kCFProxyAutoConfigurationJavaScriptKey as String] as? String {
            source = CFNetworkExecuteProxyAutoConfigurationScript(script as CFString, url as CFURL, callback, &context)
        } else { throw ProxyError.invalid }
        let runLoop = CFRunLoopGetCurrent()
        CFRunLoopAddSource(runLoop, source, .defaultMode)
        defer {
            CFRunLoopSourceInvalidate(source)
            CFRunLoopRemoveSource(runLoop, source, .defaultMode)
            withExtendedLifetime(result) {}
        }
        let deadline = Date().addingTimeInterval(15)
        while !result.complete && Date() < deadline {
            CFRunLoopRunInMode(.defaultMode, min(0.1, deadline.timeIntervalSinceNow), true)
        }
        guard result.complete else { throw ProxyError.timeout }
        guard !result.failed, let proxies = result.proxies else { throw ProxyError.unavailable }
        return proxies
    }
}
