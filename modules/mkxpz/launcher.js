// Launches RPG VX Ace, VX, and XP games using MKXP-Z
const launch = (gamePath, gameFolder, gameArgs = {}) => {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const { exec } = require("child_process");

    const mkxpzJsonPath = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "xenolauncher",
        "modules",
        "mkxpz",
        "deps",
        "mkxpz",
        "Z-Universal.app",
        "Contents",
        "Game",
        "mkxp.json"
    );

    // ---- small helpers ----
    const ensureDir = (p) => {
        try {
            fs.mkdirSync(path.dirname(p), { recursive: true });
        } catch (_) {}
    };

    const expandTilde = (p) => (typeof p === "string" && p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);

    const coerceScalar = (v) => {
        if (typeof v !== "string") return v;
        const lower = v.toLowerCase().trim();
        if (lower === "true") return true;
        if (lower === "false") return false;
        if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
        return expandTilde(v);
    };

    const coerceValue = (v) => {
        if (Array.isArray(v)) return v.map(coerceScalar);
        if (v && typeof v === "object") {
            // shallow coerce for simple objects
            const out = {};
            for (const [k, val] of Object.entries(v)) out[k] = coerceValue(val);
            return out;
        }
        return coerceScalar(v);
    };

    // ---- Helper: map RGSS version number to [rtpName, rgssNum] ----
    const mapRtpFromNumber = (n) => {
        if (n === 1) return ["Standard", 1]; // RPG Maker XP
        if (n === 2) return ["RPGVX", 2]; // RPG Maker VX
        if (n === 3) return ["RPGVXace", 3]; // RPG Maker VX Ace
        return null;
    };

    // ---- Helper: scan folder for RGSS*.dll and infer RTP ----
    const detectFromDllsIn = (folderPath, whereLabel) => {
        try {
            const files = fs.readdirSync(folderPath);
            for (const file of files) {
                if (file.startsWith("RGSS") && file.toLowerCase().endsWith(".dll")) {
                    const m = file.match(/(\d+)/);
                    if (m) {
                        console.info(`RGSS DLL file found ${whereLabel ? `in ${whereLabel}` : ""}.`);
                        const digit = String(m[1])[0];
                        const num = parseInt(digit, 10);
                        const mapped = mapRtpFromNumber(num);
                        if (mapped) return mapped;
                        console.warn(`Unknown RTP value found in ${whereLabel || "folder"}: ${digit}`);
                    }
                }
            }
        } catch (e) {
            if (e && e.code === "ENOENT") {
                console.warn(`${whereLabel || "Folder"} not found: ${e.message}`);
            } else {
                console.error(`Error scanning ${whereLabel || "folder"}: ${e?.message || e}`);
            }
        }
        return null;
    };

    // ---- Detect RTP/RGSS version ----
    const getRtpValue = (folderPath) => {
        const gameIniPath = path.join(folderPath, "Game.ini");

        // 1) Try Game.ini -> rtp=
        try {
            const data = fs.readFileSync(gameIniPath, "utf-8");
            const lines = data.split(/\r?\n/);

            for (const rawLine of lines) {
                const line = rawLine.trim();
                const m = line.match(/^\s*rtp\s*=\s*(.*)/i);
                if (m) {
                    console.info("RTP value found.");
                    const val = m[1].trim().toLowerCase();
                    if (val === "standard") return ["Standard", 1];
                    if (val === "rpgvx") return ["RPGVX", 2];
                    if (val === "rpgvxace") return ["RPGVXace", 3];
                    console.warn(`Unknown RTP value found in Game.ini: ${m[1]}`);
                    break;
                }
            }

            // 2) Try Game.ini -> library=... -> RGSS(\d+)
            for (const rawLine of lines) {
                const line = rawLine.trim();
                const m = line.match(/^\s*library\s*=\s*(.*)/i);
                if (m) {
                    console.info("Library value found.");
                    const libVal = m[1];
                    const n = libVal.match(/RGSS(\d+)/i);
                    if (n) {
                        const digit = String(n[1])[0];
                        const num = parseInt(digit, 10);
                        const mapped = mapRtpFromNumber(num);
                        if (mapped) return mapped;
                        console.warn(`Unknown RTP value found in Game.ini: ${digit}`);
                    }
                    break;
                }
            }

            console.warn("RTP value not found in Game.ini, looking for dll files.");
        } catch (err) {
            if (err && err.code === "ENOENT") {
                console.error(`Game.ini file not found in the folder: ${folderPath}`);
            } else {
                console.error(`Error reading Game.ini: ${err?.message || err}`);
            }
        }

        // 3) Scan the game folder for RGSS*.dll
        const fromRootDll = detectFromDllsIn(folderPath, "game folder");
        if (fromRootDll) return fromRootDll;

        console.warn("No RGSS DLL files found in the game folder, checking System folder.");

        // 4) Scan System/ for RGSS*.dll
        const systemPath = path.join(folderPath, "System");
        const fromSystemDll = detectFromDllsIn(systemPath, "System folder");
        if (fromSystemDll) return fromSystemDll;

        console.warn("No RGSS DLL files found in the System folder, assuming Standard RTP.");
        // 5) Default
        console.info("Assuming Standard RTP.");
        return ["Standard", 1];
    };

    // ---- decide RGSS & RTP source ----
    const rawRgssVersion = gameArgs?.rgssVersion;
    const rgssVersionNum = rawRgssVersion === undefined ? 0 : parseInt(String(rawRgssVersion), 10);

    let resolvedRtpTuple; // ["RPGVXace", 3] style
    let finalRgssVersion;

    if (rgssVersionNum === 0 || Number.isNaN(rgssVersionNum)) {
        // auto-detect
        resolvedRtpTuple = getRtpValue(gameFolder);
        finalRgssVersion = resolvedRtpTuple[1];
    } else {
        // trust provided rgssVersion, infer RTP name from it
        const mapped = mapRtpFromNumber(rgssVersionNum);
        if (!mapped) {
            // if somehow an invalid number was given
            console.warn(`Unknown rgssVersion "${rawRgssVersion}", falling back to auto-detect.`);
            resolvedRtpTuple = getRtpValue(gameFolder);
            finalRgssVersion = resolvedRtpTuple[1];
        } else {
            resolvedRtpTuple = mapped;
            finalRgssVersion = rgssVersionNum;
        }
    }

    // ---- resolve RTP array ----
    let rtpArray = Array.isArray(gameArgs?.RTP) ? gameArgs.RTP.filter(Boolean) : [];
    rtpArray = rtpArray.map(expandTilde);

    if (rtpArray.length === 0) {
        const defaultRtpPath = path.join(
            os.homedir(),
            "Library",
            "Application Support",
            "xenolauncher",
            "modules",
            "mkxpz",
            "deps",
            "RTP",
            "RTP",
            resolvedRtpTuple[0]
        );
        rtpArray = [defaultRtpPath];
    }

    // ---- collect remaining gameArgs ----
    const passthrough = {};
    for (const [k, v] of Object.entries(gameArgs || {})) {
        if (k === "rgssVersion" || k === "RTP") continue; // handled above
        passthrough[k] = coerceValue(v);
    }

    // ---- assemble mkxp.json ----
    const mkxpzJson = {
        gameFolder,
        RTP: rtpArray,
        rgssVersion: finalRgssVersion,
        ...passthrough,
    };

    ensureDir(mkxpzJsonPath);
    fs.writeFileSync(mkxpzJsonPath, JSON.stringify(mkxpzJson, null, 4));

    // ---- launch MKXP-Z ----
    const mkxpzPath = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "xenolauncher",
        "modules",
        "mkxpz",
        "deps",
        "mkxpz",
        "Z-Universal.app",
        "Contents",
        "MacOS",
        "Z-Universal"
    );

    exec(`"${mkxpzPath}"`, (err, stdout, stderr) => {
        if (err) {
            console.error(err);
            return;
        }
        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);
    });
};
exports.launch = launch;