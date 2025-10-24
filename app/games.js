// games.js
(function () {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");

    function getGamesPath() {
        const base = path.join(os.homedir(), "Library", "Application Support", "Xenolauncher");
        return path.join(base, "games.json");
    }

    function loadGames() {
        const p = getGamesPath();
        try {
            if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
        } catch (e) {
            console.warn("Failed to read games.json", e);
        }
        return {};
    }

    function saveGames(obj) {
        const p = getGamesPath();
        try {
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
        } catch (e) {
            console.error("Failed to write games.json", e);
            throw e;
        }
    }

    function deleteGame(gameId) {
        const p = getGamesPath();
        if (!fs.existsSync(p)) return;

        const data = loadGames();
        delete data[gameId];

        // Reindex numerically from 1
        const updated = {};
        let newId = 1;
        Object.keys(data)
            .sort((a, b) => Number(a) - Number(b))
            .forEach((id) => {
                updated[newId] = data[id];
                newId++;
            });

        saveGames(updated);
        return updated;
    }

    function watchGamesFile(onChange) {
        const p = getGamesPath();
        if (!fs.existsSync(p)) {
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, "{}", "utf8");
        }
        const watcher = fs.watch(p, (eventType) => {
            if (eventType === "change" && typeof onChange === "function") {
                try {
                    onChange(loadGames());
                } catch (e) {
                    console.error("watchGamesFile callback failed", e);
                }
            }
        });
        return watcher;
    }

    window.Games = {
        getGamesPath,
        loadGames,
        saveGames,
        deleteGame,
        watchGamesFile,
    };
})();
