// module.js (unified)
(function () {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const { exec } = require("child_process");

    const DEFAULT_REPO = { owner: "m5kro", repo: "Xenolauncher", branch: "main" };

    // Shared arch map for deps
    const archMap = { x64: "x86_64", arm64: "arm64" };
    const sysArch = archMap[os.arch()] || os.arch();

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
    async function fetchRemoteManifest(folderName, repo = DEFAULT_REPO) {
        const url = `${getRawBase(repo)}/modules/${folderName}/manifest.json`;
        try {
            const res = await fetch(url);
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

    async function fetchRemoteManifestsList(repo = DEFAULT_REPO) {
        const url = `${getApiBase(repo)}/modules?ref=${repo.branch}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
        const items = await res.json();
        const dirs = items.filter((i) => i.type === "dir");
        return Promise.all(dirs.map((d) => fetchRemoteManifest(d.name, repo)));
    }

    // ===== Version helpers ====================================================
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
    async function downloadDirectory(remoteDir, localDir, repo = DEFAULT_REPO) {
        fs.mkdirSync(localDir, { recursive: true });
        const res = await fetch(`${getApiBase(repo)}/${remoteDir}?ref=${repo.branch}`);
        if (!res.ok) throw new Error(`Failed to list ${remoteDir}: ${res.status}`);
        const items = await res.json();
        for (const item of items) {
            const localPath = path.join(localDir, item.name);
            const remotePath = `${remoteDir}/${item.name}`;
            if (item.type === "dir") {
                await downloadDirectory(remotePath, localPath, repo);
            } else if (item.type === "file") {
                const fileRes = await fetch(`${getRawBase(repo)}/${remotePath}`);
                if (!fileRes.ok) continue;
                const data = await fileRes.arrayBuffer();
                fs.writeFileSync(localPath, Buffer.from(data));
            }
        }
    }

    async function installModuleDependencies(modulePath) {
        const mf = path.join(modulePath, "manifest.json");
        if (!fs.existsSync(mf)) return;
        let manifest;
        try {
            manifest = JSON.parse(fs.readFileSync(mf, "utf8"));
        } catch {
            return;
        }
        const deps = manifest.dependencies || {};
        if (Object.keys(deps).length === 0) return;

        const depsRoot = path.join(modulePath, "deps");
        fs.mkdirSync(depsRoot, { recursive: true });

        // Lazy require unzipper only if needed
        let unzipper;
        try {
            unzipper = require("unzipper");
        } catch {
            unzipper = null;
        }

        for (const [depName, builds] of Object.entries(deps)) {
            const depDir = path.join(depsRoot, depName);
            fs.mkdirSync(depDir, { recursive: true });
            const key = builds.universal ? "universal" : sysArch;
            if (!builds[key]) throw new Error(`No build for "${depName}" matching arch "${sysArch}"`);
            const { link, unzip } = builds[key];

            const res = await fetch(link);
            if (!res.ok) throw new Error(`Failed to download ${depName} from ${link}: ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            const fileName = path.basename(new URL(link).pathname);
            const archivePath = path.join(depDir, fileName);
            fs.writeFileSync(archivePath, buf);

            if (unzip) {
                if (!unzipper) throw new Error('Module dependency requested unzip, but "unzipper" is not installed.');
                await new Promise((resolve, reject) => {
                    fs.createReadStream(archivePath)
                        .pipe(unzipper.Extract({ path: depDir }))
                        .on("close", resolve)
                        .on("error", reject);
                });
                fs.rmSync(archivePath, { force: true });
            }
        }

        // permissions
        exec(`xattr -cr "${depsRoot}"`, () => {});
        exec(`chmod -R 700 "${depsRoot}"`, () => {});
    }

    async function installModule(folder, repo = DEFAULT_REPO) {
        const remoteRoot = `modules/${folder}`;
        const localRoot = path.join(getModulesDir(), folder);
        await downloadDirectory(remoteRoot, localRoot, repo);
        if (fs.existsSync(localRoot)) await installModuleDependencies(localRoot);
    }

    function uninstallModule(folder) {
        const localRoot = path.join(getModulesDir(), folder);
        if (fs.existsSync(localRoot)) fs.rmSync(localRoot, { recursive: true, force: true });
    }

    // ===== Autodetect & launching ============================================
    function normalizeExt(ext) {
        return (ext || "").trim().toLowerCase();
    }
    function getPathExtLower(filePath) {
        return normalizeExt(path.extname(filePath));
    }
    function isAppBundlePath(p) {
        return p.toLowerCase().endsWith(".app") && fs.existsSync(p);
    }
    function gameDirForFiles(gamePath) {
        if (!gamePath) return null;
        if (isAppBundlePath(gamePath)) return gamePath;
        try {
            const s = fs.statSync(gamePath);
            if (s.isDirectory()) return gamePath;
            return path.dirname(gamePath);
        } catch {
            return path.dirname(gamePath);
        }
    }

    async function fetchModulesForAutodetect(repo = DEFAULT_REPO, installedSet = getInstalledModuleFolders()) {
        const url = `${getRawBase(repo)}/autodetect-map.json`;
        try {
            const res = await fetch(url);
            if (!res.ok) return [];
            const rules = await res.json();
            // only return autodetect info for installed engines
            return Object.entries(rules)
                .filter(([key]) => installedSet.has(key))
                .map(([key, val]) => ({ key, ...val }));
        } catch {
            return [];
        }
    }

    function detectEngineFromAutodetectMap(game, rules) {
        const dir = gameDirForFiles(game.gamePath);
        if (!dir) return null;

        const allFiles = [];
        try {
            const walk = (d) => {
                const entries = fs.readdirSync(d, { withFileTypes: true });
                for (const e of entries) {
                    const p = path.join(d, e.name);
                    if (e.isDirectory()) walk(p);
                    else allFiles.push(p);
                }
            };
            walk(dir);
        } catch {
            // ignore access errors
        }

        let bestScore = 0;
        let bestKey = null;
        const strongMatches = [];

        for (const rule of rules) {
            const { key, filePatterns = [], ext = [], requireAllFiles = false } = rule || {};
            const hasExtRule = Array.isArray(ext) && ext.length > 0;
            const extSet = new Set(ext.map((e) => normalizeExt(e)));
            const extMatch = hasExtRule ? allFiles.some((f) => extSet.has(getPathExtLower(f))) : false;

            let fileMatches = 0;
            let fileTotal = 0;
            if (Array.isArray(filePatterns) && filePatterns.length) {
                for (const patt of filePatterns) {
                    try {
                        const rx = new RegExp(patt, "i");
                        fileTotal++;
                        if (allFiles.some((f) => rx.test(f))) fileMatches++;
                    } catch {
                        // bad pattern, ignore
                    }
                }
            }

            if (requireAllFiles === true) {
                const allRequired = fileTotal > 0 && fileMatches === fileTotal;
                if (allRequired) {
                    const needExt = hasExtRule ? extMatch : true;
                    if (needExt) strongMatches.push({ key, fileMatches, extMatch });
                    continue;
                }
            }

            let score = 0;
            if (hasExtRule && extMatch) score += 1;
            if (fileMatches > 0) score += fileMatches;
            if (score > bestScore) {
                bestScore = score;
                bestKey = key;
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

    async function detectEngineForPath(game, repo = DEFAULT_REPO, installedSet = getInstalledModuleFolders()) {
        const rules = await fetchModulesForAutodetect(repo, installedSet);
        return detectEngineFromAutodetectMap(game, rules);
    }

    async function launchWithEngine(game, { openSubwindow } = {}) {
        const modulePath = path.join(getModulesDir(), game.gameEngine);

        const proceed = () => {
            const manifestPath = path.join(modulePath, "manifest.json");
            if (!fs.existsSync(manifestPath)) return alert(`manifest.json not found for engine “${game.gameEngine}.”`);

            try {
                JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
            } catch (e) {
                console.warn(`Invalid JSON in ${manifestPath}`, e);
                return alert(`Invalid manifest for engine “${game.gameEngine}.”`);
            }

            let gameFolder = game.gamePath;
            try {
                if (fs.statSync(game.gamePath).isFile()) gameFolder = path.dirname(game.gamePath);
            } catch {}

            // permissions
            // Tim we are not cooking here
            exec(`chown -R "${os.userInfo().uid}" "${gameFolder}"`, () => {});
            exec(`xattr -cr "${gameFolder}"`, () => {});
            exec(`chmod -R 700 "${gameFolder}"`, () => {});

            const launcherPath = path.join(modulePath, "launcher.js");
            if (!fs.existsSync(launcherPath)) return alert(`launcher.js not found for engine “${game.gameEngine}.”`);

            try {
                const { launch } = require(launcherPath);
                launch(game.gamePath, gameFolder, game.gameArgs);
            } catch (e) {
                console.error(`Error launching with ${game.gameEngine}:`, e);
                alert(`Failed to launch: ${e.message}`);
            }
        };

        if (!fs.existsSync(modulePath) || !fs.statSync(modulePath).isDirectory()) {
            const wantsInstall = confirm(
                `Module not found for engine “${game.gameEngine}.”\nWould you like to install it now?`
            );
            if (!wantsInstall) return;

            const searchParam = encodeURIComponent(game.gameEngine || "");
            if (typeof openSubwindow === "function") {
                openSubwindow(`module-manager.html?search=${searchParam}`, null, () => {
                    if (fs.existsSync(modulePath) && fs.statSync(modulePath).isDirectory()) proceed();
                });
            } else {
                alert("Please open Module Manager and install the required module, then try again.");
            }
            return;
        }
        proceed();
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

    async function getDependencyUpdates(folder) {
        try {
            const prov = await loadUpdatesProvider(folder);
            if (!prov) return {};
            const out = await prov.checkUpdates();
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

    async function checkDependencyUpdatesForFolders(folders) {
        const result = new Set();
        for (const f of folders) {
            try {
                if (await hasDependencyUpdates(f)) result.add(f);
            } catch (e) {
                console.warn("checkDependencyUpdatesForFolders failed for", f, e);
            }
        }
        return result;
    }

    async function installOneDependency(folder, depName, builds) {
        const modulePath = getModulePath(folder);
        const depsRoot = path.join(modulePath, "deps");
        fs.mkdirSync(depsRoot, { recursive: true });

        const key = builds.universal ? "universal" : sysArch;
        const spec = builds[key];
        if (!spec) throw new Error(`No update spec for "${depName}" matching arch "${sysArch}"`);

        const depDir = path.join(depsRoot, depName);
        fs.mkdirSync(depDir, { recursive: true });

        // Optional unzipper (same approach as installModuleDependencies)
        let unzipper = null;
        try {
            unzipper = require("unzipper");
        } catch {
            unzipper = null;
        }

        // Download
        const res = await fetch(spec.link);
        if (!res.ok) throw new Error(`Failed to download ${depName} from ${spec.link}: ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const fileName = path.basename(new URL(spec.link).pathname);
        const archivePath = path.join(depDir, fileName);
        fs.writeFileSync(archivePath, buf);

        if (spec.unzip) {
            if (!unzipper) throw new Error('Dependency update requested unzip, but "unzipper" is not installed.');
            await new Promise((resolve, reject) => {
                fs.createReadStream(archivePath)
                    .pipe(unzipper.Extract({ path: depDir }))
                    .on("close", resolve)
                    .on("error", reject);
            });
            fs.rmSync(archivePath, { force: true });
        }
    }

    async function updateDependencies(folder) {
        const updates = await getDependencyUpdates(folder);
        if (!updates || Object.keys(updates).length === 0) return;

        const modulePath = getModulePath(folder);
        const depsRoot = path.join(modulePath, "deps");
        fs.mkdirSync(depsRoot, { recursive: true });

        for (const [depName, builds] of Object.entries(updates)) {
            try {
                // Remove existing dep first
                removeDependencyLocal(folder, depName);
                // Install new files
                await installOneDependency(folder, depName, builds);
            } catch (e) {
                console.warn(`Failed to update dependency "${depName}" for ${folder}:`, e);
            }
        }

        // The customer is always wrong. - Apple
        try {
            exec(`xattr -cr "${depsRoot}"`, () => {});
        } catch {}
        try {
            exec(`chmod -R 700 "${depsRoot}"`, () => {});
        } catch {}
    }

    function removeDependency(folder, depName) {
        removeDependencyLocal(folder, depName);
    }

    async function installDependency(folder, depName, builds) {
        await installOneDependency(folder, depName, builds);
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
        downloadDirectory,
        installModuleDependencies,
        installModule,
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

        // dependency updates
        getDependencyUpdates,
        hasDependencyUpdates,
        checkDependencyUpdatesForFolders,
        updateDependencies,
        removeDependency,
        installDependency,
    };
})();
