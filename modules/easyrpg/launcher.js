// Launches RPG Maker 2000/2003 games using EasyRPG Player.
const launch = (gamePath, gameFolder, gameArgs) => {
    const path = require("path");
    const { exec } = require("child_process");
    const fs = require("fs");
    const os = require("os");

    // Resolve the EasyRPG Player executable inside the module deps
    const playerExec = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "xenolauncher",
        "modules",
        "easyrpg",
        "deps",
        "player",
        "EasyRPG Player.app",
        "Contents",
        "MacOS",
        "EasyRPG Player"
    );

    const toFlag = (key) => {
        // soundfontPath -> --soundfont-path
        const kebab = key
            .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
            .replace(/_/g, "-")
            .toLowerCase();
        return `--${kebab}`;
    };

    // Build CLI args from gameArgs.
    // Rule: boolean true => include the flag; numbers/strings => include flag + value (if non-empty / non-zero).
    // Also avoid contradictory pairs: --vsync vs --no-vsync, --stretch vs --no-stretch, etc.
    const contradictoryPairs = [
        ["vsync", "noVsync"],
        ["showFps", "noShowFps"],
        ["stretch", "noStretch"],
        ["fpsLimit", "noFpsLimit"],
        ["pauseFocusLost", "noPauseFocusLost"]
    ];

    // Clone to avoid mutating caller object
    const argsCopy = { ...(gameArgs || {}) };

    // If both of a contradictory pair are true, prefer the explicit "noXxx"
    for (const [pos, neg] of contradictoryPairs) {
        if (argsCopy[pos] === true && argsCopy[neg] === true) {
            argsCopy[pos] = false; // let the "no" variant win
        }
    }

    const args = [];
    for (const [key, val] of Object.entries(argsCopy)) {
        if (val === null || val === undefined) continue;
        if (typeof val === "boolean") {
            if (val) args.push(toFlag(key));
        } else if (typeof val === "number") {
            if (val !== 0) {
                args.push(toFlag(key));
                args.push(String(val));
            }
        } else if (typeof val === "string") {
            const trimmed = val.trim();
            if (trimmed.length > 0) {
                args.push(toFlag(key));
                args.push(trimmed);
            }
        } else if (Array.isArray(val)) {
            // For array-valued args, repeat the flag for each entry
            for (const entry of val) {
                if (entry !== null && entry !== undefined && String(entry).trim().length > 0) {
                    args.push(toFlag(key));
                    args.push(String(entry));
                }
            }
        }
    }

    // Default the soundfont path to the module dependency if user didn't set it
    const defaultSf2 = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "xenolauncher",
        "modules",
        "easyrpg",
        "deps",
        "soundfont",
        "GMGSx.SF2"
    );
    const hasSf2 = fs.existsSync(defaultSf2);
    if (hasSf2) {
        // Only inject if neither soundfont nor soundfontPath were provided
        const providedKeys = Object.keys(argsCopy).map(k => k.toLowerCase());
        const providedSoundfont = providedKeys.includes("soundfont") || providedKeys.includes("soundfontpath");
        if (!providedSoundfont) {
            args.push("--soundfont-path");
            args.push(defaultSf2);
        }
    }

    args.push("--window");
    args.push("--project-path");

    // The last argument should be the project directory (game folder)
    args.push(gameFolder);

    // Quote the executable for spaces
    const command = `"${playerExec}" ${args.map(a => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`;
    console.log("Launching EasyRPG:", command);

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`EasyRPG launch error: ${error.message}`);
            return;
        }
        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);
    });
};

exports.launch = launch;