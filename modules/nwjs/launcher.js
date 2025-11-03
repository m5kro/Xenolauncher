// Launches the game using NW.js
// Unfortunately, the NW.js instance being used by Xenolauncher doesn't work due to session conflicts :(
// Requires at least one NW.js version to be installed + permission fixes that are applied during the installation process
const launch = (gamePath, gameFolder, gameArgs) => {
    const path = require("path");
    const { exec } = require("child_process");
    const fs = require("fs");
    const os = require("os");

    // Cheat Menu helpers
    function copyCheatFiles(targetFolder) {
        const pluginsFolder = path.join(targetFolder, "js", "plugins");
        fs.mkdirSync(pluginsFolder, { recursive: true });
        const jsSrc = path.join(
            os.homedir(),
            "Library",
            "Application Support",
            "xenolauncher",
            "modules",
            "nwjs",
            "deps",
            "cheat-js",
            "Cheat_Menu.js"
        );
        const cssSrc = path.join(
            os.homedir(),
            "Library",
            "Application Support",
            "xenolauncher",
            "modules",
            "nwjs",
            "deps",
            "cheat-css",
            "Cheat_Menu.css"
        );
        if (fs.existsSync(jsSrc)) fs.copyFileSync(jsSrc, path.join(pluginsFolder, "Cheat_Menu.js"));
        if (fs.existsSync(cssSrc)) fs.copyFileSync(cssSrc, path.join(pluginsFolder, "Cheat_Menu.css"));
    }

    function removeCheatFiles(targetFolder) {
        const pluginsFolder = path.join(targetFolder, "js", "plugins");
        const jsPath = path.join(pluginsFolder, "Cheat_Menu.js");
        const cssPath = path.join(pluginsFolder, "Cheat_Menu.css");
        if (fs.existsSync(jsPath))
            try {
                fs.unlinkSync(jsPath);
            } catch {}
        if (fs.existsSync(cssPath))
            try {
                fs.unlinkSync(cssPath);
            } catch {}
    }

    function modifyMVMainJs(filePath) {
        if (!fs.existsSync(filePath)) return false;
        let content = fs.readFileSync(filePath, "utf-8");
        if (content.includes("PluginManager.loadScript('Cheat_Menu.js')")) return false;
        const marker = "PluginManager.setup($plugins);";
        const inject = "\nPluginManager._path= 'js/plugins/';\nPluginManager.loadScript('Cheat_Menu.js');\n";
        if (content.includes(marker)) {
            content = content.replace(marker, marker + inject);
        } else {
            // Append at the end, probably won't work
            content += "\n" + inject;
        }
        fs.writeFileSync(filePath, content, "utf-8");
        return true;
    }

    function unmodifyMVMainJs(filePath) {
        const fs = require("fs");
        if (!fs.existsSync(filePath)) return false;

        let content = fs.readFileSync(filePath, "utf-8");
        const before = content;

        const loadRe = new RegExp(
            String.raw`\s*PluginManager\s*\.\s*loadScript\s*\(\s*(['"])[^'"]*Cheat_Menu\.js\1\s*\)\s*;?\s*`,
            "g"
        );
        content = content.replace(loadRe, "\n");

        const pathRe = /\s*PluginManager\s*\.\s*_path\s*=\s*(['"])js\/plugins\/?\1\s*;?\s*/g;
        content = content.replace(pathRe, "\n");

        if (content !== before) {
            fs.writeFileSync(filePath, content, "utf-8");
            return true;
        }
        return false;
    }

    function modifyMZMainJs(filePath) {
        if (!fs.existsSync(filePath)) return false;

        let content;
        try {
            content = fs.readFileSync(filePath, "utf-8");
        } catch (_e) {
            return false;
        }

        const url = "js/plugins/Cheat_Menu.js";
        const re = /const\s+scriptUrls\s*=\s*\[(.*?)\];/s;
        const m = content.match(re);
        if (!m) {
            // scriptUrls array not found
            return false;
        }

        const inner = m[1]; // exact inner content between [ and ], including whitespace/newlines
        if (inner.includes(url)) {
            // already present
            return false;
        }

        const newInner = `    "${url}",\n${inner}`;
        const replacedMatch = m[0].replace(inner, newInner);

        const newContent = content.slice(0, m.index) + replacedMatch + content.slice(m.index + m[0].length);

        try {
            fs.writeFileSync(filePath, newContent, "utf-8");
        } catch (_e) {
            return false;
        }
        return true;
    }

    function unmodifyMZMainJs(filePath) {
        const fs = require("fs");
        if (!fs.existsSync(filePath)) return false;

        let content = fs.readFileSync(filePath, "utf-8");
        const before = content;

        // Find the scriptUrls array and remove any entry that ends with Cheat_Menu.js
        const arrayRe = /const\s+scriptUrls\s*=\s*\[(.*?)\];/s;
        const m = content.match(arrayRe);
        if (!m) return false;

        let inner = m[1];

        inner = inner.replace(/\s*,\s*(['"]).*?Cheat_Menu\.js\1\s*/g, ""); // , '...Cheat_Menu.js'
        inner = inner.replace(/\s*(['"]).*?Cheat_Menu\.js\1\s*,\s*/g, ""); // '...Cheat_Menu.js',
        inner = inner.replace(/\s*(['"]).*?Cheat_Menu\.js\1\s*/g, ""); // only item

        // Clean up stray commas/spaces
        inner = inner
            .replace(/\s*,\s*,/g, ",")
            .replace(/^\s*,\s*/, "")
            .replace(/\s*,\s*$/, "");

        const replaced =
            content.slice(0, m.index) + `const scriptUrls = [${inner}];` + content.slice(m.index + m[0].length);

        if (replaced !== before) {
            fs.writeFileSync(filePath, replaced, "utf-8");
            return true;
        }
        return false;
    }

    function applyCheatMenu(folderPath) {
        const www = path.join(folderPath, "www");
        const isMV = fs.existsSync(www) && fs.lstatSync(www).isDirectory();
        if (isMV) {
            if (modifyMVMainJs(path.join(www, "js", "main.js"))) {
                copyCheatFiles(www);
            } else {
                // Already patched; ensure files are present
                copyCheatFiles(www);
            }
        } else {
            if (modifyMZMainJs(path.join(folderPath, "js", "main.js"))) {
                copyCheatFiles(folderPath);
            } else {
                copyCheatFiles(folderPath);
            }
        }
    }

    function removeCheatMenu(folderPath) {
        const www = path.join(folderPath, "www");
        const isMV = fs.existsSync(www) && fs.lstatSync(www).isDirectory();
        if (isMV) {
            unmodifyMVMainJs(path.join(www, "js", "main.js"));
            removeCheatFiles(www);
        } else {
            unmodifyMZMainJs(path.join(folderPath, "js", "main.js"));
            removeCheatFiles(folderPath);
        }
    }

    // Apply or remove Cheat Menu
    try {
        if (gameArgs && gameArgs.cheat) {
            applyCheatMenu(gameFolder);
        } else {
            removeCheatMenu(gameFolder);
        }
    } catch (e) {
        // none rpgmaker games may fail here, which is fine
        console.error("Cheat Menu patching error:", e);
    }

    nwjsPath = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "xenolauncher",
        "modules",
        "nwjs",
        "deps",
        "version",
        gameArgs.version,
        "nwjs-sdk-" + gameArgs.version + "-osx-" + os.arch(),
        "nwjs.app",
        "Contents",
        "MacOS",
        "nwjs"
    );

    // Check package.json in the game directory for a name if there isn't then give it one
    const packageJsonPath = path.join(gameFolder, "package.json");
    let gameName = "Game";
    if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        if (!packageJson.name.trim()) {
            // If the name is empty, give it a default name and write to the json file
            packageJson.name = gameName;
            fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 4));
        }
    }

    // Launch the game using NW.js
    exec(`"${nwjsPath}" "${gameFolder}"`, (err, stdout, stderr) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log(stdout);
    });
};
exports.launch = launch;
