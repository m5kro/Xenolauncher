// window-utils.js
(function () {
    function openSubwindow(url, gameId = null, onClosed = null) {
        document.body.style.pointerEvents = "none";
        const fullUrl = gameId ? `${url}?gameId=${gameId}` : url;

        nw.Window.open(fullUrl, { title: "Subwindow", resizable: true }, (newWin) => {
            newWin.on("loaded", () => {
                // Allow child to instruct the opener to update theme
                newWin.window.setMainWindow = (settings) => {
                    try {
                        // 1) Apply theme immediately (existing behavior)
                        if (window.GlobalSettings) {
                            window.GlobalSettings.applyTheme(!!settings.darkTheme);
                        } else {
                            document.documentElement.setAttribute("data-theme", settings.darkTheme ? "dark" : "light");
                        }

                        // 2) Notify the main window that global settings changed
                        if (typeof window.onSettingsUpdated === "function") {
                            window.onSettingsUpdated(settings);
                        }
                    } catch (e) {
                        console.warn("setMainWindow failed", e);
                    }
                };
            });
            newWin.on("closed", () => {
                document.body.style.pointerEvents = "auto";
                if (typeof onClosed === "function") {
                    try {
                        onClosed();
                    } catch (e) {
                        console.error("Error in onClosed callback:", e);
                    }
                }
            });
        });
    }

    window.openSubwindow = openSubwindow;
})();
