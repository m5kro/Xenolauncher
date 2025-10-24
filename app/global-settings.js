// global-settings.js
(function () {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");

    const APP_DIR = path.join(os.homedir(), "Library", "Application Support", "Xenolauncher");

    function ensureDir(p) {
        try {
            fs.mkdirSync(p, { recursive: true });
        } catch (_) {}
    }

    function getAppSupportDir() {
        return APP_DIR;
    }
    function getSettingsPath() {
        return path.join(APP_DIR, "global-settings.json");
    }

    function prefersDark() {
        try {
            return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
        } catch {
            return false;
        }
    }

    function readJson(p, fallback) {
        try {
            if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
        } catch (e) {
            console.warn("readJson failed", p, e);
        }
        return fallback;
    }

    function writeJson(p, obj) {
        ensureDir(path.dirname(p));
        fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
    }

    function loadGlobalSettings() {
        const file = getSettingsPath();
        const defaults = {
            darkTheme: prefersDark(),
            deletionConfirmation: true,
            checkUpdatesOnStartup: true,
            checkModuleUpdatesOnStartup: true,
            nonInstalledAutodetect: true,
            currentVersion: "0.0.0",
        };
        const data = readJson(file, {});
        return Object.assign({}, defaults, data);
    }

    function saveGlobalSettings(next) {
        const file = getSettingsPath();
        const settings = Object.assign({}, loadGlobalSettings(), next || {});
        writeJson(file, settings);
        return settings;
    }

    function applyTheme(isDark) {
        document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
    }

    // First-run helper
    function ensureFirstSetup(openSubwindow) {
        const file = getSettingsPath();
        if (!fs.existsSync(file)) {
            alert("Welcome to Xenolauncher! Please configure your global settings and install some game engines!");
            if (typeof openSubwindow === "function") openSubwindow("global-settings.html");
            return true;
        }
        return false;
    }

    // Update notice + persist version
    function checkAndHandleUpdate(currentVersion, openSubwindow) {
        const file = getSettingsPath();
        if (!fs.existsSync(file)) return; // handled by first setup
        const settings = loadGlobalSettings();

        if (settings.currentVersion !== currentVersion) {
            alert(
                `Xenolauncher has been updated to version ${currentVersion}! Check out the new features and improvements!`
            );
            if (typeof openSubwindow === "function") openSubwindow("global-settings.html");
        }
        const merged = Object.assign({}, settings, { currentVersion });
        writeJson(file, merged);
    }

    window.GlobalSettings = {
        getAppSupportDir,
        getSettingsPath,
        loadGlobalSettings,
        saveGlobalSettings,
        applyTheme,
        ensureFirstSetup,
        checkAndHandleUpdate,
    };
})();
