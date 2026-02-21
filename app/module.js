// module.js (unified)
// A heck ton of AI generated code below :P
// js is not my strong suit
(function () {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const { exec } = require("child_process");

    const DEFAULT_REPO = { owner: "m5kro", repo: "Xenolauncher-Modules", branch: "main" };

    // Shared arch map for deps
    const archMap = { x64: "x86_64", arm64: "arm64" };
    const sysArch = archMap[os.arch()] || os.arch();

    // Safe JSON reader (never throws)
    function safeReadJson(filePath) {
        try {
            if (!fs.existsSync(filePath)) return null;
            const raw = fs.readFileSync(filePath, "utf8");
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    // ===== Dependency helpers =================================================
    function depsFromManifest(manifest) {
        const keys = ["dependencies", "deps", "dependency", "requires", "requirements"];
        for (const k of keys) {
            const v = manifest && manifest[k];
            if (v && typeof v === "object") return v;
        }
        return {};
    }

    function resolveDepSpec(builds, arch = sysArch) {
        if (!builds || typeof builds !== "object") return null;
        const key = builds.universal ? "universal" : arch;
        return builds[key] || null;
    }

    function countDepSteps(depsObj, arch = sysArch) {
        if (!depsObj || typeof depsObj !== "object") return 0;
        let steps = 0;
        for (const [, builds] of Object.entries(depsObj)) {
            steps += 1; // download step
            const spec = resolveDepSpec(builds, arch);
            if (spec && spec.unzip) steps += 1; // extraction step
        }
        return steps;
    }

    // ===== GitHub URL helpers =================================================
    function getApiBase(r = DEFAULT_REPO) {
        return `https://api.github.com/repos/${r.owner}/${r.repo}/contents`;
    }
    function getRawBase(r = DEFAULT_REPO) {
        return `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${r.branch}`;
    }

    // ===== Local mod dir helpers =============================================
    function getModulesDir() {
        return path.join(os.homedir(), "Library", "Application Support", "Xenolauncher", "modules");
    }

    function clearRequireCacheForDir(dirPath) {
        if (!dirPath) return;
        const root = path.resolve(dirPath);
        const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

        for (const cacheKey of Object.keys(require.cache)) {
            const resolved = path.resolve(cacheKey);
            if (resolved === root || resolved.startsWith(rootWithSep)) {
                delete require.cache[cacheKey];
            }
        }
    }

    // ===== Cache helpers =======================================================
    const CACHE_SCHEMA = 1;
    const REMOTE_MANIFESTS_CACHE_FILE = "remote-manifests-cache.json";
    const DEP_UPDATE_CACHE_FILE = "dependency-updates-cache.json";

    function getCacheDir() {
        // Shared across NW.js windows
        return path.join(os.homedir(), "Library", "Application Support", "Xenolauncher", "cache");
    }

    function repoKey(r = DEFAULT_REPO) {
        return `${r.owner}/${r.repo}@${r.branch}`;
    }

    function readCacheJson(filePath) {
        return safeReadJson(filePath);
    }

    function writeJsonAtomic(filePath, obj) {
        try {
            ensureDir(path.dirname(filePath));
            const tmp = `${filePath}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
            fs.renameSync(tmp, filePath);
        } catch (e) {
            console.warn("Failed to write cache:", filePath, e);
        }
    }

    // Remote manifests cache
    let remoteManifestsMem = null;
    let remoteManifestsRepoKey = null;
    let remoteManifestsInflight = null;

    function loadRemoteManifestsCache(repo = DEFAULT_REPO) {
        const p = path.join(getCacheDir(), REMOTE_MANIFESTS_CACHE_FILE);
        const cached = readCacheJson(p);
        if (!cached || cached.schema !== CACHE_SCHEMA) return null;
        if (cached.repoKey !== repoKey(repo)) return null;
        if (!Array.isArray(cached.manifests)) return null;
        return cached.manifests;
    }

    function saveRemoteManifestsCache(manifests, repo = DEFAULT_REPO) {
        const p = path.join(getCacheDir(), REMOTE_MANIFESTS_CACHE_FILE);
        writeJsonAtomic(p, {
            schema: CACHE_SCHEMA,
            repoKey: repoKey(repo),
            fetchedAt: new Date().toISOString(),
            manifests,
        });
    }

    // Dependency update cache
    let depUpdatesMem = null; // { schema, fetchedAt, updatesByFolder }
    let depUpdatesInflight = null;

    function loadDepUpdatesCache() {
        const p = path.join(getCacheDir(), DEP_UPDATE_CACHE_FILE);
        const cached = readCacheJson(p);
        if (!cached || cached.schema !== CACHE_SCHEMA) return null;
        if (!cached.updatesByFolder || typeof cached.updatesByFolder !== "object") return null;
        return cached;
    }

    function saveDepUpdatesCache(updatesByFolder) {
        const p = path.join(getCacheDir(), DEP_UPDATE_CACHE_FILE);
        writeJsonAtomic(p, {
            schema: CACHE_SCHEMA,
            fetchedAt: new Date().toISOString(),
            updatesByFolder,
        });
    }

    // Clear a folder's "dependency updates available" flag in the shared cache after updates are applied
    function clearDepUpdateFlag(folder) {
        if (!folder) return;
        try {
            // Update disk cache (shared across windows)
            const disk = loadDepUpdatesCache() || {
                schema: CACHE_SCHEMA,
                fetchedAt: new Date().toISOString(),
                updatesByFolder: {},
            };
            if (!disk.updatesByFolder || typeof disk.updatesByFolder !== "object") disk.updatesByFolder = {};
            disk.updatesByFolder[folder] = false;
            disk.fetchedAt = new Date().toISOString();
            saveDepUpdatesCache(disk.updatesByFolder);

            // Update this window's memory cache too
           depUpdatesMem = disk;
        } catch (e) {
            // best-effort
        }
    }

    function invalidateDepUpdatesCache() {
       depUpdatesMem = null;
    }

    function getInstalledModuleFolders() {
        const modsDir = getModulesDir();
        const set = new Set();
        if (!fs.existsSync(modsDir)) return set;
        try {
            fs.readdirSync(modsDir, { withFileTypes: true })
                .filter((d) => d.isDirectory())
                .forEach((d) => set.add(d.name));
        } catch (e) {
            console.warn("getInstalledModuleFolders failed", e);
        }
        return set;
    }

    function readLocalManifests() {
        const modsDir = getModulesDir();
        const out = {};
        if (!fs.existsSync(modsDir)) return out;
        fs.readdirSync(modsDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .forEach((d) => {
                const mf = path.join(modsDir, d.name, "manifest.json");
                if (!fs.existsSync(mf)) return;
                try {
                    out[d.name] = JSON.parse(fs.readFileSync(mf, "utf8"));
                } catch (e) {
                    console.error("Bad manifest in", d.name, e);
                }
            });
        return out;
    }

    // ===== Remote manifests ===================================================
    async function fetchRemoteManifest(folderName, repo = DEFAULT_REPO, opts = {}) {
        const url = `${getRawBase(repo)}/modules/${folderName}/manifest.json`;
        try {
            const signal = opts && opts.signal;
            throwIfAborted(signal);

            const res = await fetch(url, signal ? { signal } : undefined);
            if (!res.ok) throw new Error(`status ${res.status}`);
            const json = await res.json();

            return {
                folder: folderName,
                name: json.name || folderName,
                version: json.version || "N/A",
                author: json.author || "N/A",
                description: json.description || "",
                raw: json,
            };
        } catch {
            return {
                folder: folderName,
                name: folderName,
                version: "N/A",
                author: "N/A",
                description: "",
                raw: {},
            };
        }
    }
    async function fetchRemoteManifestsListFromGitHub(repo = DEFAULT_REPO, opts = {}) {
        const url = `${getApiBase(repo)}/modules?ref=${repo.branch}`;
        const signal = opts && opts.signal;
        throwIfAborted(signal);

        const res = await fetch(url, signal ? { signal } : undefined);
        if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
        const items = await res.json();
        const dirs = items.filter((i) => i.type === "dir");
        return Promise.all(dirs.map((d) => fetchRemoteManifest(d.name, repo, opts)));
    }

    async function fetchRemoteManifestsList(repo = DEFAULT_REPO, opts = {}) {
        const forceRefresh = !!(opts && opts.forceRefresh);
        const key = repoKey(repo);

        // 1) Memory cache
        if (!forceRefresh && remoteManifestsMem && remoteManifestsRepoKey === key) {
            return remoteManifestsMem;
        }

        // 2) Disk cache
        if (!forceRefresh) {
            const disk = loadRemoteManifestsCache(repo);
            if (disk) {
                remoteManifestsMem = disk;
                remoteManifestsRepoKey = key;
                return disk;
            }
        }

        // 3) De-dupe concurrent refreshes in this window
        if (remoteManifestsInflight && remoteManifestsRepoKey === key) {
            return remoteManifestsInflight;
        }

        remoteManifestsRepoKey = key;
        remoteManifestsInflight = (async () => {
            try {
                const fresh = await fetchRemoteManifestsListFromGitHub(repo, opts);
                remoteManifestsMem = fresh;
                saveRemoteManifestsCache(fresh, repo);
                return fresh;
            } catch (e) {
                // If GitHub rate-limits you, fall back to the last cached snapshot.
                const fallback = loadRemoteManifestsCache(repo);
                if (fallback) {
                    console.warn("fetchRemoteManifestsList: GitHub fetch failed; using cached manifests:", e);
                    remoteManifestsMem = fallback;
                    return fallback;
                }
                throw e;
            } finally {
                remoteManifestsInflight = null;
            }
        })();

        return remoteManifestsInflight;
    }

    function normalizeVer(v) {
        return String(v || "")
            .trim()
            .replace(/^v/i, "");
    }
    function compareVersions(a, b) {
        const toParts = (x) =>
            normalizeVer(x)
                .split(".")
                .map((y) => (y === "" ? 0 : isNaN(Number(y)) ? y : Number(y)));
        const pa = toParts(a);
        const pb = toParts(b);
        const n = Math.max(pa.length, pb.length);
        for (let i = 0; i < n; i++) {
            const xa = pa[i] ?? 0;
            const xb = pb[i] ?? 0;
            const na = typeof xa === "number";
            const nb = typeof xb === "number";
            if (na && nb) {
                if (xa > xb) return 1;
                if (xa < xb) return -1;
            } else if (!na && !nb) {
                if (xa > xb) return 1;
                if (xa < xb) return -1;
            } else {
                return na ? 1 : -1; // numbers rank above strings
            }
        }
        return 0;
    }
    function hasUpdate(localVersion, remoteVersion) {
        if (!localVersion || localVersion === "N/A") return false;
        if (!remoteVersion || remoteVersion === "N/A") return false;
        return compareVersions(remoteVersion, localVersion) > 0;
    }

    // ===== Download / install modules ========================================
    function safeCall(fn, arg) {
        if (typeof fn === "function") {
            try {
                fn(arg);
            } catch (e) {
                console.warn("progress callback error:", e);
            }
        }
    }
    function nowMs() {
        return Date.now();
    }
    function mkSpeedometer(minIntervalMs = 250, emaAlpha = 0.25) {
        // Returns a bytes/sec estimate and avoids jitter when chunks arrive very frequently.
        let lastT = nowMs();
        let lastB = 0;
        let ema = 0;

        return (bytesNow) => {
            const t = nowMs();
            const dtMs = t - lastT;

            // If we haven't accumulated enough time, keep returning the previous EMA.
            if (dtMs < minIntervalMs) return ema;

            const dt = dtMs / 1000;
            const db = bytesNow - lastB;
            const inst = dt > 0 ? db / dt : 0;

            ema = ema ? emaAlpha * inst + (1 - emaAlpha) * ema : inst;

            lastT = t;
            lastB = bytesNow;

            return ema;
        };
    }

    function mkAbortError() {
        const e = new Error("Aborted");
        e.name = "AbortError";
        return e;
    }
    function isAbortError(e) {
        if (!e) return false;
        if (e.name === "AbortError") return true;
        const msg = String(e.message || e);
        return /aborted|aborterror|canceled|cancelled/i.test(msg);
    }
    function throwIfAborted(signal) {
        if (signal && signal.aborted) {
            throw mkAbortError();
        }
    }

    async function downloadUrlToFileWithProgress(url, destPath, progress, label = "Download", opts = {}) {
        const signal = opts && opts.signal;
        throwIfAborted(signal);

        const res = await fetch(url, signal ? { signal } : undefined);
        if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
        const total = parseInt(res.headers.get("content-length") || "0", 10) || null;

        safeCall(progress?.onDownloadStart, { label, totalBytes: total, url, destPath });

        const body = res.body;
        const ws = fs.createWriteStream(destPath);
        let downloaded = 0;
        const speedOf = mkSpeedometer();

        const finishWrite = () =>
            new Promise((resolve, reject) => {
                ws.on("error", reject);
                ws.end(resolve);
            });

        if (body && typeof body.getReader === "function") {
            const reader = body.getReader();
            try {
                while (true) {
                    throwIfAborted(signal);
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) {
                        const buf = Buffer.from(value);
                        ws.write(buf);
                        downloaded += buf.length;
                        safeCall(progress?.onDownloadProgress, {
                            label,
                            downloadedBytes: downloaded,
                            totalBytes: total,
                            bytesPerSecond: speedOf(downloaded),
                        });
                    }
                }
            } catch (e) {
                if (isAbortError(e)) {
                    try {
                        ws.destroy();
                    } catch {}
                    try {
                        fs.rmSync(destPath, { force: true });
                    } catch {}
                }
                throw e;
            } finally {
                try {
                    reader.releaseLock?.();
                } catch {}
                await finishWrite();
            }
        } else {
            throwIfAborted(signal);
            const buf = Buffer.from(await res.arrayBuffer());
            fs.writeFileSync(destPath, buf);
            downloaded = buf.length;
            safeCall(progress?.onDownloadProgress, {
                label,
                downloadedBytes: downloaded,
                totalBytes: total || downloaded,
                bytesPerSecond: 0,
            });
        }

        safeCall(progress?.onDownloadEnd, { label, downloadedBytes: downloaded, totalBytes: total || downloaded });
        return { downloadedBytes: downloaded, totalBytes: total || downloaded };
    }

    async function listRemoteFilesRecursive(remoteDir, repo = DEFAULT_REPO, opts = {}) {
        const signal = opts && opts.signal;
        throwIfAborted(signal);
        const res = await fetch(`${getApiBase(repo)}/${remoteDir}?ref=${repo.branch}`, signal ? { signal } : undefined);
        if (!res.ok) throw new Error(`Failed to list ${remoteDir}: ${res.status}`);
        const items = await res.json();

        const out = [];
        for (const item of items) {
            const remotePath = `${remoteDir}/${item.name}`;
            if (item.type === "dir") {
                out.push(...(await listRemoteFilesRecursive(remotePath, repo, opts)));
            } else if (item.type === "file") {
                out.push({ remotePath, size: typeof item.size === "number" ? item.size : 0 });
            }
        }
        return out;
    }
    async function downloadDirectoryWithProgress(remoteDir, localDir, repo = DEFAULT_REPO, progress, opts = {}) {
        fs.mkdirSync(localDir, { recursive: true });

        const signal = opts && opts.signal;

        safeCall(progress?.onStep, { label: `Listing files…`, phase: "listing" });
        throwIfAborted(signal);

        const files = await listRemoteFilesRecursive(remoteDir, repo, opts);
        const totalBytes = files.reduce((a, f) => a + (f.size || 0), 0) || null;

        safeCall(progress?.onDownloadStart, { label: "Module download", totalBytes, remoteDir, localDir });

        let downloadedTotal = 0;
        const speedOf = mkSpeedometer();

        for (const f of files) {
            throwIfAborted(signal);

            const rel = f.remotePath.substring(remoteDir.length + 1);
            const localPath = path.join(localDir, ...rel.split("/"));
            fs.mkdirSync(path.dirname(localPath), { recursive: true });

            const url = `${getRawBase(repo)}/${f.remotePath}`;
            const res = await fetch(url, signal ? { signal } : undefined);
            if (!res.ok) continue;

            const body = res.body;
            const ws = fs.createWriteStream(localPath);

            if (body && typeof body.getReader === "function") {
                const reader = body.getReader();
                try {
                    while (true) {
                        throwIfAborted(signal);
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (value) {
                            const buf = Buffer.from(value);
                            ws.write(buf);
                            downloadedTotal += buf.length;
                            safeCall(progress?.onDownloadProgress, {
                                label: "Module download",
                                downloadedBytes: downloadedTotal,
                                totalBytes: totalBytes || downloadedTotal,
                                bytesPerSecond: speedOf(downloadedTotal),
                            });
                        }
                    }
                } catch (e) {
                    if (isAbortError(e)) {
                        try {
                            ws.destroy();
                        } catch {}
                        try {
                            fs.rmSync(localPath, { force: true });
                        } catch {}
                    }
                    throw e;
                } finally {
                    try {
                        reader.releaseLock?.();
                    } catch {}
                    await new Promise((resolve, reject) => {
                        ws.on("error", reject);
                        ws.end(resolve);
                    });
                }
            } else {
                throwIfAborted(signal);
                const data = await res.arrayBuffer();
                const buf = Buffer.from(data);
                fs.writeFileSync(localPath, buf);
                downloadedTotal += buf.length;
                safeCall(progress?.onDownloadProgress, {
                    label: "Module download",
                    downloadedBytes: downloadedTotal,
                    totalBytes: totalBytes || downloadedTotal,
                    bytesPerSecond: speedOf(downloadedTotal),
                });
                try {
                    ws.end();
                } catch {}
            }
        }

        safeCall(progress?.onDownloadEnd, {
            label: "Module download",
            downloadedBytes: downloadedTotal,
            totalBytes: totalBytes || downloadedTotal,
        });

        return { filesCount: files.length, totalBytes: totalBytes || downloadedTotal };
    }

    function makeStepper(progress) {
        let current = 0;
        let total = null;
        return {
            setTotal(n) {
                total = typeof n === "number" ? n : null;
                safeCall(progress?.onStepTotal, { total });
            },
            next(label) {
                current += 1;
                safeCall(progress?.onStep, { label, current, total });
            },
        };
    }
    async function installModuleDependenciesWithProgress(modulePath, progress, stepper, opts = {}) {
        const signal = opts && opts.signal;
        throwIfAborted(signal);

        const mf = path.join(modulePath, "manifest.json");
        if (!fs.existsSync(mf)) return;

        let manifest;
        try {
            manifest = JSON.parse(fs.readFileSync(mf, "utf8"));
        } catch {
            return;
        }

        const deps = depsFromManifest(manifest);
        const depEntries = Object.entries(deps);
        if (depEntries.length === 0) return;

        const depsRoot = path.join(modulePath, "deps");
        fs.mkdirSync(depsRoot, { recursive: true });

        for (const [depName, builds] of depEntries) {
            throwIfAborted(signal);

            stepper?.next?.(`Downloading dependency: ${depName}`);

            const spec = resolveDepSpec(builds, sysArch);
            if (!spec || !spec.link) throw new Error(`No build for "${depName}" matching arch "${sysArch}"`);

            const depDir = path.join(depsRoot, depName);
            fs.mkdirSync(depDir, { recursive: true });

            const fileName = path.basename(new URL(spec.link).pathname);
            const archivePath = path.join(depDir, fileName);

            await downloadUrlToFileWithProgress(spec.link, archivePath, progress, `Dependency: ${depName}`, opts);

            if (spec.unzip) {
                stepper?.next?.(`Extracting dependency: ${depName}`);
                safeCall(progress?.onStep, { label: `Extracting dependency: ${depName}`, phase: "extracting" });
                throwIfAborted(signal);
                await extractArchive(archivePath, depDir, opts);
                fs.rmSync(archivePath, { force: true });
            }
        }

        try {
            exec(`chown -R "${os.userInfo().uid}" "${depsRoot}"`, () => {});
        } catch {}
        try {
            exec(`xattr -cr "${depsRoot}"`, () => {});
        } catch {}
        try {
            exec(`chmod -R 700 "${depsRoot}"`, () => {});
        } catch {}
    }
    async function updateDependenciesWithProgress(folder, progress, stepper, updatesOrOpts = null, maybeOpts = {}) {
        let updates = null;
        let opts = maybeOpts;
        if (updatesOrOpts && typeof updatesOrOpts === "object" && "signal" in updatesOrOpts) {
            opts = updatesOrOpts;
        } else {
            updates = updatesOrOpts;
        }

        const signal = opts && opts.signal;
        throwIfAborted(signal);

        stepper?.next?.("Checking dependency updates…");

        const resolvedUpdates = updates || (await getDependencyUpdates(folder));
        const entries = Object.entries(resolvedUpdates || {});
        if (!entries.length) {
            safeCall(progress?.onStep, { label: "No dependency updates found.", phase: "done" });
            return { updated: [] };
        }

        const modulePath = getModulePath(folder);
        const depsRoot = path.join(modulePath, "deps");
        fs.mkdirSync(depsRoot, { recursive: true });

        const updatedDeps = [];

        for (const [depName, builds] of entries) {
            throwIfAborted(signal);

            stepper?.next?.(`Updating dependency: ${depName}`);

            try {
                removeDependencyLocal(folder, depName);
            } catch {}

            const spec = resolveDepSpec(builds, sysArch);
            if (!spec || !spec.link) throw new Error(`No update spec for "${depName}" matching arch "${sysArch}"`);

            const depDir = path.join(depsRoot, depName);
            fs.mkdirSync(depDir, { recursive: true });

            const fileName = path.basename(new URL(spec.link).pathname);
            const archivePath = path.join(depDir, fileName);

            await downloadUrlToFileWithProgress(spec.link, archivePath, progress, `Dependency: ${depName}`, opts);

            if (spec.unzip) {
                stepper?.next?.(`Extracting dependency: ${depName}`);
                safeCall(progress?.onStep, { label: `Extracting dependency: ${depName}`, phase: "extracting" });
                throwIfAborted(signal);
                await extractArchive(archivePath, depDir, opts);
                fs.rmSync(archivePath, { force: true });
            }

            updatedDeps.push(depName);
        }

        if (updatedDeps.length > 0) {
            stepper?.next?.("Running post-update…");
            await runPostUpdate(folder, updatedDeps);
        }

        try {
            exec(`chown -R "${os.userInfo().uid}" "${depsRoot}"`, () => {});
        } catch {}
        try {
            exec(`xattr -cr "${depsRoot}"`, () => {});
        } catch {}
        try {
            exec(`chmod -R 700 "${depsRoot}"`, () => {});
        } catch {}

        clearDepUpdateFlag(folder);
        return { updated: updatedDeps };
    }

    async function updateDependenciesTaskWithProgress(folder, progress, opts = {}) {
        const stepper = makeStepper(progress);
        const signal = opts && opts.signal;
        throwIfAborted(signal);

        // Pre-compute updates so we can set an accurate total
        const updates = await getDependencyUpdates(folder);
        const entries = Object.entries(updates || {});

        const updateSteps = entries.reduce((sum, [, builds]) => {
            const spec = resolveDepSpec(builds, sysArch);
            return sum + 1 + (spec && spec.unzip ? 1 : 0);
        }, 0);

        const willRunPostUpdate = entries.length > 0 ? 1 : 0;

        stepper.setTotal(1 + updateSteps + willRunPostUpdate + 1);

        await updateDependenciesWithProgress(folder, progress, stepper, updates, opts);

        stepper.next("Done.");
        clearDepUpdateFlag(folder);
        return true;
    }
    async function installModuleWithProgress(folder, repo = DEFAULT_REPO, progress, opts = {}) {
        const stepper = makeStepper(progress);
        const signal = opts && opts.signal;
        throwIfAborted(signal);

        // Use remote manifest to estimate total steps early.
        let remoteDeps = {};
        try {
            const remote = await fetchRemoteManifest(folder, repo, opts);
            remoteDeps = depsFromManifest(remote.raw);
        } catch {}

        let depSteps = countDepSteps(remoteDeps, sysArch);
        // download + deps (download/extract) + done
        stepper.setTotal(1 + depSteps + 1);

        stepper.next(`Downloading module: ${folder}`);

        const remoteRoot = `modules/${folder}`;
        const localRoot = path.join(getModulesDir(), folder);

        try {
            if (fs.existsSync(localRoot)) fs.rmSync(localRoot, { recursive: true, force: true });

            await downloadDirectoryWithProgress(remoteRoot, localRoot, repo, progress, opts);

            // Re-check deps from the freshly downloaded manifest
            const localManifest = safeReadJson(path.join(localRoot, "manifest.json")) || {};
            const localDeps = depsFromManifest(localManifest);
            const localDepSteps = countDepSteps(localDeps, sysArch);

            if (localDepSteps !== depSteps) {
                depSteps = localDepSteps;
                stepper.setTotal(1 + depSteps + 1);
            }

            if (Object.keys(localDeps).length > 0) {
                await installModuleDependenciesWithProgress(localRoot, progress, stepper, opts);
            }

            stepper.next("Done.");
            return true;
        } catch (e) {
            if (isAbortError(e)) {
                // User asked to clean up via uninstall to avoid leaving damaged files.
                try {
                    uninstallModule(folder);
                } catch {
                    try {
                        fs.rmSync(localRoot, { recursive: true, force: true });
                    } catch {}
                }
                throw mkAbortError();
            }
            throw e;
        }
    }

    // superlong name :P
    async function updateModulePreservingMultiversionsWithProgress(folder, progress, opts = {}) {
        const signal = opts && opts.signal;

        let stashBase = null;
        try {
            safeCall(progress?.onStep, { label: "Preparing update…", phase: "prepare" });
            throwIfAborted(signal);

            const appSupport = GlobalSettings.getAppSupportDir();
            const modRoot = path.join(appSupport, "modules", folder);
            const depsRoot = path.join(modRoot, "deps");
            const manifestPath = path.join(modRoot, "manifest.json");

            const oldManifest = safeReadJson(manifestPath) || {};
            const oldMultiKeys = extractMultiVersionKeys(oldManifest);
            const toPreserve = [];
            for (const key of oldMultiKeys) {
                const p = path.join(depsRoot, key);
                if (fs.existsSync(p)) toPreserve.push({ key, abs: p });
            }

            safeCall(progress?.onStep, { label: "Preserving multi-version dependencies…", phase: "preserve" });
            throwIfAborted(signal);

            stashBase = path.join(appSupport, ".xeno-preserve", `${folder}-${Date.now()}`);
            const stashRoot = path.join(stashBase, "deps");
            ensureDir(stashRoot);

            for (const item of toPreserve) {
                const dest = path.join(stashRoot, item.key);
                moveDirOrCopy(item.abs, dest);
            }

            safeCall(progress?.onStep, { label: "Updating module files…", phase: "update" });
            throwIfAborted(signal);

            try {
                Module.uninstallModule(folder);
            } catch (e) {
                console.warn("uninstallModule failed (continuing):", e);
            }
            await installModuleWithProgress(folder, DEFAULT_REPO, progress, opts);

            safeCall(progress?.onStep, { label: "Restoring preserved versions…", phase: "restore" });
            throwIfAborted(signal);

            const newManifest = safeReadJson(manifestPath) || {};
            const newMultiKeys = new Set(extractMultiVersionKeys(newManifest));
            ensureDir(depsRoot);

            for (const { key } of toPreserve) {
                if (!newMultiKeys.has(key)) continue;
                const src = path.join(stashRoot, key);
                const dest = path.join(depsRoot, key);
                if (!fs.existsSync(src)) continue;

                try {
                    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
                } catch {}
                moveDirOrCopy(src, dest);
            }

            for (const { key } of toPreserve) {
                if (!newMultiKeys.has(key)) {
                    const orphan = path.join(depsRoot, key);
                    try {
                        fs.rmSync(orphan, { recursive: true, force: true });
                    } catch {}
                }
            }

            safeCall(progress?.onStep, { label: "Cleaning up…", phase: "cleanup" });
            throwIfAborted(signal);

            // Clean only THIS job’s stash (never the whole parent dir unless empty)
            try {
                if (stashBase) fs.rmSync(stashBase, { recursive: true, force: true });
            } catch {}
            try {
                const preserveDir = path.join(appSupport, ".xeno-preserve");
                if (fs.existsSync(preserveDir) && fs.readdirSync(preserveDir).length === 0) {
                    fs.rmSync(preserveDir, { recursive: true, force: true });
                }
            } catch {}

            safeCall(progress?.onStep, { label: "Finalizing…", phase: "finalize" });
            throwIfAborted(signal);

            await fixQuarantineAndPerms(depsRoot);
        } catch (e) {
            // On cancel/abort (or any failure), do best-effort cleanup: remove partially updated module + this job’s stash.
            const aborted = isAbortError(e);
            try {
                if (folder) Module.uninstallModule(folder);
            } catch {}
            try {
                if (stashBase) fs.rmSync(stashBase, { recursive: true, force: true });
                const appSupport = GlobalSettings.getAppSupportDir();
                const preserveDir = path.join(appSupport, ".xeno-preserve");
                if (fs.existsSync(preserveDir) && fs.readdirSync(preserveDir).length === 0) {
                    fs.rmSync(preserveDir, { recursive: true, force: true });
                }
            } catch {}
            if (aborted) throw mkAbortError();
            throw e;
        }
    }

    // ===== Archive extraction helper (.zip, .tar.gz/.tgz, .tar) ===================
    function isZipPath(p) {
        const s = String(p || "").toLowerCase();
        return s.endsWith(".zip");
    }
    function isTarGzPath(p) {
        const s = String(p || "").toLowerCase();
        return s.endsWith(".tar.gz") || s.endsWith(".tgz");
    }
    function isTarXzPath(p) {
        const s = String(p || "").toLowerCase();
        return s.endsWith(".tar.xz") || s.endsWith(".txz");
    }
    function isTarPath(p) {
        const s = String(p || "").toLowerCase();
        return s.endsWith(".tar");
    }

    // Basic safety: avoid path traversal (../../) and absolute paths inside archives
    function safeArchiveEntryPath(p) {
        if (!p) return false;
        const norm = String(p).replace(/\\/g, "/"); // normalize
        if (norm.startsWith("/")) return false;
        if (/^[A-Za-z]:\//.test(norm)) return false; // windows drive absolute
        const parts = norm.split("/").filter(Boolean);
        if (parts.includes("..")) return false;
        return true;
    }

    async function extractArchive(archivePath, destDir, opts = {}) {
        const signal = opts && opts.signal;
        throwIfAborted(signal);
        fs.mkdirSync(destDir, { recursive: true });

        const { pipeline } = require("node:stream/promises");

        function attachAbort(streams) {
            if (!signal) return () => {};
            if (signal.aborted) throw mkAbortError();

            const onAbort = () => {
                for (const s of streams) {
                    try {
                        if (s && typeof s.destroy === "function") s.destroy(mkAbortError());
                    } catch {}
                }
            };
            signal.addEventListener("abort", onAbort, { once: true });
            return () => {
                try {
                    signal.removeEventListener("abort", onAbort);
                } catch {}
            };
        }

        // Ensure extracted path stays within destDir
        function safeJoin(base, rel) {
            const target = path.resolve(base, rel);
            const baseResolved = path.resolve(base) + path.sep;
            if (!target.startsWith(baseResolved)) return null;
            return target;
        }

        if (isZipPath(archivePath)) {
            let unzipper;
            try {
                unzipper = require("unzipper");
            } catch {
                throw new Error('Archive extraction requested ZIP, but "unzipper" is not installed.');
            }

            const rs = fs.createReadStream(archivePath);
            const parser = unzipper.Parse({ forceStream: true });
            const stream = rs.pipe(parser);

            const detach = attachAbort([rs, stream, parser]);

            try {
                for await (const entry of stream) {
                    throwIfAborted(signal);

                    const relPath = (entry.path || "").replace(/\\/g, "/");
                    if (!safeArchiveEntryPath(relPath)) {
                        try {
                            entry.autodrain();
                        } catch {}
                        continue;
                    }

                    const outPath = safeJoin(destDir, relPath);
                    if (!outPath) {
                        try {
                            entry.autodrain();
                        } catch {}
                        continue;
                    }

                    if (entry.type === "Directory") {
                        fs.mkdirSync(outPath, { recursive: true });
                        try {
                            entry.autodrain();
                        } catch {}
                        continue;
                    }

                    fs.mkdirSync(path.dirname(outPath), { recursive: true });
                    await pipeline(entry, fs.createWriteStream(outPath));
                }
                return;
            } catch (e) {
                if (isAbortError(e) || (signal && signal.aborted)) throw mkAbortError();
                throw e;
            } finally {
                detach();
                try {
                    rs.close?.();
                } catch {}
            }
        }

        if (isTarGzPath(archivePath) || isTarXzPath(archivePath) || isTarPath(archivePath)) {
            let tar;
            try {
                tar = require("tar");
            } catch {
                throw new Error('Archive extraction requested TAR, but "tar" is not installed.');
            }

            const src = fs.createReadStream(archivePath);
            const streams = [src];
            const detach = attachAbort(streams);

            try {
                if (isTarGzPath(archivePath)) {
                    const zlib = require("zlib");
                    const gunzip = zlib.createGunzip();
                    const tx = tar.x({
                        cwd: destDir,
                        gzip: false,
                        preserveOwner: false,
                        filter: (p) => safeArchiveEntryPath(p),
                    });
                    streams.push(gunzip, tx);
                    await pipeline(src, gunzip, tx);
                    return;
                }

                if (isTarPath(archivePath)) {
                    const tx = tar.x({
                        cwd: destDir,
                        gzip: false,
                        preserveOwner: false,
                        filter: (p) => safeArchiveEntryPath(p),
                    });
                    streams.push(tx);
                    await pipeline(src, tx);
                    return;
                }

                if (isTarXzPath(archivePath)) {
                    let lzma;
                    try {
                        lzma = require("lzma-native");
                    } catch {
                        throw new Error('Archive extraction requested TAR.XZ, but "lzma-native" is not installed.');
                    }
                    const dec = lzma.createDecompressor();
                    const tx = tar.x({
                        cwd: destDir,
                        preserveOwner: false,
                        filter: (p) => safeArchiveEntryPath(p),
                    });
                    streams.push(dec, tx);
                    await pipeline(src, dec, tx);
                    return;
                }
            } catch (e) {
                if (isAbortError(e) || (signal && signal.aborted)) throw mkAbortError();
                throw e;
            } finally {
                detach();
            }
        }

        throw new Error(`Unsupported archive type: ${path.basename(archivePath)}`);
    }
    function uninstallModule(folder) {
        const localRoot = path.join(getModulesDir(), folder);
        if (fs.existsSync(localRoot)) fs.rmSync(localRoot, { recursive: true, force: true });
    }

    // ===== Autodetect =====================

    // Normalizes a file extension (no leading dot, lowercase)
    function normalizeExt(ext) {
        if (!ext) return "";
        return String(ext).replace(/^\.+/, "").toLowerCase();
    }

    // Returns extension (no dot) from a path safely, even if it ends with a slash
    function getPathExtLower(p) {
        if (!p) return "";
        let pp = String(p)
            .trim()
            .replace(/[\\/]+$/, "");
        const base = path.basename(pp);
        const idx = base.lastIndexOf(".");
        return idx >= 0 ? base.slice(idx + 1).toLowerCase() : "";
    }

    // Detects macOS .app bundles by extension only (no fs check)
    function isAppBundlePath(p) {
        return normalizeExt(getPathExtLower(p)) === "app";
    }

    // For an executable path, return the directory to probe for files
    function gameDirForFiles(exe) {
        return isAppBundlePath(exe) ? String(exe).replace(/[\\/]+$/, "") : path.dirname(exe);
    }

    /**
     * Detect engine among *installed* modules using their manifests' `autodetect` block.
     * Signature matches game-settings.html usage.
     */
    function detectEngineForPath(exe, moduleManifests) {
        if (!exe) return null;
        const extOnPath = normalizeExt(getPathExtLower(exe));
        const dir = gameDirForFiles(exe);

        let bestKey = null,
            bestScore = 0,
            bestTie = { fileMatches: -1, extMatch: false };
        const strongMatches = [];

        for (const [key, manifest] of Object.entries(moduleManifests || {})) {
            const ad = manifest.autodetect;
            if (!ad) continue;

            // extension(s)
            const extListRaw = Array.isArray(ad.extensions) ? ad.extensions : ad.extension ? [ad.extension] : [];
            const extList = extListRaw.map(normalizeExt).filter(Boolean);
            const hasExtRule = extList.length > 0;
            const extMatch = hasExtRule ? extList.includes(extOnPath) : false;

            // file probes (relative paths in the manifest)
            const files = Array.isArray(ad.files) ? ad.files : [];
            let fileMatches = 0;
            const fileTotal = files.length;
            if (fileTotal > 0) {
                for (const rel of files) {
                    const probe = path.join(dir, rel);
                    if (fs.existsSync(probe)) fileMatches++;
                }
            }

            const allRequired = !!ad.all_required;
            if (allRequired) {
                const needExt = hasExtRule ? extMatch : true;
                const needFiles = fileTotal > 0 ? fileMatches === fileTotal : true;
                if (needExt && needFiles) strongMatches.push({ key, fileMatches, extMatch });
                continue;
            }

            // scoring: 1 point if ext matches, plus fraction of files matched
            let score = 0;
            if (hasExtRule && extMatch) score += 1;
            if (fileTotal > 0) score += fileMatches / fileTotal;

            if (score > bestScore) {
                bestScore = score;
                bestKey = key;
                bestTie = { fileMatches, extMatch };
            } else if (score === bestScore && score > 0) {
                const better =
                    fileMatches > bestTie.fileMatches ||
                    (fileMatches === bestTie.fileMatches && extMatch && !bestTie.extMatch);
                if (better) {
                    bestKey = key;
                    bestTie = { fileMatches, extMatch };
                }
            }
        }

        if (strongMatches.length === 1) return strongMatches[0].key;
        if (strongMatches.length > 1) {
            strongMatches.sort((a, b) => {
                if (b.fileMatches !== a.fileMatches) return b.fileMatches - a.fileMatches;
                if (a.extMatch !== b.extMatch) return (b.extMatch ? 1 : 0) - (a.extMatch ? 1 : 0);
                return 0;
            });
            return strongMatches[0].key;
        }
        return bestScore > 0 ? bestKey : null;
    }

    /**
     * Build a lightweight autodetect map for *non-installed* modules by reading remote manifests.
     * This is used by game-settings.html for remote autodetect + "install now?" flow.
     */
    async function fetchModulesForAutodetect(repo = DEFAULT_REPO, installedSet = getInstalledModuleFolders()) {
        const manifests = await fetchRemoteManifestsList(repo);
        const map = {};
        for (const m of manifests) {
            if (!m.raw || !m.raw.autodetect) continue;
            if (installedSet.has(m.folder)) continue; // only include non-installed ones
            const ad = m.raw.autodetect;

            const rawExts = Array.isArray(ad.extensions) ? ad.extensions : ad.extension ? [ad.extension] : [];
            const extensions = rawExts.map((e) => String(e).replace(/^\.+/, "").toLowerCase()).filter(Boolean);

            const files = Array.isArray(ad.files) ? ad.files : [];
            const all_required = !!ad.all_required;

            map[m.folder] = {};
            if (extensions.length) map[m.folder].extensions = extensions;
            if (files.length) map[m.folder].files = files;
            if (typeof all_required === "boolean") map[m.folder].all_required = all_required;
        }
        return map;
    }

    /**
     * Detect engine among a defs map (extensions/files) returned by fetchModulesForAutodetect.
     * Signature matches game-settings.html usage.
     */
    function detectEngineFromAutodetectMap(exe, defsMap) {
        if (!exe || !defsMap) return null;
        const extOnPath = normalizeExt(getPathExtLower(exe));
        const dir = gameDirForFiles(exe);

        let bestKey = null,
            bestScore = 0,
            bestTie = { fileMatches: -1, extMatch: false };
        const strongMatches = [];

        for (const [key, ad] of Object.entries(defsMap)) {
            const extList = Array.isArray(ad.extensions) ? ad.extensions.map(normalizeExt).filter(Boolean) : [];
            const hasExtRule = extList.length > 0;
            const extMatch = hasExtRule ? extList.includes(extOnPath) : false;

            const files = Array.isArray(ad.files) ? ad.files : [];
            let fileMatches = 0;
            const fileTotal = files.length;
            if (fileTotal > 0) {
                for (const rel of files) {
                    const probe = path.join(dir, rel);
                    if (fs.existsSync(probe)) fileMatches++;
                }
            }

            const allRequired = !!ad.all_required;
            if (allRequired) {
                const needExt = hasExtRule ? extMatch : true;
                const needFiles = fileTotal > 0 ? fileMatches === fileTotal : true;
                if (needExt && needFiles) strongMatches.push({ key, fileMatches, extMatch });
                continue;
            }

            let score = 0;
            if (hasExtRule && extMatch) score += 1;
            if (fileTotal > 0) score += fileMatches / fileTotal;

            if (score > bestScore) {
                bestScore = score;
                bestKey = key;
                bestTie = { fileMatches, extMatch };
            } else if (score === bestScore && score > 0) {
                const better =
                    fileMatches > bestTie.fileMatches ||
                    (fileMatches === bestTie.fileMatches && extMatch && !bestTie.extMatch);
                if (better) {
                    bestKey = key;
                    bestTie = { fileMatches, extMatch };
                }
            }
        }

        if (strongMatches.length === 1) return strongMatches[0].key;
        if (strongMatches.length > 1) {
            strongMatches.sort((a, b) => {
                if (b.fileMatches !== a.fileMatches) return b.fileMatches - a.fileMatches;
                if (a.extMatch !== b.extMatch) return (b.extMatch ? 1 : 0) - (a.extMatch ? 1 : 0);
                return 0;
            });
            return strongMatches[0].key;
        }
        return bestScore > 0 ? bestKey : null;
    }

    function resolveGameFolder(gamePath) {
        let gameFolder = gamePath;
        try {
            if (fs.statSync(gamePath).isFile()) gameFolder = path.dirname(gamePath);
        } catch {}
        return gameFolder;
    }

    function getModuleUi() {
        const dialog = window.AppDialog;
        return {
            alert(message, title = "Notice") {
                if (dialog && typeof dialog.alert === "function") {
                    return dialog.alert(message, title);
                }
                try {
                    window.alert(String(message || ""));
                } catch {}
                return Promise.resolve(true);
            },
            confirm(message, title = "Confirm") {
                if (dialog && typeof dialog.confirm === "function") {
                    return dialog.confirm(message, title);
                }
                try {
                    return Promise.resolve(window.confirm(String(message || "")));
                } catch {}
                return Promise.resolve(false);
            },
        };
    }

    async function launchWithEngine(game, { openSubwindow } = {}) {
        const modulePath = path.join(getModulesDir(), game.gameEngine);
        const dialog = window.AppDialog;
        const ui = getModuleUi();

        const proceed = async () => {
            const manifestPath = path.join(modulePath, "manifest.json");
            if (!fs.existsSync(manifestPath)) {
                if (dialog && typeof dialog.alert === "function") {
                    await dialog.alert(`manifest.json not found for engine "${game.gameEngine}".`, "Launch Error");
                }
                return;
            }

            try {
                JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
            } catch (e) {
                console.warn(`Invalid JSON in ${manifestPath}`, e);
                if (dialog && typeof dialog.alert === "function") {
                    await dialog.alert(`Invalid manifest for engine "${game.gameEngine}".`, "Launch Error");
                }
                return;
            }

            const gameFolder = resolveGameFolder(game.gamePath);

            // permissions
            // Tim we are not cooking here
            exec(`chown -R "${os.userInfo().uid}" "${gameFolder}"`, () => {});
            exec(`xattr -cr "${gameFolder}"`, () => {});
            exec(`chmod -R 700 "${gameFolder}"`, () => {});

            const launcherPath = path.join(modulePath, "launcher.js");
            if (!fs.existsSync(launcherPath)) {
                if (dialog && typeof dialog.alert === "function") {
                    await dialog.alert(`launcher.js not found for engine "${game.gameEngine}".`, "Launch Error");
                }
                return;
            }

            try {
                // Ensure launcher and any module-local dependencies are reloaded after updates.
                clearRequireCacheForDir(modulePath);
                const { launch } = require(launcherPath);
                launch(game.gamePath, gameFolder, game.gameArgs, game.gameTitle || "", ui);
            } catch (e) {
                console.error(`Error launching with ${game.gameEngine}:`, e);
                if (dialog && typeof dialog.alert === "function") {
                    await dialog.alert(`Failed to launch: ${e.message}`, "Launch Error");
                }
            }
        };

        if (!fs.existsSync(modulePath) || !fs.statSync(modulePath).isDirectory()) {
            const wantsInstall =
                dialog && typeof dialog.confirm === "function"
                    ? await dialog.confirm(
                          `Module not found for engine "${game.gameEngine}".\nWould you like to install it now?`,
                          "Module Missing"
                      )
                    : false;
            if (!wantsInstall) return;

            const searchParam = encodeURIComponent(game.gameEngine || "");
            if (typeof openSubwindow === "function") {
                openSubwindow(`module-manager.html?search=${searchParam}`, null, () => {
                    if (fs.existsSync(modulePath) && fs.statSync(modulePath).isDirectory()) void proceed();
                });
            } else {
                if (dialog && typeof dialog.alert === "function") {
                    await dialog.alert(
                        "Please open Module Manager and install the required module, then try again.",
                        "Module Missing"
                    );
                }
            }
            return;
        }
        await proceed();
    }

    async function deleteWithEngine(game, { deleteFiles = false } = {}) {
        if (!game || !game.gamePath || !game.gameEngine) return true;

        const gamePath = game.gamePath;
        const gameFolder = resolveGameFolder(gamePath);
        const gameName = game.gameTitle || "";
        const modulePath = path.join(getModulesDir(), game.gameEngine);
        const ui = getModuleUi();

        if (fs.existsSync(modulePath) && fs.statSync(modulePath).isDirectory()) {
            const postDeletePath = path.join(modulePath, "postdelete.js");
            if (fs.existsSync(postDeletePath)) {
                try {
                    delete require.cache[postDeletePath];
                    const { postDelete } = require(postDeletePath);
                    if (typeof postDelete !== "function") {
                        throw new Error("postdelete.js must export postDelete");
                    }
                    await Promise.resolve(postDelete(gameName, gameFolder, gamePath, ui));
                } catch (e) {
                    console.error(`Error deleting with ${game.gameEngine}:`, e);
                    if (window.AppDialog && typeof window.AppDialog.alert === "function") {
                        await window.AppDialog.alert(`Failed to run module post-delete hook: ${e.message}`, "Delete Error");
                    }
                    return false;
                }
            }
        }

        if (deleteFiles) {
            try {
                if (fs.existsSync(gameFolder)) fs.rmSync(gameFolder, { recursive: true, force: true });
            } catch (e) {
                console.error("Failed to delete game files:", e);
                if (window.AppDialog && typeof window.AppDialog.alert === "function") {
                    await window.AppDialog.alert(`Failed to delete game files: ${e.message}`, "Delete Error");
                }
                return false;
            }
        }

        return true;
    }

    // ===== Dependency update support =========================================
    function getModulePath(folder) {
        return path.join(getModulesDir(), folder);
    }

    function readLocalManifestFor(folder) {
        const all = readLocalManifests();
        return all?.[folder] || null;
    }

    function updatesFilePath(folder) {
        return path.join(getModulePath(folder), "updates.js");
    }

    function postUpdateFilePath(folder) {
        return path.join(getModulePath(folder), "postupdate.js");
    }

    function removeDependencyLocal(folder, depName) {
        const depDir = path.join(getModulePath(folder), "deps", depName);
        if (fs.existsSync(depDir)) {
            fs.rmSync(depDir, { recursive: true, force: true });
        }
    }

    async function loadUpdatesProvider(folder) {
        const manifest = readLocalManifestFor(folder);
        if (!manifest || !manifest.updates) return null;
        const file = updatesFilePath(folder);
        if (!fs.existsSync(file)) return null;

        // Clear require cache to ensure fresh reads
        delete require.cache[file];
        try {
            const mod = require(file);
            if (mod && typeof mod.checkUpdates === "function") return mod;
        } catch (e) {
            console.warn("Failed loading updates.js for", folder, e);
        }
        return null;
    }

    async function loadPostUpdateProvider(folder) {
        const file = postUpdateFilePath(folder);
        if (!fs.existsSync(file)) return null;

        // Clear require cache to ensure fresh reads
        delete require.cache[file];

        try {
            const mod = require(file);
            const fn =
                (mod && typeof mod.postUpdate === "function" && mod.postUpdate) ||
                (mod && typeof mod.postupdate === "function" && mod.postupdate) ||
                null;

            return fn;
        } catch (e) {
            console.warn("Failed loading postupdate.js for", folder, e);
        }
        return null;
    }

    async function getDependencyUpdates(folder) {
        try {
            const prov = await loadUpdatesProvider(folder);
            if (!prov) return {};
            const out = await prov.checkUpdates(getModuleUi());
            return out && typeof out === "object" ? out : {};
        } catch (e) {
            console.warn("getDependencyUpdates error:", e);
            return {};
        }
    }

    async function hasDependencyUpdates(folder) {
        const map = await getDependencyUpdates(folder);
        return Object.keys(map).length > 0;
    }

    async function checkDependencyUpdatesForFolders(folders, opts = {}) {
        const forceRefresh = !!(opts && opts.forceRefresh);

        // Cache read
        if (!forceRefresh) {
            try {
                const disk = loadDepUpdatesCache();
                if (disk && (!depUpdatesMem ||depUpdatesMem.fetchedAt !== disk.fetchedAt)) {
                   depUpdatesMem = disk;
                }
            } catch {}

            if (depUpdatesMem &&depUpdatesMem.updatesByFolder) {
                const set = new Set();
                for (const f of folders) if (depUpdatesMem.updatesByFolder[f]) set.add(f);
                return set;
            }
        }

        // De-dupe concurrent refreshes in this window
        if (depUpdatesInflight) {
            const cache = await depUpdatesInflight;
            const set = new Set();
            for (const f of folders) if (cache.updatesByFolder && cache.updatesByFolder[f]) set.add(f);
            return set;
        }

        depUpdatesInflight = (async () => {
            // Merge into any existing cache so we don't "forget" folders we aren't checking now.
            const base =
                (depUpdatesMem && depUpdatesMem.updatesByFolder) ||
                (loadDepUpdatesCache() || {}).updatesByFolder ||
                {};
            const updatesByFolder = { ...base };

            for (const f of folders) {
                try {
                    updatesByFolder[f] = !!(await hasDependencyUpdates(f));
                } catch (e) {
                    console.warn("checkDependencyUpdatesForFolders failed for", f, e);
                    // keep prior cached value if we have it, otherwise assume false
                    updatesByFolder[f] = !!updatesByFolder[f];
                }
            }

            const cacheObj = {
                schema: CACHE_SCHEMA,
                fetchedAt: new Date().toISOString(),
                updatesByFolder,
            };
           depUpdatesMem = cacheObj;
            saveDepUpdatesCache(updatesByFolder);
            return cacheObj;
        })();

        try {
            const cache = await depUpdatesInflight;
            const set = new Set();
            for (const f of folders) if (cache.updatesByFolder && cache.updatesByFolder[f]) set.add(f);
            return set;
        } finally {
            depUpdatesInflight = null;
        }
    }
    async function installOneDependency(depName, builds, depsRoot, opts = {}) {
        const signal = opts && opts.signal;
        throwIfAborted(signal);

        const spec = resolveDepSpec(builds, sysArch);
        if (!spec || !spec.link) throw new Error(`No dependency spec for "${depName}" matching arch "${sysArch}"`);

        const depDir = path.join(depsRoot, depName);
        fs.mkdirSync(depDir, { recursive: true });

        const fileName = path.basename(new URL(spec.link).pathname);
        const archivePath = path.join(depDir, fileName);

        await downloadUrlToFileWithProgress(spec.link, archivePath, null, `Dependency: ${depName}`, opts);

        if (spec.unzip) {
            throwIfAborted(signal);
            await extractArchive(archivePath, depDir, opts);
            fs.rmSync(archivePath, { force: true });
        }
    }
    async function runPostUpdate(folder, updatedDeps) {
        try {
            const fn = await loadPostUpdateProvider(folder);
            if (!fn) return;
            const ui = getModuleUi();

            await Promise.resolve(
                fn({
                    updatedDeps: Array.isArray(updatedDeps) ? updatedDeps : [],
                    ui,
                }, ui)
            );
        } catch (e) {
            console.warn(`postupdate.js failed for "${folder}":`, e);
        }
    }

    function removeDependency(folder, depName) {
        removeDependencyLocal(folder, depName);
    }

    async function installDependency(folder, depName, builds) {
        await installOneDependency(folder, depName, builds);
    }

    // Update module preserving multiversions

    function safeReadJson(p) {
        try {
            if (!fs.existsSync(p)) return null;
            return JSON.parse(fs.readFileSync(p, "utf8"));
        } catch (e) {
            console.warn("Failed to parse JSON:", p, e);
            return null;
        }
    }

    function extractMultiVersionKeys(manifest) {
        const args = (manifest && manifest.gameArgs) || {};
        return Object.entries(args)
            .filter(([, def]) => def && def.type === "multi-version")
            .map(([k]) => k);
    }

    function ensureDir(p) {
        fs.mkdirSync(p, { recursive: true });
    }

    function copyDirSync(src, dest) {
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
            ensureDir(dest);
            for (const entry of fs.readdirSync(src)) {
                const s = path.join(src, entry);
                const d = path.join(dest, entry);
                copyDirSync(s, d);
            }
        } else {
            ensureDir(path.dirname(dest));
            fs.copyFileSync(src, dest);
        }
    }

    function moveDirOrCopy(src, dest) {
        ensureDir(path.dirname(dest));
        try {
            fs.renameSync(src, dest); // fast if same volume
        } catch (e) {
            if (e && (e.code === "EXDEV" || e.code === "EPERM" || e.code === "EINVAL")) {
                copyDirSync(src, dest);
                fs.rmSync(src, { recursive: true, force: true });
            } else {
                throw e;
            }
        }
    }

    async function fixQuarantineAndPerms(rootAbs) {
        try {
            const { exec } = require("child_process");
            // best-effort; ignore errors on non-macOS
            exec(`chown -R "${os.userInfo().uid}" "${rootAbs}"`, () => {});
            exec(`xattr -cr "${rootAbs}"`, () => {});
            exec(`chmod -R 700 "${rootAbs}"`, () => {});
        } catch {}
    }

    /**
     * Full update that preserves every multi-version directory in deps/<argKey>/...
     * If the updated manifest removes a multi-version variable entirely, its deps/<argKey> folder is deleted.
     */
    // Fix game args after module updates
    function mergeGameArgsWithSchema(savedArgs, schema) {
        const has = Object.prototype.hasOwnProperty;
        const next = {};
        const sArgs = savedArgs || {};
        const sch = schema || {};

        const ensureDefault = (spec) => {
            if (Object.prototype.hasOwnProperty.call(spec, "default")) return spec.default;
            if (spec.type === "boolean") return false; // sensible implicit default
            return null; // no default
        };

        for (const [k, spec] of Object.entries(sch)) {
            if (has.call(sArgs, k)) {
                let v = sArgs[k];
                switch (spec.type) {
                    case "boolean":
                        if (typeof v !== "boolean") v = ensureDefault(spec);
                        break;
                    case "number":
                        if (typeof v !== "number" || Number.isNaN(v)) v = ensureDefault(spec);
                        break;
                    case "select":
                        // if you use select/options, enforce membership
                        if (typeof v !== "string" || (Array.isArray(spec.options) && !spec.options.includes(v))) {
                            v = ensureDefault(spec);
                        }
                        break;
                    default:
                        // multi-version, text, etc. — accept as-is unless undefined
                        if (v === undefined) v = ensureDefault(spec);
                }
                next[k] = v;
            } else {
                next[k] = ensureDefault(spec);
            }
        }
        // keys not in schema are removed

        const changed = JSON.stringify(sArgs) !== JSON.stringify(next);
        return { merged: next, changed };
    }

    function reconcileAndPersistGameArgs(gameId) {
        const games = Games.loadGames();
        const game = games?.[gameId];
        if (!game) return;

        const manifests = Module.readLocalManifests();
        const manifest = manifests?.[game.gameEngine];
        if (!manifest?.gameArgs) return;

        const { merged, changed } = Module.mergeGameArgsWithSchema(game.gameArgs, manifest.gameArgs);
        if (changed) {
            game.gameArgs = merged;
            Games.saveGames(games);
        }
        return merged;
    }

    // ===== Public API =========================================================
    window.Module = {
        // repo / paths
        DEFAULT_REPO,
        getModulesDir,
        getInstalledModuleFolders,
        readLocalManifests,

        // manifests / versions
        fetchRemoteManifest,
        fetchRemoteManifestsList,
        compareVersions,
        hasUpdate,

        // install / uninstall
        downloadDirectoryWithProgress,
        installModuleWithProgress,
        uninstallModule,

        // autodetect
        normalizeExt,
        getPathExtLower,
        isAppBundlePath,
        gameDirForFiles,
        fetchModulesForAutodetect,
        detectEngineFromAutodetectMap,
        detectEngineForPath,

        // launching
        launchWithEngine,
        deleteWithEngine,

        // dependency updates
        getDependencyUpdates,
        hasDependencyUpdates,
        checkDependencyUpdatesForFolders,
        clearDepUpdateFlag,
        invalidateDepUpdatesCache,
        updateDependenciesWithProgress,
        updateDependenciesTaskWithProgress,
        removeDependency,
        installDependency,

        // multi-version preserving update
        updateModulePreservingMultiversionsWithProgress,

        // game args updater
        mergeGameArgsWithSchema,
        reconcileAndPersistGameArgs,
    };
})();
