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

    async function extractArchive(archivePath, destDir) {
        fs.mkdirSync(destDir, { recursive: true });

        if (isZipPath(archivePath)) {
            let unzipper;
            try {
                unzipper = require("unzipper");
            } catch {
                throw new Error('Archive extraction requested ZIP, but "unzipper" is not installed. Did you follow the build instructions?');
            }

            await new Promise((resolve, reject) => {
                fs.createReadStream(archivePath)
                    .pipe(unzipper.Extract({ path: destDir }))
                    .on("close", resolve)
                    .on("error", reject);
            });
            return;
        }

        if (isTarGzPath(archivePath) || isTarXzPath(archivePath) || isTarPath(archivePath)) {
            let tar;
            try {
                tar = require("tar");
            } catch {
                throw new Error('Archive extraction requested TAR, but "tar" is not installed. Did you follow the build instructions?');
            }

            if (isTarGzPath(archivePath) || isTarPath(archivePath)) {
                const gzip = isTarGzPath(archivePath);

                await tar.x({
                    file: archivePath,
                    cwd: destDir,
                    gzip,
                    preserveOwner: false,
                    // prevent path traversal / absolute paths
                    filter: (p /*, entry */) => safeArchiveEntryPath(p),
                });
                return;
            }

            if (isTarXzPath(archivePath)) {
                let lzma;
                try {
                    lzma = require("lzma-native");
                } catch {
                    throw new Error('Archive extraction requested TAR.XZ, but "lzma-native" is not installed. Did you follow the build instructions?');
                }
                const { pipeline } = require("node:stream/promises");
                await pipeline(
                    fs.createReadStream(archivePath),
                    lzma.createDecompressor(),
                    tar.x({ cwd: destDir, preserveOwner: false, filter: (p) => safeArchiveEntryPath(p) })
                );
                return;
            }
        }
        throw new Error(`Unsupported archive type: ${path.basename(archivePath)}`);
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
                await extractArchive(archivePath, depDir);
                fs.rmSync(archivePath, { force: true });
            }
        }

        // permissions
        exec(`chown -R "${os.userInfo().uid}" "${depsRoot}"`, () => {});
        exec(`xattr -cr "${depsRoot}"`, () => {});
        exec(`chmod -R 700 "${depsRoot}"`, () => {});
    }

    async function installModule(folder, repo = DEFAULT_REPO) {
        const remoteRoot = `modules/${folder}`;
        const localRoot = path.join(getModulesDir(), folder);
        await downloadDirectory(remoteRoot, localRoot, repo);
        if (fs.existsSync(localRoot)) {
            // 1) Initial dependency install
            await installModuleDependencies(localRoot);

            // 2) Immediately trigger dependency updates, if supported
            try {
                await updateDependencies(folder);
            } catch (e) {
                console.warn(`Dependency update check failed for "${folder}" (continuing):`, e);
            }
        }
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

        // Download
        const res = await fetch(spec.link);
        if (!res.ok) throw new Error(`Failed to download ${depName} from ${spec.link}: ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const fileName = path.basename(new URL(spec.link).pathname);
        const archivePath = path.join(depDir, fileName);
        fs.writeFileSync(archivePath, buf);

        if (spec.unzip) {
            await extractArchive(archivePath, depDir);
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
            exec(`chown -R "${os.userInfo().uid}" "${depsRoot}"`, () => {});
        } catch {}
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
    async function updateModulePreservingMultiversions(folder) {
        const appSupport = GlobalSettings.getAppSupportDir(); // used throughout your pages to locate modules :contentReference[oaicite:5]{index=5}
        const modRoot = path.join(appSupport, "modules", folder);
        const depsRoot = path.join(modRoot, "deps");
        const manifestPath = path.join(modRoot, "manifest.json");

        // 1) Discover which multi-version roots to keep (from CURRENT/OLD manifest)
        const oldManifest = safeReadJson(manifestPath) || {};
        const oldMultiKeys = extractMultiVersionKeys(oldManifest); // e.g., ["version"] for NW.js
        const toPreserve = [];
        for (const key of oldMultiKeys) {
            const p = path.join(depsRoot, key); // e.g., deps/version
            if (fs.existsSync(p)) toPreserve.push({ key, abs: p });
        }

        // Create a temp stash outside the module dir
        const stashRoot = path.join(appSupport, ".xeno-preserve", `${folder}-${Date.now()}`, "deps");
        ensureDir(stashRoot);

        // 2) Stash the preserved dirs (rename or copy)
        for (const item of toPreserve) {
            const dest = path.join(stashRoot, item.key);
            moveDirOrCopy(item.abs, dest);
        }

        // 3) Do the update with your existing primitives
        //    (we deliberately reuse uninstall+install, because install expects a clean root today) :contentReference[oaicite:6]{index=6}
        try {
            Module.uninstallModule(folder);
        } catch (e) {
            console.warn("uninstallModule failed (continuing):", e);
        }
        await Module.installModule(folder);

        // 4) Check multi-version keys AFTER the update (new manifest)
        const newManifest = safeReadJson(manifestPath) || {};
        const newMultiKeys = new Set(extractMultiVersionKeys(newManifest)); // if key removed, we won't restore it

        // 5) Restore preserved dirs whose multi-version variable still exists in the updated manifest
        ensureDir(depsRoot);
        for (const { key } of toPreserve) {
            const stash = path.join(stashRoot, key);
            if (!fs.existsSync(stash)) continue;

            if (newMultiKeys.has(key)) {
                const dest = path.join(depsRoot, key);
                ensureDir(dest);

                // Merge version subfolders back without overwriting any freshly created ones
                if (fs.existsSync(stash)) {
                    for (const name of fs.readdirSync(stash)) {
                        const from = path.join(stash, name); // e.g., deps/<key>/<version>
                        const to = path.join(dest, name);
                        if (!fs.existsSync(to)) {
                            moveDirOrCopy(from, to);
                        }
                    }
                }
            }
            // Whether restored or not, clear the stash for this key
            fs.rmSync(stash, { recursive: true, force: true });
        }

        // 6) Remove any deps/<key> that no longer has a multi-version variable in the new manifest
        for (const { key } of toPreserve) {
            if (!newMultiKeys.has(key)) {
                const orphan = path.join(depsRoot, key);
                try {
                    fs.rmSync(orphan, { recursive: true, force: true });
                } catch {}
            }
        }

        // 7) Cleanup + best-effort permission fixes (mirrors Version Manager’s post‑install) :contentReference[oaicite:7]{index=7}
        try {
            fs.rmSync(path.join(appSupport, ".xeno-preserve"), { recursive: true, force: true });
        } catch {}
        await fixQuarantineAndPerms(depsRoot);
    }

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

        // multi-version preserving update
        updateModulePreservingMultiversions,

        // game args updater
        mergeGameArgsWithSchema,
        reconcileAndPersistGameArgs,
    };
})();
