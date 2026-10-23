// JSON-lines over stdin/stdout. stdout belongs exclusively to the protocol.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const readline = require("node:readline");
const { randomUUID } = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const runFile = promisify(execFile);
const context = new AsyncLocalStorage();
const requestedDataDir = path.resolve(process.env.XENO_DATA_DIR || path.join(os.homedir(), "Library/Application Support/Xenolauncher"));
fs.mkdirSync(requestedDataDir, { recursive: true });
// macOS aliases /var to /private/var. Canonical paths also make require-cache
// invalidation reliable after a module script changes.
const dataDir = fs.realpathSync(requestedDataDir);
const requests = new Map();
const dialogs = new Map();
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const event = (name, payload = {}) => send({ event: name, requestID: context.getStore()?.id, ...payload });
for (const level of ["log", "info", "warn", "error", "debug"]) {
    console[level] = (...args) => event("log", { message: args.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ") });
}

function failure(key, message, args = {}) {
    return Object.assign(new Error(message), { translationKey: key, translationArguments: args });
}
function validLanguage(value) {
    return typeof value === "string" && (value === "system" || /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value));
}
function readJSON(file, fallback = {}) {
    if (!fs.existsSync(file)) return fallback;
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("error.invalidObject", `Invalid JSON object: ${path.basename(file)}`, {file: path.basename(file)});
    return value;
}
function writeJSON(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Keep the previous valid document; never overwrite a corrupt source silently.
    readJSON(file);
    if (fs.existsSync(file)) fs.copyFileSync(file, file + ".bak");
    const temporary = file + "." + randomUUID() + ".tmp";
    try {
        fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
        fs.renameSync(temporary, file);
    } finally { fs.rmSync(temporary, { force: true }); }
}
const gamesFile = path.join(dataDir, "games.json");
const settingsFile = path.join(dataDir, "global-settings.json");
const games = { loadGames: () => readJSON(gamesFile), saveGames: value => writeJSON(gamesFile, value) };
function component(value, label = "name") {
    if (typeof value !== "string" || !value || value === "." || value === ".." || /[\\/\x00-\x1f]/.test(value)) throw failure("error.invalidComponent", `Invalid ${label}`, {label});
    return value;
}
function modulePath(folder) {
    const root = path.join(dataDir, "modules");
    const target = path.join(root, component(folder, "module"));
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw failure("error.linkedModule", "Linked module directories are not supported.", {});
    return target;
}
function scriptPath(root, relative) {
    if (typeof relative !== "string" || path.isAbsolute(relative)) throw failure("error.scriptPath", "Invalid module script path", {});
    const file = fs.realpathSync(path.resolve(root, relative));
    if (!file.startsWith(fs.realpathSync(root) + path.sep)) throw failure("error.scriptEscape", "Module script escapes its directory", {});
    return file;
}
function abortCheck(signal) { signal?.throwIfAborted(); }
function prompt(kind, message, title) {
    const { id, signal } = context.getStore() || {};
    abortCheck(signal);
    const dialogID = randomUUID();
    return new Promise((resolve, reject) => {
        const onAbort = () => finish(false, failure("error.cancelled", "Operation cancelled", {}));
        const finish = (answer, error) => {
            dialogs.delete(dialogID);
            signal?.removeEventListener("abort", onAbort);
            error ? reject(error) : resolve(answer);
        };
        dialogs.set(dialogID, { finish, requestID: id });
        signal?.addEventListener("abort", onAbort, { once: true });
        event("dialog", { dialogID, kind, title: String(title || "Xenolauncher"), message: String(message || "") });
    });
}
const ui = {
    alert: (message, title) => prompt("alert", message, title),
    confirm: (message, title) => prompt("confirm", message, title),
};
function progress() {
    return Object.fromEntries(["onStepTotal", "onStep", "onDownloadStart", "onDownloadProgress", "onDownloadEnd"].map(name => [name, value => event("progress", { name, detail: value,
        key: ["listing", "extracting", "done", "prepare", "preserve", "update", "restore", "cleanup", "finalize"].includes(value?.phase)
            ? `progress.${value.phase}` : name.startsWith("onDownload") ? "progress.download" : undefined,
    })]));
}

// macOS ships libarchive/bsdtar, which supports ZIP, TAR, gzip and xz.
// It also preserves framework symlinks needed by downloaded .app bundles.
async function extractArchive(archive, destination, { signal } = {}) {
    abortCheck(signal);
    const { stdout } = await runFile("/usr/bin/tar", ["-tf", archive], { signal, maxBuffer: 32 * 1024 * 1024 });
    for (const entry of stdout.split("\n").filter(Boolean)) {
        if (entry.startsWith("/") || entry.includes("\\") || entry.split("/").includes("..")) throw failure("error.unsafeArchive", "Unsafe path in archive", {});
    }
    fs.mkdirSync(destination, { recursive: true });
    // libarchive rejects extraction through symlinks outside the destination.
    await runFile("/usr/bin/tar", ["-xf", archive, "--no-same-owner", "-C", destination], { signal, maxBuffer: 8 * 1024 * 1024 });
}
const createCore = require(process.env.XENO_CORE_PATH || path.join(__dirname, "upstream/module.js"));
const core = createCore({ getUi: () => ui, getGames: () => games, getAppSupportDir: () => dataDir, extractArchive });
let engineUpdateReport = null;

async function checkEngineUpdates(params, requestSignal) {
    event("progress", { key: "updates.checking", detail: {} });
    const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(60000)]);
    const forceRefresh = params.forceRefresh !== false;
    const local = core.readLocalManifests();
    const folders = Object.keys(local);
    const warnings = [];
    const failedManifests = new Set(), failedDependencies = new Set();
    let remote = [], cachedRemote = !forceRefresh, remoteFailed = false;
    try {
        remote = await core.fetchRemoteManifestsList(undefined, {
            forceRefresh, signal,
            onFallback: error => { cachedRemote = true; warnings.push(error.message); },
            onManifestError: (folder, error) => { failedManifests.add(folder); warnings.push(`${folder}: ${error.message}`); },
        });
    } catch (error) {
        signal.throwIfAborted();
        remoteFailed = true;
        warnings.push(error.message);
    }
    signal.throwIfAborted();
    const dependencyFolders = await core.checkDependencyUpdatesForFolders(folders, {
        forceRefresh, signal, strict: true,
        onError: (folder, error) => { failedDependencies.add(folder); warnings.push(`${folder}: ${error.message}`); },
    });
    signal.throwIfAborted();
    engineUpdateReport = {
        checkedAt: new Date().toISOString(), cachedRemote, warnings,
        remoteModules: remote.map(module => ({ ...module, id: module.folder })),
        updates: folders.map(id => {
            const latest = remote.find(module => module.folder === id);
            return {
                id, localVersion: local[id].version || "N/A", remoteVersion: latest?.version || "N/A",
                moduleUpdate: !!latest && core.hasUpdate(local[id].version, latest.version),
                dependencyUpdate: dependencyFolders.has(id) && !failedDependencies.has(id),
                checkFailed: remoteFailed || failedManifests.has(id) || failedDependencies.has(id),
            };
        }),
    };
    return engineUpdateReport;
}

async function runModuleTask(folder, action, signal) {
    modulePath(folder);
    const p = progress();
    await moduleTransaction(folder, async () => {
        switch (action) {
            case "install": await core.installModuleWithProgress(folder, core.DEFAULT_REPO, p, { signal }); break;
            case "update": await core.updateModulePreservingMultiversionsWithProgress(folder, p, { signal, strict: true }); break;
            case "dependencies": await core.updateDependenciesTaskWithProgress(folder, p, { signal, strict: true }); break;
            case "uninstall": core.uninstallModule(folder); break;
            default: throw failure("error.moduleAction", "Unknown module action");
        }
        abortCheck(signal);
    });
    core.invalidateDepUpdatesCache();
    // Remove stale badges after successful writes; the client rechecks next.
    if (engineUpdateReport) engineUpdateReport.updates = engineUpdateReport.updates.filter(item => item.id !== folder);
}

function snapshot() {
    const savedSettings = readJSON(settingsFile);
    const appearance = ["light", "dark", "system"].includes(savedSettings.appearance)
        ? savedSettings.appearance
        : typeof savedSettings.darkTheme === "boolean" ? (savedSettings.darkTheme ? "dark" : "light") : "system";
    const settings = { listView: false, deletionConfirmation: true, nonInstalledAutodetect: true, checkModuleUpdatesOnStartup: true, ...savedSettings, appearance, language: validLanguage(savedSettings.language) ? savedSettings.language : "system" };
    const manifests = core.readLocalManifests();
    return {
        games: Object.entries(games.loadGames()).map(([id, value]) => ({ ...value, id })),
        modules: Object.entries(manifests).map(([id, value]) => ({ ...value, id })),
        settings, dataPath: dataDir, nodeVersion: process.version, engineUpdates: engineUpdateReport,
    };
}
function saveGame({ id, game }) {
    if (!game || typeof game !== "object") throw failure("error.missingGame", "Missing game", {});
    for (const key of ["gameTitle", "gamePath", "gameEngine"]) {
        if (typeof game[key] !== "string" || !game[key].trim()) throw failure("error.requiredGame", "Game title, path and engine are required.", {});
    }
    component(game.gameEngine, "engine");
    const all = games.loadGames();
    if (id != null && (!/^\d+$/.test(String(id)) || !Object.hasOwn(all, id))) throw failure("error.staleGame", "Game no longer exists. Refresh the library.", {});
    if (Object.entries(all).some(([other, g]) => other !== id && g.gameTitle?.toLowerCase() === game.gameTitle.trim().toLowerCase())) throw failure("error.duplicateGame", "A game with this name already exists.", {});
    const nextID = id || String(Math.max(0, ...Object.keys(all).map(n => Number(n) || 0)) + 1);
    // Merge to preserve fields written by newer upstream launchers.
    all[nextID] = { ...all[nextID], ...game, gameTitle: game.gameTitle.trim() };
    delete all[nextID].id;
    games.saveGames(all);
    return snapshot();
}
async function moduleTransaction(folder, operation) {
    const target = modulePath(folder);
    const backup = path.join(dataDir, ".native-backups", randomUUID());
    const existed = fs.existsSync(target);
    let removeBackup = true;
    if (existed) {
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.cpSync(target, backup, { recursive: true });
    }
    try {
        await operation();
    } catch (error) {
        // Upstream's update removes partial installs on failure. Restore the
        // complete original module, including all installed engine versions.
        fs.rmSync(target, { recursive: true, force: true });
        if (existed) {
            try { fs.cpSync(backup, target, { recursive: true }); }
            catch (restoreError) {
                removeBackup = false;
                throw failure("error.restoreFailed", `${error.message}. Automatic restore failed: ${restoreError.message}. Original module retained at ${backup}`, {reason: error.message, restore: restoreError.message, backup});
            }
        }
        throw error;
    } finally { if (removeBackup) fs.rmSync(backup, { recursive: true, force: true }); }
}
function loadScript(folder, relative) {
    const root = modulePath(folder);
    if (!fs.existsSync(root)) throw failure("error.moduleMissing", `Module "${folder}" is not installed. Install it in Game Engines first.`, {module: folder});
    const file = scriptPath(root, relative);
    for (const key of Object.keys(require.cache)) if (key.startsWith(root + path.sep)) delete require.cache[key];
    return require(file);
}
async function versions(folder, argKey) {
    const root = modulePath(folder);
    const manifest = readJSON(path.join(root, "manifest.json"));
    const def = manifest.gameArgs?.[component(argKey, "argument")];
    if (def?.type !== "multi-version") throw failure("error.notMultiVersion", "Not a multi-version parameter", {});
    const installedRoot = path.join(root, "deps", argKey);
    const installed = fs.existsSync(installedRoot) ? fs.readdirSync(installedRoot, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith(".")).map(d => d.name) : [];
    const provider = def["version-script"] ? loadScript(folder, def["version-script"]) : null;
    const available = provider?.getAvailable ? await provider.getAvailable({ engine: folder, argKey, modulesDir: core.getModulesDir() }, ui) : {};
    return { installed, available: available || {} };
}
function installedVersions(folder, argKey) {
    const root = path.join(modulePath(folder), "deps", component(argKey));
    return fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith(".")).map(d => d.name) : [];
}
async function installVersion(folder, argKey, version, signal) {
    component(version, "version");
    const { available } = await versions(folder, argKey);
    const builds = available[version];
    const arch = os.arch() === "x64" ? "x86_64" : os.arch();
    const spec = builds?.universal || builds?.[arch];
    if (!spec?.link) throw failure("error.buildMissing", `No ${arch} build for this version`, {arch});
    const root = path.join(modulePath(folder), "deps", component(argKey));
    const destination = path.join(root, version);
    if (fs.existsSync(destination)) throw failure("error.alreadyInstalled", "This version is already installed", {});
    fs.mkdirSync(root, { recursive: true });
    const staging = fs.mkdtempSync(path.join(root, ".install-"));
    try {
        const response = await fetch(spec.link, { signal });
        if (!response.ok || !response.body) throw failure("error.download", `Download failed: HTTP ${response.status}`, {status: response.status});
        const name = component(path.basename(new URL(spec.link).pathname), "archive");
        const archive = path.join(staging, name);
        const totalBytes = Number(response.headers.get("content-length")) || 0;
        const file = fs.openSync(archive, "wx");
        let downloadedBytes = 0;
        try {
            for await (const chunk of response.body) {
                abortCheck(signal);
                fs.writeSync(file, chunk);
                downloadedBytes += chunk.length;
                event("progress", { name: "onDownloadProgress", key: "progress.download", detail: { label: version, downloadedBytes, totalBytes } });
            }
        } finally { fs.closeSync(file); }
        if (spec.unzip) {
            const extracted = path.join(staging, "contents");
            await extractArchive(archive, extracted, { signal });
            fs.renameSync(extracted, destination);
        } else {
            fs.mkdirSync(destination);
            fs.renameSync(archive, path.join(destination, name));
        }
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
    return { installed: fs.readdirSync(root).filter(v => !v.startsWith(".")), available };
}

async function dispatch(method, params, signal) {
    switch (method) {
        case "snapshot": return snapshot();
        case "saveGame": return saveGame(params);
        case "saveSettings": {
            const current = readJSON(settingsFile);
            const next = { ...current, ...params };
            if (Object.hasOwn(params, "appearance")) {
                if (!["light", "dark", "system"].includes(params.appearance)) throw failure("error.appearance", "Invalid appearance mode", {});
                // Without a legacy override, NW.js also derives its theme from
                // macOS when opened. Preserve explicit light/dark choices too.
                if (params.appearance === "system") delete next.darkTheme;
                else next.darkTheme = params.appearance === "dark";
            }
            if (Object.hasOwn(params, "language") && !validLanguage(params.language)) {
                throw failure("error.language", "Invalid language preference");
            }
            writeJSON(settingsFile, next);
            return snapshot();
        }
        case "deleteGame": {
            const all = games.loadGames();
            if (!Object.hasOwn(all, params.id)) throw failure("error.gameNotFound", "Game not found", {});
            if (!(await core.deleteWithEngine(all[params.id]))) throw failure("error.cleanup", "Module cleanup failed; game was retained.", {});
            delete all[params.id];
            games.saveGames(all);
            return snapshot();
        }
        case "launch": {
            const game = games.loadGames()[params.id];
            if (!game) throw failure("error.gameNotFound", "Game not found", {});
            if (!fs.existsSync(game.gamePath)) throw failure("error.gamePath", "The game path no longer exists.", {});
            const launcher = loadScript(game.gameEngine, "launcher.js");
            if (typeof launcher.launch !== "function") throw failure("error.launchExport", "Module does not export launch()", {});
            const folder = fs.statSync(game.gamePath).isFile() ? path.dirname(game.gamePath) : game.gamePath;
            await launcher.launch(game.gamePath, folder, game.gameArgs || {}, game.gameTitle || "", ui);
            return { message: "Launch request sent" };
        }
        case "detect": {
            const installed = core.detectEngineForPath(params.path, core.readLocalManifests());
            if (installed) return { engine: installed, installed: true };
            if (!params.includeRemote) return { engine: null, installed: false };
            const definitions = await core.fetchModulesForAutodetect();
            return { engine: core.detectEngineFromAutodetectMap(params.path, definitions) || null, installed: false };
        }
        case "remoteModules": return await core.fetchRemoteManifestsList(undefined, { forceRefresh: true });
        case "checkEngineUpdates": {
            try { return await checkEngineUpdates(params, signal); }
            catch (error) {
                if (error.name === "TimeoutError") throw failure("error.updateCheckTimeout", "Engine update check timed out. Try again later.");
                throw error;
            }
        }
        case "updateAllEngines": {
            if (!engineUpdateReport) throw failure("error.checkUpdatesFirst", "Check for engine updates first");
            const queue = engineUpdateReport.updates.filter(item => item.moduleUpdate || item.dependencyUpdate);
            for (const item of queue) {
                abortCheck(signal);
                event("progress", { key: "updates.updatingEngine", arguments: { module: item.id }, detail: {} });
                try { await runModuleTask(item.id, item.moduleUpdate ? "update" : "dependencies", signal); }
                catch (error) {
                    abortCheck(signal);
                    throw failure("error.engineUpdateFailed", `Update failed for ${item.id}: ${error.message}`, { module: item.id, reason: error.message });
                }
            }
            return snapshot();
        }
        case "moduleTask": {
            const { folder, action } = params;
            await runModuleTask(folder, action, signal);
            return snapshot();
        }
        case "installedVersions": return installedVersions(params.folder, params.argKey);
        case "versions": return await versions(params.folder, params.argKey);
        case "installVersion": return await installVersion(params.folder, params.argKey, params.version, signal);
        case "removeVersion": {
            const root = modulePath(params.folder);
            const def = readJSON(path.join(root, "manifest.json")).gameArgs?.[component(params.argKey)];
            if (def?.type !== "multi-version") throw failure("error.notMultiVersion", "Not a multi-version parameter", {});
            fs.rmSync(path.join(root, "deps", component(params.argKey), component(params.version)), { recursive: true, force: true });
            return { installed: installedVersions(params.folder, params.argKey) };
        }
        default: throw failure("error.unknownMethod", `Unknown method: ${method}`, {method});
    }
}
// Serialize operations so two windows cannot race writes or module updates.
// Dialog replies and cancellation bypass the queue to avoid deadlocks.
let queue = Promise.resolve();
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", line => {
    let request;
    try { request = JSON.parse(line); } catch { return; }
    if (request.method === "dialogReply") {
        dialogs.get(request.params?.dialogID)?.finish(request.params?.accepted === true);
        return;
    }
    if (request.method === "cancel") {
        requests.get(request.params?.requestID)?.abort();
        return;
    }
    if (typeof request.id !== "string" || typeof request.method !== "string") return;
    const controller = new AbortController();
    requests.set(request.id, controller);
    queue = queue.then(() => context.run({ id: request.id, signal: controller.signal }, async () => {
        try {
            abortCheck(controller.signal);
            const result = await dispatch(request.method, request.params || {}, controller.signal);
            send({ id: request.id, result });
        } catch (error) {
            send({ id: request.id, error: {
                message: controller.signal.aborted ? "Operation cancelled" : error.message,
                key: controller.signal.aborted ? "error.cancelled" : error.translationKey,
                arguments: error.translationArguments,
            } });
        } finally { requests.delete(request.id); }
    }));
});
input.on("close", () => {
    for (const controller of requests.values()) controller.abort();
    for (const dialog of dialogs.values()) dialog.finish(false, new Error("Launcher disconnected"));
    queue.finally(() => process.exit(0));
});
send({ event: "ready", protocol: 1, nodeVersion: process.version });
