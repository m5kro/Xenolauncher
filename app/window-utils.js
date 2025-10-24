// window-utils.js
(function () {
    function openSubwindow(url, gameId = null, onClosed = null) {
        document.body.style.pointerEvents = "none";
        const fullUrl = gameId ? `${url}?gameId=${gameId}` : url;

        nw.Window.open(fullUrl, { title: "Subwindow", resizable: true }, (newWin) => {
            newWin.on("loaded", () => {
                // Allow child to instruct the opener to update theme
                newWin.window.setMainWindow = (themeSettings) => {
                    try {
                        if (window.GlobalSettings) {
                            window.GlobalSettings.applyTheme(!!themeSettings.darkTheme);
                        } else {
                            document.documentElement.setAttribute(
                                "data-theme",
                                themeSettings.darkTheme ? "dark" : "light"
                            );
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
