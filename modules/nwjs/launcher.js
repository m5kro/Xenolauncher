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
        if (!fs.existsSync(filePath)) return false;
        const linesToRemove = ["PluginManager._path= 'js/plugins/';", "PluginManager.loadScript('Cheat_Menu.js');"];
        let content = fs.readFileSync(filePath, "utf-8");
        const before = content;
        for (const line of linesToRemove) {
            // remove with or without trailing newline/spacing
            const re = new RegExp("\\n?\\s*" + line.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&") + "\\s*\\n?", "g");
            content = content.replace(re, "\\n");
        }
        if (content !== before) {
            fs.writeFileSync(filePath, content, "utf-8");
            return true;
        }
        return false;
    }

    function modifyMZMainJs(filePath) {
        if (!fs.existsSync(filePath)) return false;
        let content = fs.readFileSync(filePath, "utf-8");
        const url = "js/plugins/Cheat_Menu.js";
        const re = /const\\s+scriptUrls\\s*=\\s*\\[(.*?)\\];/s;
        const m = content.match(re);
        if (!m) return false;
        if (m[1].includes(url)) return false;
        let inner = m[1].trim();
        if (inner.length > 0 && !inner.endsWith(",")) inner += ", ";
        inner += `'${url}'`;
        const replaced =
            content.slice(0, m.index) + `const scriptUrls = [${inner}];` + content.slice(m.index + m[0].length);
        fs.writeFileSync(filePath, replaced, "utf-8");
        return true;
    }

    function unmodifyMZMainJs(filePath) {
        if (!fs.existsSync(filePath)) return false;
        let content = fs.readFileSync(filePath, "utf-8");
        const url = "js/plugins/Cheat_Menu.js";
        const re = /const\\s+scriptUrls\\s*=\\s*\\[(.*?)\\];/s;
        const m = content.match(re);
        if (!m) return false;
        // remove url and any trailing commas/spaces properly
        let items = m[1];
        // remove occurrences like 'url', or , 'url' or 'url',
        const itemsNew = items
            .replace(new RegExp("\\n?\\s*'" + url.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&") + "'\\s*,?\\n?", "g"), "")
            .replace(/,\\s*,/g, ",") // fix double commas
            .replace(/^\\s*,\\s*/, "") // leading comma
            .replace(/\\s*,\\s*$/, ""); // trailing comma
        const replaced =
            content.slice(0, m.index) + `const scriptUrls = [${itemsNew}];` + content.slice(m.index + m[0].length);
        if (items !== itemsNew) {
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
