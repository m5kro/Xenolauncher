"use strict";
const { spawn } = require("node:child_process");
const { PassThrough, Readable } = require("node:stream");

function proxySettings(value) {
    const mode = value?.mode ?? "system";
    const invalid = () => Object.assign(new Error("Enter a valid HTTP, HTTPS or SOCKS proxy URL."), { translationKey: "error.proxySettings" });
    if (value != null && (typeof value !== "object" || Array.isArray(value))) throw invalid();
    if (!["off", "system", "custom"].includes(mode)) throw invalid();
    const raw = typeof value?.url === "string" ? value.url.trim() : "";
    if (mode !== "custom") return { mode, url: raw };
    let url;
    try { url = new URL(raw); } catch { throw invalid(); }
    if (!["http:", "https:", "socks5:", "socks5h:", "socks4:", "socks4a:"].includes(url.protocol)
        || !url.hostname || url.hash || url.search || (url.pathname && url.pathname !== "/")
        || /[\x00-\x20\x7f]/.test(raw)
        || (url.port && !(Number(url.port) >= 1 && Number(url.port) <= 65535))) throw invalid();
    // Resolve target names at the SOCKS5 proxy, including names unavailable to local DNS.
    if (url.protocol === "socks5:") url.protocol = "socks5h:";
    return { mode, url: url.href };
}

const quote = value => '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    .replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';

// curl is part of macOS, provides HTTP CONNECT / SOCKS and uses the system trust
// store. Feed URLs and credentials on stdin, never in process arguments. Keep
// response bodies streaming so large engine archives do not fill memory.
function transfer(request, proxy, signal) {
    return new Promise((resolve, reject) => {
        signal?.throwIfAborted();
        const lines = ["silent", "show-error", "no-buffer", "compressed", "suppress-connect-headers",
            'proto = "=http,https"', 'connect-timeout = "30"',
            'speed-limit = "1"', 'speed-time = "60"',
            "url = " + quote(request.url), "proxy = " + quote(proxy), 'noproxy = ""',
            'dump-header = "/dev/fd/3"'];
        if (request.method === "HEAD") lines.push("head");
        else lines.push("request = " + quote(request.method));
        for (const [key, value] of request.headers) lines.push("header = " + quote(`${key}: ${value}`));
        if (!request.headers.has("user-agent")) lines.push('user-agent = "Xenolauncher"');
        if (request.body != null) lines.push('data-binary = "@/dev/fd/4"');
        const env = { ...process.env };
        for (const key of Object.keys(env)) if (/^(https?|all|no)_proxy$/i.test(key) || key === "CURL_HOME") delete env[key];
        const child = spawn("/usr/bin/curl", ["--disable", "--config", "-"], {
            env, stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
        });
        const body = new PassThrough();
        // A cancellation can arrive before the caller has a response to consume.
        body.on("error", () => {});
        let headers = "", settled = false, finished = false;
        const fail = error => {
            if (!settled) { settled = true; reject(error); }
            body.destroy(error);
        };
        const abort = () => { child.kill(); fail(signal.reason); };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        child.on("error", fail);
        // Pipe without ending: an interrupted archive must error, never look complete.
        child.stdout.pipe(body, { end: false });
        child.stdout.on("error", fail);
        child.stderr.resume(); // Avoid surfacing credentials from curl diagnostics.
        child.stdio[3].on("error", fail);
        child.stdio[3].setEncoding("latin1");
        child.stdio[3].on("data", chunk => {
            headers += chunk;
            if (headers.length > 128 * 1024) { child.kill(); fail(new Error("Response headers too large")); return; }
            let end;
            while (!settled && (end = headers.indexOf("\r\n\r\n")) >= 0) {
                const block = headers.slice(0, end).split("\r\n");
                headers = headers.slice(end + 4);
                const match = /^HTTP\/\S+ (\d{3})(?: (.*))?$/.exec(block.shift());
                if (!match || Number(match[1]) < 200) continue;
                try {
                    const responseHeaders = new Headers();
                    for (const line of block) {
                        const colon = line.indexOf(":");
                        if (colon > 0) responseHeaders.append(line.slice(0, colon), line.slice(colon + 1).trim());
                    }
                    const status = Number(match[1]);
                    const noBody = request.method === "HEAD" || [204, 205, 304].includes(status);
                    const stream = noBody ? null : Readable.toWeb(body, {
                        strategy: { highWaterMark: 64 * 1024, size: chunk => chunk.byteLength },
                    });
                    const response = new Response(stream, {
                        status, statusText: match[2] || "", headers: responseHeaders,
                    });
                    Object.defineProperty(response, "url", { value: request.url });
                    settled = true;
                    if (noBody) body.resume();
                    resolve(response);
                } catch (error) { child.kill(); fail(error); }
            }
        });
        child.on("close", code => {
            finished = true;
            signal?.removeEventListener("abort", abort);
            if (code !== 0) fail(signal?.aborted ? signal.reason : Object.assign(
                new Error(`Network request failed (curl ${code ?? "terminated"}). Check your connection and proxy settings.`),
                { translationKey: "error.proxyConnection" }));
            else if (!settled) fail(new Error("Server returned no HTTP response"));
            else body.end();
        });
        body.on("close", () => { if (!finished) child.kill(); });
        // EPIPE is expected if curl exits before reading its configuration/upload.
        child.stdin.on("error", () => {});
        child.stdio[4].on("error", () => {});
        child.stdin.end(lines.join("\n") + "\n");
        child.stdio[4].end(request.body);
    });
}

function createFetch({ getSettings, resolveSystemProxy, getSignal = () => undefined }) {
    return async function networkFetch(input, init) {
        const request = new Request(input, init);
        const proxy = proxySettings(getSettings());
        const signal = AbortSignal.any([request.signal, getSignal()].filter(Boolean));
        signal.throwIfAborted();
        let current = { url: request.url, method: request.method, headers: new Headers(request.headers),
            body: request.body == null ? null : Buffer.from(await request.arrayBuffer()) };
        for (let redirects = 0; ; redirects++) {
            const target = new URL(current.url);
            if (!["http:", "https:"].includes(target.protocol)) throw new TypeError("Only HTTP and HTTPS downloads are supported");
            const routes = proxy.mode === "off" ? [""] : proxy.mode === "custom" ? [proxy.url]
                : await resolveSystemProxy(current.url, signal);
            if (!Array.isArray(routes) || routes.length === 0) throw new Error("System proxy resolution returned no routes");
            let response, lastError;
            for (const route of routes) {
                signal.throwIfAborted();
                try { response = await transfer(current, route, signal); break; }
                catch (error) { signal.throwIfAborted(); lastError = error; }
            }
            if (!response) throw lastError;
            const location = response.headers.get("location");
            if (![301, 302, 303, 307, 308].includes(response.status) || !location || request.redirect === "manual") {
                Object.defineProperty(response, "redirected", { value: redirects > 0 });
                return response;
            }
            await response.body?.cancel();
            if (request.redirect === "error" || redirects >= 20) throw new TypeError("Download redirect rejected or limit exceeded");
            const next = new URL(location, current.url);
            if (next.origin !== target.origin) {
                for (const name of ["authorization", "cookie", "proxy-authorization", "host"]) current.headers.delete(name);
            }
            if ((response.status === 303 && current.method !== "HEAD")
                || ([301, 302].includes(response.status) && current.method === "POST")) {
                current.method = "GET"; current.body = null;
                for (const name of ["content-type", "content-length", "transfer-encoding"]) current.headers.delete(name);
            }
            current.url = next.href;
        }
    };
}

module.exports = { createFetch, proxySettings };
