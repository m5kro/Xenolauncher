// window-utils.js
(function () {
    // Keep track of singleton subwindows so we don't open duplicates.
    const singletonWindows = new Map();
    let activeDialog = null;

    function getSingletonKey(url) {
        if (!url) return null;
        const base = String(url).split("#")[0].split("?")[0];
        if (base.endsWith("module-manager.html")) return "module-manager";
        if (base.endsWith("global-settings.html")) return "global-settings";
        return null;
    }

    function isWindowAlive(win) {
        try {
            // nw.js Window object has .window; browser Window has .closed
            return !!(win && win.window && win.window.closed === false);
        } catch (e) {
            return false;
        }
    }

    function focusWindow(win) {
        try {
            win.show();
        } catch (_) {}
        try {
            win.restore();
        } catch (_) {}
        try {
            win.focus();
        } catch (_) {}
    }

    function openSubwindow(url, gameId = null, onClosed = null, width = null, height = null) {
        const fullUrl = gameId ? `${url}?gameId=${gameId}` : url;

        // If this subwindow should be single-instance, focus existing instead of opening another.
        const singletonKey = getSingletonKey(fullUrl);
        if (singletonKey) {
            const existing = singletonWindows.get(singletonKey);
            if (isWindowAlive(existing)) {
                focusWindow(existing);

                // If caller asked for a different query (e.g. showInstalled=1), navigate existing.
                try {
                    if (
                        existing.window &&
                        existing.window.location &&
                        !existing.window.location.href.endsWith(fullUrl)
                    ) {
                        existing.window.location.href = fullUrl;
                    }
                } catch (e) {
                    // ignore navigation failures; focusing is still better than duplicating
                }
                return;
            }
        }

        document.body.style.pointerEvents = "none";

        nw.Window.open(fullUrl, { title: "Subwindow", resizable: true, width: width, height: height }, (newWin) => {
            // Register singleton window (if applicable)
            if (singletonKey) {
                singletonWindows.set(singletonKey, newWin);
            }

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
                // Clear singleton entry if this window was the one registered
                if (singletonKey && singletonWindows.get(singletonKey) === newWin) {
                    singletonWindows.delete(singletonKey);
                }

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

    function closeActiveDialog() {
        if (!activeDialog) return;
        const { overlay, onKeyDown } = activeDialog;
        try {
            window.removeEventListener("keydown", onKeyDown);
        } catch (_) {}
        try {
            overlay.remove();
        } catch (_) {}
        activeDialog = null;
    }

    function showDialog(message, opts = {}) {
        return new Promise((resolve) => {
            if (typeof document === "undefined" || !document.body) {
                resolve(false);
                return;
            }

            const mode = opts.mode === "confirm" ? "confirm" : "alert";
            const title = opts.title || (mode === "confirm" ? "Confirm" : "Notice");
            const confirmText = opts.confirmText || (mode === "confirm" ? "Yes" : "OK");
            const cancelText = opts.cancelText || "No";

            closeActiveDialog();

            const overlay = document.createElement("div");
            overlay.className = "app-dialog-overlay";

            const dialog = document.createElement("div");
            dialog.className = "app-dialog";
            dialog.setAttribute("role", mode === "confirm" ? "alertdialog" : "dialog");
            dialog.setAttribute("aria-modal", "true");

            const heading = document.createElement("h3");
            heading.className = "app-dialog-title";
            heading.textContent = title;

            const body = document.createElement("p");
            body.className = "app-dialog-message";
            body.textContent = String(message || "");

            const actions = document.createElement("div");
            actions.className = "app-dialog-actions";

            const confirmBtn = document.createElement("button");
            confirmBtn.className = "primary-button";
            confirmBtn.textContent = confirmText;

            const finish = (value) => {
                closeActiveDialog();
                resolve(value);
            };

            if (mode === "confirm") {
                const cancelBtn = document.createElement("button");
                cancelBtn.className = "secondary-button";
                cancelBtn.textContent = cancelText;
                cancelBtn.addEventListener("click", () => finish(false));
                actions.appendChild(cancelBtn);
            }

            confirmBtn.addEventListener("click", () => finish(true));
            actions.appendChild(confirmBtn);

            const onKeyDown = (e) => {
                if (e.key === "Escape") {
                    finish(mode === "confirm" ? false : true);
                    return;
                }
                if (e.key === "Enter") {
                    finish(true);
                }
            };

            if (mode === "confirm") {
                overlay.addEventListener("click", (e) => {
                    if (e.target === overlay) finish(false);
                });
            }

            dialog.appendChild(heading);
            dialog.appendChild(body);
            dialog.appendChild(actions);
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            activeDialog = { overlay, onKeyDown };
            window.addEventListener("keydown", onKeyDown);
            confirmBtn.focus();
        });
    }

    const AppDialog = {
        alert(message, title = "Notice") {
            return showDialog(message, { mode: "alert", title, confirmText: "OK" });
        },
        confirm(message, title = "Confirm") {
            return showDialog(message, { mode: "confirm", title, confirmText: "Yes", cancelText: "No" });
        },
    };

    window.openSubwindow = openSubwindow;
    window.AppDialog = AppDialog;
})();
