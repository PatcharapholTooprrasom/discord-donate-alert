/*
 * DonationAlert Overlay Companion — main process.
 *
 * Creates a transparent, always-on-top, click-through overlay window on a chosen
 * monitor, plus a small control window to pick the monitor and test. Receives
 * alerts from the Vencord plugin over a localhost HTTP server.
 */

const { app, BrowserWindow, screen, ipcMain } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");

let config = { monitorIndex: 0, port: 2387, clickThrough: true };
let overlayWin = null;
let configWin = null;
let server = null;

// --- config persistence ----------------------------------------------------

function loadConfig() {
    try {
        config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) };
    } catch {
        /* first run / no file */
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (e) {
        console.error("saveConfig failed", e);
    }
}

// --- windows ----------------------------------------------------------------

function displayFor(idx) {
    const displays = screen.getAllDisplays();
    return displays[idx] || displays[0];
}

function createOverlay() {
    const d = displayFor(config.monitorIndex);
    overlayWin = new BrowserWindow({
        x: d.bounds.x,
        y: d.bounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
        transparent: true,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        skipTaskbar: true,
        focusable: false,
        hasShadow: false,
        fullscreenable: false,
        alwaysOnTop: true,
        backgroundColor: "#00000000",
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    overlayWin.setIgnoreMouseEvents(config.clickThrough, { forward: true });
    overlayWin.setAlwaysOnTop(true, "screen-saver");
    overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlayWin.loadFile(path.join(__dirname, "overlay.html"));
}

function moveOverlayToMonitor(idx) {
    config.monitorIndex = idx;
    saveConfig();
    const d = displayFor(idx);
    if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.setBounds({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height });
    }
}

function createConfigWindow() {
    configWin = new BrowserWindow({
        width: 480,
        height: 560,
        title: "Donation Alert Overlay",
        autoHideMenuBar: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    configWin.setMenuBarVisibility(false);
    configWin.loadFile(path.join(__dirname, "config.html"));
}

function sendAlertToOverlay(data) {
    if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.webContents.send("alert", data);
    }
}

// --- local HTTP server ------------------------------------------------------

function startServer() {
    server = http.createServer((req, res) => {
        if (req.method === "POST" && req.url === "/alert") {
            let body = "";
            req.on("data", chunk => {
                body += chunk;
                if (body.length > 1e6) req.destroy();
            });
            req.on("end", () => {
                try {
                    sendAlertToOverlay(JSON.parse(body || "{}"));
                } catch (e) {
                    console.error("bad alert payload", e);
                }
                res.writeHead(200, { "Access-Control-Allow-Origin": "*" });
                res.end("ok");
            });
        } else if (req.url === "/health") {
            res.writeHead(200);
            res.end("ok");
        } else {
            res.writeHead(404);
            res.end();
        }
    });

    server.on("error", e => {
        console.error("HTTP server error", e);
        if (configWin && !configWin.isDestroyed()) {
            configWin.webContents.send("server-error", String(e && e.message || e));
        }
    });

    server.listen(config.port, "127.0.0.1");
}

function restartServer() {
    if (server) {
        try { server.close(); } catch { /* ignore */ }
    }
    startServer();
}

// --- IPC from the control window --------------------------------------------

ipcMain.handle("get-state", () => {
    const primary = screen.getPrimaryDisplay();
    const displays = screen.getAllDisplays().map((d, i) => ({
        index: i,
        label: `Monitor ${i + 1} — ${d.bounds.width}×${d.bounds.height}` + (d.id === primary.id ? " (primary)" : ""),
        bounds: d.bounds
    }));
    return { displays, config };
});

ipcMain.on("set-monitor", (_e, idx) => moveOverlayToMonitor(Number(idx)));

ipcMain.on("set-clickthrough", (_e, v) => {
    config.clickThrough = !!v;
    saveConfig();
    if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.setIgnoreMouseEvents(config.clickThrough, { forward: true });
    }
});

ipcMain.on("set-port", (_e, port) => {
    config.port = Number(port) || 2387;
    saveConfig();
    restartServer();
});

ipcMain.on("test-alert", () => {
    sendAlertToOverlay({
        name: "Test User",
        displayText: "This is a test overlay alert! 🎉 Thanks for trying it.",
        avatarUrl: "https://cdn.discordapp.com/embed/avatars/0.png",
        durationMs: 6000
    });
});

ipcMain.on("quit-app", () => app.quit());

// --- lifecycle --------------------------------------------------------------

app.whenReady().then(() => {
    loadConfig();
    createOverlay();
    createConfigWindow();
    startServer();

    // Keep the overlay aligned if the display layout changes.
    screen.on("display-metrics-changed", () => moveOverlayToMonitor(config.monitorIndex));
    screen.on("display-added", () => moveOverlayToMonitor(config.monitorIndex));
    screen.on("display-removed", () => moveOverlayToMonitor(config.monitorIndex));
});

// Closing the small control window should NOT kill the overlay — only the Quit
// button (or closing everything) ends the app.
app.on("window-all-closed", () => app.quit());
