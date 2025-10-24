// module.js
(function () {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const { exec } = require("child_process");

    const DEFAULT_REPO = { owner: "m5kro", repo: "Xenolauncher", branch: "main" };

    function getApiBase(r = DEFAULT_REPO) {
        return `https://api.github.com/repos/${r.owner}/${r.repo}/contents`;
    }
    function getRawBase(r = DEFAULT_REPO) {
        return `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${r.branch}`;
    }

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
        } catch (e) {
            return {
                folder: folderName,
                name: folderName,
                version: "N/A",
                author: "N/A",
                description: "Failed to load manifest",
                raw: null,
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

    function normalizeVer(v) {
        return String(v || "")
            .trim()
            .replace(/^v/i, "");
    }
    function compareVersions(a, b) {
        const pa = normalizeVer(a)
            .split(/[.-]/)
            .map((t) => (isNaN(t) ? t : parseInt(t, 10)));
        const pb = normalizeVer(b)
            .split(/[.-]/)
            .map((t) => (isNaN(t) ? t : parseInt(t, 10)));
        const len = Math.max(pa.length, pb.length);
        for (let i = 0; i < len; i++) {
            const xa = pa[i] ?? 0,
                xb = pb[i] ?? 0;
            const na = typeof xa === "number",
                nb = typeof xb === "number";
            if (na && nb) {
                if (xa > xb) return 1;
                if (xa < xb) return -1;
            } else if (!na && !nb) {
                if (xa > xb) return 1;
                if (xa < xb) return -1;
            } else return na ? 1 : -1; // numbers rank above strings
        }
        return 0;
    }
    function hasUpdate(localVersion, remoteVersion) {
        if (!localVersion || localVersion === "N/A") return false;
        if (!remoteVersion || remoteVersion === "N/A") return false;
        return compareVersions(remoteVersion, localVersion) > 0;
    }

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

        const archMap = { x64: "x86_64", arm64: "arm64" };
        const sysArch = archMap[os.arch()] || os.arch();

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
        // Why make it so hard apple?
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

    // ---------- Autodetect ----------
    function normalizeExt(ext) {
        if (!ext) return "";
        return String(ext).replace(/^\.+/, "").toLowerCase();
    }
    function getPathExtLower(p) {
        if (!p) return "";
        let pp = String(p)
            .trim()
            .replace(/[\\/]+$/, "");
        const base = path.basename(pp);
        const idx = base.lastIndexOf(".");
        return idx >= 0 ? base.slice(idx + 1).toLowerCase() : "";
    }
    function isAppBundlePath(p) {
        return normalizeExt(getPathExtLower(p)) === "app";
    }
    function gameDirForFiles(exe) {
        return isAppBundlePath(exe) ? String(exe).replace(/[\\/]+$/, "") : path.dirname(exe);
    }

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

            const extListRaw = Array.isArray(ad.extensions) ? ad.extensions : ad.extension ? [ad.extension] : [];
            const extList = extListRaw.map(normalizeExt).filter(Boolean);
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

    async function fetchModulesForAutodetect(repo = DEFAULT_REPO, installedSet = getInstalledModuleFolders()) {
        const manifests = await fetchRemoteManifestsList(repo);
        const map = {};
        for (const m of manifests) {
            if (!m.raw || !m.raw.autodetect) continue;
            if (installedSet.has(m.folder)) continue;
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

    // --------------- Launching ------------------
    function launchWithEngine(game, { openSubwindow } = {}) {
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

    window.Module = {
        DEFAULT_REPO,
        getModulesDir,
        getInstalledModuleFolders,
        readLocalManifests,
        fetchRemoteManifest,
        fetchRemoteManifestsList,
        compareVersions,
        hasUpdate,
        downloadDirectory,
        installModuleDependencies,
        installModule,
        uninstallModule,
        // autodetect
        normalizeExt,
        getPathExtLower,
        isAppBundlePath,
        gameDirForFiles,
        detectEngineForPath,
        fetchModulesForAutodetect,
        detectEngineFromAutodetectMap,
        // launching
        launchWithEngine,
    };
})();
