
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const dotenv = require("dotenv");

// Load desktop/.env from this folder.
dotenv.config({ path: path.join(__dirname, ".env") });

const {
    app,
    BrowserWindow,
    Tray,
    Menu,
    clipboard,
    ipcMain,
    Notification,
    screen,
    shell,
    dialog,
} = require("electron");

const Store = require("electron-store");
const fetch = (...args) =>
    import("node-fetch").then(({ default: f }) => f(...args));
const { io } = require("socket.io-client");
const { supabase, login } = require("./firebase");

const store = new Store();

const API_URL =
    process.env.API_URL ||
    "https://cloudbridge-backend.onrender.com/api";

const SOCKET_URL =
    process.env.SOCKET_URL ||
    "https://cloudbridge-backend.onrender.com";

const PROTOCOL = "cloudbridge";

const MAX_FILE_SIZE = 50 * 1024 * 1024;

let tray = null;
let loginWindow = null;
let dashboardWindow = null;
let sharePopup = null;
let sharePopupMode = null;
let lastClipboardText = "";
let socket = null;
let clipboardTimer = null;
let isQuitting = false;
let pendingOAuthCode = null;

function showError(title, message) {
    dialog.showErrorBox(
        title,
        String(message || "An unexpected error occurred.")
    );
}

function sendToLogin(channel, payload) {
    if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.webContents.send(channel, payload);
    }
}

// ---------- File MIME type ----------

function getMimeType(filePath) {
    const extension = path.extname(filePath).toLowerCase();

    const mimeTypes = {
        ".txt": "text/plain",
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".mp4": "video/mp4",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".zip": "application/zip",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xls": "application/vnd.ms-excel",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".ppt": "application/vnd.ms-powerpoint",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".json": "application/json",
        ".csv": "text/csv",
        ".html": "text/html",
        ".css": "text/css",
        ".js": "text/javascript",
        ".py": "text/x-python",
    };

    return mimeTypes[extension] || "application/octet-stream";
}

// ---------- Login window ----------

function showLoginWindow() {
    if (loginWindow && !loginWindow.isDestroyed()) {
        if (loginWindow.isMinimized()) {
            loginWindow.restore();
        }

        loginWindow.show();
        loginWindow.focus();
        return;
    }

    loginWindow = new BrowserWindow({
        width: 440,
        height: 600,
        minWidth: 440,
        minHeight: 600,
        resizable: false,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: "#211625",
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    loginWindow.once("ready-to-show", () => {
        if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.show();
            loginWindow.focus();
            console.log("CloudBridge login window is visible.");
        }
    });

    loginWindow.webContents.on(
        "did-fail-load",
        (_event, errorCode, errorDescription) => {
            console.error(
                "LOGIN PAGE FAILED:",
                errorCode,
                errorDescription
            );
        }
    );

    loginWindow.webContents.on("render-process-gone", (_event, details) => {
        console.error("LOGIN RENDERER EXITED:", details);
    });

    loginWindow.on("closed", () => {
        console.log("LOGIN WINDOW CLOSED");
        loginWindow = null;
    });

    loginWindow.loadFile(path.join(__dirname, "login.html"))
        .then(() => console.log("LOGIN PAGE LOADED"))
        .catch((error) => {
            console.error("LOGIN PAGE LOAD ERROR:", error);
        });
}

// ---------- Google OAuth callback ----------

function handleOAuthCallback(callbackUrl) {
    if (
        typeof callbackUrl !== "string" ||
        !callbackUrl.startsWith(`${PROTOCOL}://`)
    ) {
        return;
    }

    let parsed;

    try {
        parsed = new URL(callbackUrl);
    } catch (error) {
        console.error("Invalid OAuth callback URL:", error);
        sendToLogin("oauth-error", "The login callback URL is invalid.");
        return;
    }

    const errorDescription =
        parsed.searchParams.get("error_description") ||
        parsed.searchParams.get("error");

    if (errorDescription) {
        console.error("OAuth provider returned an error:", errorDescription);
        sendToLogin("oauth-error", errorDescription);
        return;
    }

    const code = parsed.searchParams.get("code");

    if (!code) {
        console.error("OAuth callback did not contain a code.");
        sendToLogin(
            "oauth-error",
            "No authorization code was returned. Please try Google login again."
        );
        return;
    }

    console.log("CloudBridge: OAuth authorization code received.");

    pendingOAuthCode = code;

    if (!loginWindow || loginWindow.isDestroyed()) {
        showLoginWindow();
    }

    if (!loginWindow || loginWindow.isDestroyed()) {
        console.error("OAuth callback: login window could not be created.");
        return;
    }

    const deliverCode = () => {
        if (!loginWindow || loginWindow.isDestroyed()) {
            console.error("OAuth callback: login window closed before delivery.");
            return;
        }

        if (!pendingOAuthCode) {
            return;
        }

        const codeToSend = pendingOAuthCode;
        pendingOAuthCode = null;

        console.log("CloudBridge: delivering OAuth code to login renderer.");

        loginWindow.webContents.send("oauth-callback", {
            code: codeToSend,
        });

        if (loginWindow.isMinimized()) {
            loginWindow.restore();
        }

        loginWindow.show();
        loginWindow.focus();
    };

    if (loginWindow.webContents.isLoading()) {
        loginWindow.webContents.once("did-finish-load", deliverCode);
    } else {
        deliverCode();
    }
}


function handleProtocolUrl(callbackUrl) {
    if (
        typeof callbackUrl !== "string" ||
        !callbackUrl.startsWith(`${PROTOCOL}://`)
    ) {
        return null;
    }

    let parsed;

    try {
        parsed = new URL(callbackUrl);
    } catch (error) {
        console.error("CloudBridge: Invalid protocol URL:", error);
        return null;
    }

    // Windows Share Target handoff
    if (parsed.hostname.toLowerCase() === "share") {
        const filePath = parsed.searchParams.get("file");

        if (!filePath) {
            console.error("CloudBridge: Share URL has no file path.");
            return "share";
        }

        try {
            const resolvedPath = path.resolve(filePath);

            if (!fs.existsSync(resolvedPath)) {
                throw new Error("The shared file does not exist.");
            }

            const stats = fs.statSync(resolvedPath);

            if (!stats.isFile()) {
                throw new Error("The shared item is not a file.");
            }

            if (stats.size === 0 || stats.size > MAX_FILE_SIZE) {
                throw new Error("The file must be between 1 byte and 50 MB.");
            }

            console.log(
                "CloudBridge: Windows Share Target file received:",
                resolvedPath
            );

            showFileSharePopup(resolvedPath);
        } catch (error) {
            console.error(
                "CloudBridge: Share Target handoff failed:",
                error
            );
        }

        return "share";
    }

    // Preserve existing Google OAuth handling
    handleOAuthCallback(callbackUrl);

    return "auth";
}

// ---------- Detect files opened from Windows File Explorer ----------

function getExternalFilePath(args) {
    for (const arg of args) {
        if (typeof arg !== "string" || !arg) {
            continue;
        }

        if (arg.startsWith(`${PROTOCOL}://`)) {
            continue;
        }

        const resolvedPath = path.resolve(arg);

        if (
            resolvedPath === path.resolve(process.execPath) ||
            resolvedPath === path.resolve(__dirname) ||
            resolvedPath === path.join(__dirname, "main.js")
        ) {
            continue;
        }

        try {
            if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
                return resolvedPath;
            }
        } catch (error) {
            console.error("Could not inspect launch argument:", error);
        }
    }

    return null;
}


// ---------- Single-instance and protocol registration ----------

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
    app.quit();
} else {
    app.on("second-instance", (_event, commandLine) => {
        console.log("CloudBridge: second instance detected");

        const protocolUrl = commandLine.find(
            (arg) =>
                typeof arg === "string" &&
                arg.startsWith(`${PROTOCOL}://`)
        );

        const protocolAction = protocolUrl
            ? handleProtocolUrl(protocolUrl)
            : null;

        const externalFilePath = getExternalFilePath(commandLine);

        if (externalFilePath) {
            console.log(
                "CloudBridge: File Explorer file received:",
                externalFilePath
            );

            showFileSharePopup(externalFilePath);
        }

        // Do not bring the login window over the file-sharing popup.
        if (protocolAction !== "share") {
            if (loginWindow && !loginWindow.isDestroyed()) {
                if (loginWindow.isMinimized()) {
                    loginWindow.restore();
                }

                loginWindow.show();
                loginWindow.focus();
            } else {
                console.log(
                    "CloudBridge: login window is not available"
                );
            }
        }
    });

    app.on("open-url", (event, url) => {
        event.preventDefault();

        console.log("CloudBridge: open-url event received");

        const protocolAction = handleProtocolUrl(url);

        if (
            protocolAction !== "share" &&
            loginWindow &&
            !loginWindow.isDestroyed()
        ) {
            loginWindow.show();
            loginWindow.focus();
        }
    });
}

// ---------- Google login through Supabase ----------

ipcMain.handle("google-login", async () => {
    try {
        if (!API_URL || !SOCKET_URL) {
            throw new Error(
                "API_URL or SOCKET_URL is missing from desktop/.env."
            );
        }

        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
                redirectTo: `${PROTOCOL}://auth/callback`,
                skipBrowserRedirect: true,
            },
        });

        if (error) {
            throw error;
        }

        if (!data || !data.url) {
            throw new Error("Supabase did not return a Google login URL.");
        }

        await shell.openExternal(data.url);

        return { ok: true };
    } catch (error) {
        console.error("Could not start Google login:", error);

        return {
            ok: false,
            error: error.message || "Could not start Google login.",
        };
    }
});

ipcMain.handle("exchange-oauth-code", async (_event, code) => {
    console.log("CloudBridge: exchanging Google OAuth code...");

    try {
        const { data, error } =
            await supabase.auth.exchangeCodeForSession(code);

        if (error) {
            console.error(
                "CloudBridge OAuth exchange failed:",
                error.message
            );

            return { ok: false, error: error.message };
        }

        const token = data.session?.access_token;
        const email = data.session?.user?.email;

        if (!token) {
            console.error("CloudBridge: OAuth returned no access token.");

            return {
                ok: false,
                error: "Google sign-in returned no access token.",
            };
        }

        console.log("CloudBridge: OAuth exchange succeeded.");
        console.log(
            "CloudBridge: signed-in email:",
            email || "(email unavailable)"
        );

        store.set("token", token);
        store.set("email", email || "User");

        console.log("CloudBridge: starting tray app...");

        if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.close();
        }

        startApp();
        showDashboardWindow();

        console.log("CloudBridge: startApp() completed.");

        return { ok: true };
    } catch (error) {
        console.error(
            "CloudBridge OAuth handler crashed:",
            error.stack || error.message
        );

        return {
            ok: false,
            error: error.message || "Google sign-in failed.",
        };
    }
});

// ---------- Email and password login ----------

ipcMain.handle("login", async (_event, { email, password }) => {
    try {
        const token = await login(email, password);

        store.set("token", token);
        store.set("email", email);

        console.log("CloudBridge: email login succeeded.");

        if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.close();
        }

        startApp();
        showDashboardWindow();

        return { ok: true };

    } catch (error) {
        console.error("Email login failed:", error);

        return {
            ok: false,
            error: error.message || "Login failed.",
        };
    }
});

// ---------- Main tray application ----------

function startApp() {
    if (!API_URL || !SOCKET_URL) {
        showError(
            "CloudBridge configuration",
            "API_URL or SOCKET_URL is missing from desktop/.env."
        );

        return;
    }

    if (!socket) {
        connectSocket();
    }

    if (!clipboardTimer) {
        console.log("DEBUG: Starting clipboard watcher...");
        startClipboardWatcher();
    }

    if (!tray) {
        buildTray();
    }
}

function refreshTrayMenu() {
    if (!tray || tray.isDestroyed()) return;

    const pendingItems = Array.from(pendingIncomingShares.values()).map(
        (share) => ({
            label: `${share.senderEmail || "A user"} — ${share.contentType === "file"
                ? share.fileName || "File"
                : share.contentType || "Content"
                }`,
            click: () => showIncomingSharePopup(share),
        })
    );

    const menu = Menu.buildFromTemplate([
        {
            label: `Logged in as ${store.get("email") || "User"}`,
            enabled: false,
        },
        {
            label: "Open Dashboard",
            click: () => showDashboardWindow(),
        },
        { type: "separator" },
        {
            label: `Pending Incoming Shares (${pendingItems.length})`,
            enabled: false,
        },
        ...(pendingItems.length > 0
            ? pendingItems
            : [{ label: "No pending shares", enabled: false }]),
        { type: "separator" },
        {
            label: "Share clipboard",
            click: async () => {
                const clipboardValue = await clipboard.readText();

                const text =
                    typeof clipboardValue === "string" && clipboardValue.trim()
                        ? clipboardValue
                        : lastClipboardText;

                if (typeof text !== "string" || !text.trim()) {
                    showError(
                        "CloudBridge",
                        "No clipboard text detected. Copy text and try again."
                    );
                    return;
                }

                showTextSharePopup(text);
            },
        },
        {
            label: "Share a file",
            click: () => showFileSharePopup(),
        },
        {
            label: "Open sync folder",
            click: () => shell.openPath(getSyncFolder()),
        },
        { type: "separator" },
        {
            label: "Quit",
            click: () => {
                isQuitting = true;
                app.quit();
            },
        },
    ]);

    tray.setContextMenu(menu);
}

function buildTray() {
    const iconPath = path.join(__dirname, "icon.png");

    if (!fs.existsSync(iconPath)) {
        showError("CloudBridge", `Tray icon not found: ${iconPath}`);
        return;
    }

    try {
        tray = new Tray(iconPath);
        tray.setToolTip("CloudBridge — running");
        refreshTrayMenu();
    } catch (error) {
        console.error("Could not create system tray:", error);
        showError("CloudBridge", error.message);
    }
}

// ---------- Clipboard watcher ----------

function startClipboardWatcher() {
    if (clipboardTimer) return;

    clipboardTimer = setInterval(async () => {
        try {
            const text = await clipboard.readText();

            console.log("DEBUG: Clipboard watcher reading:", text);

            if (typeof text !== "string") {
                return;
            }

            if (text.trim().length === 0 || text === lastClipboardText) {
                return;
            }

            lastClipboardText = text;

            console.log("CloudBridge: new clipboard text detected.");

            // Automatically open only the text-sharing popup.
            showTextSharePopup(text);

        } catch (error) {
            console.error("Clipboard read failed:", error.message);
        }
    }, 1500);
}

function classify(text) {
    try {
        new URL(text);
        return "url";
    } catch {
        return "text";
    }
}


// ---------- Text sharing popup ----------

function showTextSharePopup(text) {

    // If the text popup is already open, update its preview.
    if (
        sharePopup &&
        !sharePopup.isDestroyed() &&
        sharePopupMode === "text"
    ) {
        sharePopup.webContents.send("clipboard-content", {
            text,
            type: classify(text),
        });

        sharePopup.show();
        sharePopup.focus();

        return;
    }

    // Close another type of popup if it is open.
    if (sharePopup && !sharePopup.isDestroyed()) {
        sharePopup.close();
    }

    createSharePopup("text", text);
}


// ---------- File sharing popup ----------

function showFileSharePopup(filePath = null) {
    // Store the selected file path, if one was supplied.
    selectedOutgoingFilePath = filePath || null;

    // Close any existing share popup.
    if (sharePopup && !sharePopup.isDestroyed()) {
        sharePopup.close();
    }

    // Open the file-sharing popup.
    return createSharePopup("file");
}

function createSharePopup(mode, text) {
    const display = screen.getPrimaryDisplay();
    const bounds = display.workArea;

    const popupWidth = Math.min(360, bounds.width - 20);
    const popupHeight = Math.min(
        mode === "file" ? 490 : 440,
        bounds.height - 20
    );

    const popupX = bounds.x + bounds.width - popupWidth - 10;
    const popupY = bounds.y + bounds.height - popupHeight - 10;

    const popupWindow = new BrowserWindow({
        width: popupWidth,
        height: popupHeight,
        x: popupX,
        y: popupY,
        minWidth: popupWidth,
        minHeight: popupHeight,
        maxWidth: popupWidth,
        maxHeight: popupHeight,
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });
    sharePopup = popupWindow;
    sharePopupMode = mode;

    popupWindow.on("closed", () => {
        if (sharePopup === popupWindow) {
            sharePopup = null;
            sharePopupMode = null;
        }
    });

    const popupFile = mode === "text"
        ? "text-share-popup.html"
        : "file-share-popup.html";

    popupWindow.loadFile(path.join(__dirname, popupFile))
        .then(() => {
            if (popupWindow.isDestroyed()) return;

            if (mode === "text") {
                popupWindow.webContents.send("clipboard-content", {
                    text,
                    type: classify(text),
                });
            }

            if (mode === "file" && selectedOutgoingFilePath) {
                popupWindow.webContents.send("external-file-selected", {
                    fileName: path.basename(selectedOutgoingFilePath)
                });
            }
        })
        .catch(error => {
            console.error("Share popup failed to load:", error);
        });

    return popupWindow;
}

// ---------- Send text or URL share ----------

ipcMain.handle(
    "send-share",
    async (_event, { text, type, recipientEmail, expiresInHours }) => {
        try {
            const token = store.get("token");

            if (!token) {
                throw new Error("Please log in before sharing.");
            }

            const res = await fetch(`${API_URL}/shares`, {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },

                body: JSON.stringify({
                    recipientEmail,
                    contentType: type,
                    textContent: text,
                    allowDownload: true,
                    expiresInHours,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(
                    data.message ||
                    data.error ||
                    "Could not send share."
                );
            }

            if (sharePopup && !sharePopup.isDestroyed()) {
                sharePopup.close();
            }

            return {
                ok: true,
                data,
            };
        } catch (error) {
            console.error("Send share failed:", error);

            return {
                ok: false,
                error: error.message || "Could not send share.",
            };
        }
    }
);

// ---------- Send file share ----------


// ---------- Select and send file share ----------

// Stores the selected file path until the user clicks Send File.
let selectedOutgoingFilePath = null;


// Step 1: Select a file without uploading it.

ipcMain.handle("select-file", async () => {
    try {
        const result = await dialog.showOpenDialog({
            title: "Select a file to share",
            properties: ["openFile"],
        });

        if (result.canceled || !result.filePaths.length) {
            selectedOutgoingFilePath = null;

            return {
                ok: false,
                cancelled: true,
            };
        }

        const selectedFilePath = result.filePaths[0];
        const fileStats = fs.statSync(selectedFilePath);

        if (!fileStats.isFile()) {
            throw new Error("Please select a valid file.");
        }

        if (fileStats.size === 0) {
            throw new Error("The selected file is empty.");
        }

        if (fileStats.size > MAX_FILE_SIZE) {
            throw new Error("File size exceeds the 50 MB limit.");
        }

        selectedOutgoingFilePath = selectedFilePath;

        const fileName = path.basename(selectedFilePath);

        console.log("CloudBridge: file selected:", fileName);

        return {
            ok: true,
            cancelled: false,
            fileName,
        };

    } catch (error) {
        console.error("File selection failed:", error);

        selectedOutgoingFilePath = null;

        return {
            ok: false,
            error: error.message || "Could not select file.",
        };
    }
});


// Step 2: Upload only after the user clicks Send File.

ipcMain.handle(
    "send-selected-file",
    async (_event, { recipientEmail, expiresInHours }) => {
        try {
            const token = store.get("token");

            if (!token) {
                throw new Error("Please log in before sharing.");
            }

            if (!recipientEmail || !recipientEmail.trim()) {
                throw new Error("Please enter the recipient's email address.");
            }

            if (!selectedOutgoingFilePath) {
                throw new Error("Please choose a file first.");
            }

            const selectedFilePath = selectedOutgoingFilePath;

            if (!fs.existsSync(selectedFilePath)) {
                throw new Error("The selected file no longer exists.");
            }

            const fileStats = fs.statSync(selectedFilePath);

            if (!fileStats.isFile()) {
                throw new Error("Please select a valid file.");
            }

            if (fileStats.size === 0) {
                throw new Error("The selected file is empty.");
            }

            if (fileStats.size > MAX_FILE_SIZE) {
                throw new Error("File size exceeds the 50 MB limit.");
            }

            const fileName = path.basename(selectedFilePath);
            const fileBuffer = fs.readFileSync(selectedFilePath);
            const mimeType = getMimeType(selectedFilePath);

            const query = new URLSearchParams({
                recipientEmail: recipientEmail.trim(),
                fileName,
                expiresInHours: String(expiresInHours || 24),
            });

            console.log("CloudBridge: uploading file:", fileName);

            const res = await fetch(
                `${API_URL}/shares/upload?${query.toString()}`,
                {
                    method: "POST",

                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/octet-stream",
                        "X-File-Content-Type": mimeType,
                    },

                    body: fileBuffer,
                }
            );

            const data = await res.json();

            if (!res.ok) {
                throw new Error(
                    data.message ||
                    data.error ||
                    "File upload failed."
                );
            }

            console.log("CloudBridge: file uploaded successfully.");

            // Clear the selected file after successful upload.
            selectedOutgoingFilePath = null;

            if (sharePopup && !sharePopup.isDestroyed()) {
                sharePopup.close();
            }

            return {
                ok: true,
                fileName,
                data,
            };

        } catch (error) {
            console.error("File sharing failed:", error);

            return {
                ok: false,
                error: error.message || "File sharing failed.",
            };
        }
    }
);

ipcMain.on("dismiss-popup", () => {
    if (sharePopup && !sharePopup.isDestroyed()) {
        sharePopup.close();
    }
});

// ---------- Incoming share popup ----------


// ---------- Incoming share popup ----------

let incomingShareWindows = new Map();
let pendingIncomingShares = new Map();

function showIncomingSharePopup(share) {
    if (!share || !share.id) return;

    // Keep every incoming share available until accepted or declined.
    pendingIncomingShares.set(share.id, share);

    const existing = incomingShareWindows.get(share.id);

    if (existing && !existing.isDestroyed()) {
        existing.show();
        existing.focus();
        return;
    }

    const display = screen.getPrimaryDisplay();
    const { x, y, width, height } = display.workArea;

    const popupWidth = 390;
    const popupHeight = 170;

    const win = new BrowserWindow({
        width: popupWidth,
        height: popupHeight,

        x: Math.max(x, x + width - popupWidth - 20),
        y: Math.max(y, y + height - popupHeight - 20),

        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        hasShadow: true,

        title: "Incoming CloudBridge Share",
        resizable: false,
        movable: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,

        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    incomingShareWindows.set(share.id, win);

    win.on("closed", () => {
        incomingShareWindows.delete(share.id);

        // Do not delete pendingIncomingShares here.
        // Closing the notification must not discard the pending share.
    });

    win.once("ready-to-show", () => {
        if (!win.isDestroyed()) {
            win.show();
            win.focus();
        }
    });

    win.loadFile(path.join(__dirname, "incoming-share.html"))
        .then(() => {
            if (!win.isDestroyed()) {
                win.webContents.send("incoming-share-data", share);
            }
        })
        .catch((error) => {
            console.error("Incoming share popup failed:", error);
        });
}


// Resize between compact and expanded notification states.
ipcMain.on("resize-incoming-share", (event, expanded) => {
    for (const win of incomingShareWindows.values()) {
        if (!win.isDestroyed() && win.webContents === event.sender) {
            const display = screen.getDisplayMatching(win.getBounds());
            const { x, y, width, height } = display.workArea;

            const popupWidth = 390;
            const popupHeight = expanded ? 370 : 170;

            win.setBounds({
                x: Math.max(x, x + width - popupWidth - 20),
                y: Math.max(y, y + height - popupHeight - 20),
                width: popupWidth,
                height: popupHeight,
            });

            break;
        }
    }
});


// Respond to an incoming share.
ipcMain.handle(
    "respond-to-incoming-share",
    async (_event, { shareId, action }) => {
        try {
            if (!["accept", "decline"].includes(action)) {
                throw new Error("Invalid share action.");
            }

            const token = store.get("token");

            if (!token) {
                throw new Error("Please log in before responding to a share.");
            }

            const baseUrl = API_URL.replace(/\/$/, "");

            // Step 1: Accept or decline the share.
            const response = await fetch(
                `${baseUrl}/shares/${encodeURIComponent(shareId)}/${action}`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            const shareData = await response.json();

            if (!response.ok) {
                throw new Error(
                    shareData.message ||
                    shareData.error ||
                    `Could not ${action} share.`
                );
            }

            // Step 2: Download the actual file after accepting.
            if (action === "accept") {
                if (shareData.contentType === "file") {
                    const downloadResponse = await fetch(
                        `${baseUrl}/shares/${encodeURIComponent(shareId)}/download`,
                        {
                            method: "GET",
                            headers: {
                                Authorization: `Bearer ${token}`,
                            },
                        }
                    );

                    const downloadData = await downloadResponse.json();

                    if (!downloadResponse.ok) {
                        throw new Error(
                            downloadData.error ||
                            "Could not obtain the file download link."
                        );
                    }

                    if (
                        typeof downloadData.url !== "string" ||
                        !/^https?:\/\//i.test(downloadData.url)
                    ) {
                        throw new Error(
                            "Backend returned an invalid file download URL."
                        );
                    }

                    await saveToSyncFolder({
                        ...downloadData,
                        id: shareId,
                        contentType: "file",
                    });

                } else {
                    await saveToSyncFolder(shareData);
                }
            }

            console.log(`Share ${action} completed:`, shareId);

            return { ok: true };

        } catch (error) {
            console.error("Incoming share response failed:", error);

            return {
                ok: false,
                error: error.message || "Request failed.",
            };
        }
    }
);


// Close only the notification window.
// Keep the share in pendingIncomingShares.
ipcMain.on("close-incoming-share", (event) => {
    for (const win of incomingShareWindows.values()) {
        if (!win.isDestroyed() && win.webContents === event.sender) {
            win.close();
            break;
        }
    }
});


// Called after Accept or Decline succeeds.
ipcMain.on("complete-incoming-share", (event) => {
    for (const [id, win] of incomingShareWindows.entries()) {
        if (!win.isDestroyed() && win.webContents === event.sender) {
            pendingIncomingShares.delete(id);
            refreshTrayMenu();
            win.close();
            break;
        }
    }
});


// ---------- Real-time incoming shares ----------

function connectSocket() {
    if (!SOCKET_URL || socket) {
        return;
    }

    socket = io(SOCKET_URL);

    socket.on("connect", () => {
        console.log("[CloudBridge] Socket connected:", socket.id);

        const token = store.get("token");

        if (!token) {
            console.error("[CloudBridge] No login token found.");
            return;
        }

        console.log("[CloudBridge] Sending registration request...");
        socket.emit("register", token);
    });

    socket.on("register:success", (data) => {
        console.log(
            "[CloudBridge] Registration successful. User ID:",
            data.userId
        );
    });

    socket.on("register:error", (data) => {
        console.error(
            "[CloudBridge] Registration failed:",
            data.error
        );
    });

    socket.on("share:incoming", (share) => {
        console.log(
            "Incoming share received:",
            share.id,
            share.contentType
        );

        showIncomingSharePopup(share);
        refreshTrayMenu();

        const notification = new Notification({
            title: "CloudBridge",
            body: `${share.senderEmail || "A user"} wants to share ${share.fileName || share.contentType || "content"
                } with you`,
        });

        notification.show();
    });

    socket.on("connect_error", (error) => {
        console.error("Socket connection failed:", error.message);
    });

    socket.on("disconnect", (reason) => {
        console.log("Socket disconnected:", reason);
    });
}

// ---------- Accept share flow ----------

async function acceptShareFlow(shareId) {
    try {
        const token = store.get("token");

        if (!token) {
            throw new Error("Please log in before accepting a share.");
        }

        const res = await fetch(`${API_URL}/shares/${shareId}/accept`, {
            method: "POST",

            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        const share = await res.json();

        if (!res.ok) {
            throw new Error(
                share.message ||
                share.error ||
                "Could not accept the share."
            );
        }

        await saveToSyncFolder(share);
    } catch (error) {
        showError("CloudBridge", error.message);
    }
}

// ---------- Local sync folder ----------

function getSyncFolder() {
    const folder = path.join(
        app.getPath("documents"),
        "CloudBridge"
    );

    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
    }

    return folder;
}



async function saveToSyncFolder(share) {
    const folder = getSyncFolder();

    // Save without ever overwriting an existing file.
    function writeWithoutOverwrite(fileName, data, options = {}) {
        const safeName = path.basename(fileName);
        const parsed = path.parse(safeName);

        let counter = 0;

        while (true) {
            const candidateName = counter === 0
                ? parsed.base
                : `${parsed.name} (${counter})${parsed.ext}`;

            const candidatePath = path.join(folder, candidateName);

            try {
                fs.writeFileSync(candidatePath, data, {
                    ...options,
                    flag: "wx",
                });

                return candidateName;

            } catch (error) {
                if (error.code !== "EEXIST") {
                    throw error;
                }

                counter++;
            }
        }
    }

    let savedName;

    if (share.contentType === "file") {
        const downloadUrl = share.url || share.fileUrl;

        if (
            typeof downloadUrl !== "string" ||
            !/^https?:\/\//i.test(downloadUrl)
        ) {
            throw new Error("Invalid file download URL.");
        }

        const res = await fetch(downloadUrl);

        if (!res.ok) {
            throw new Error(
                `Could not download the shared file (HTTP ${res.status}).`
            );
        }

        const buffer = Buffer.from(await res.arrayBuffer());

        const fileName = share.fileName || `file_${share.id}`;

        savedName = writeWithoutOverwrite(fileName, buffer);

    } else {
        savedName = writeWithoutOverwrite(
            `${share.id}.txt`,
            share.textContent || "",
            { encoding: "utf8" }
        );
    }

    new Notification({
        title: "CloudBridge",
        body: `Saved as ${savedName} in your CloudBridge folder.`,
    }).show();

    console.log("CloudBridge: file saved successfully:", savedName);
}


// ---------- Application startup ----------

app.whenReady().then(() => {
    if (!gotLock) {
        return;
    }

    if (process.defaultApp && process.argv[1]) {
        app.setAsDefaultProtocolClient(
            PROTOCOL,
            process.execPath,
            [path.resolve(process.argv[1])]
        );
    } else {
        app.setAsDefaultProtocolClient(PROTOCOL);
    }

    const protocolUrl = process.argv.find(
        (arg) =>
            typeof arg === "string" &&
            arg.startsWith(`${PROTOCOL}://`)
    );

    const externalFilePath = getExternalFilePath(process.argv);

    // Share activation should not open the login window.
    if (protocolUrl) {
        console.log(
            "CloudBridge startup: share protocol detected"
        );

        setTimeout(() => {
            handleProtocolUrl(protocolUrl);
        }, 1500);

    } else if (externalFilePath) {
        console.log(
            "CloudBridge startup: external file detected:",
            externalFilePath
        );

        setTimeout(() => {
            showFileSharePopup(externalFilePath);
        }, 1500);

    } else {
        // Normal application launch.
        console.log(
            "CloudBridge startup: opening login window"
        );

        showLoginWindow();
    }
});

// ---------- Main dashboard window ----------

function showDashboardWindow() {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        if (dashboardWindow.isMinimized()) {
            dashboardWindow.restore();
        }

        dashboardWindow.show();
        dashboardWindow.focus();
        return;
    }

    dashboardWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1000,
        minHeight: 680,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: "#17101C",
        title: "CloudBridge",
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    dashboardWindow.once("ready-to-show", () => {
        if (dashboardWindow && !dashboardWindow.isDestroyed()) {
            dashboardWindow.show();
            dashboardWindow.focus();
        }
    });

    dashboardWindow.on("close", (event) => {
        if (!isQuitting) {
            event.preventDefault();
            dashboardWindow.hide();
        }
    });

    dashboardWindow.on("closed", () => {
        dashboardWindow = null;
    });

    dashboardWindow.loadFile(
        path.join(__dirname, "dashboard.html")
    ).catch((error) => {
        console.error("Dashboard failed to load:", error);
        showError("CloudBridge Dashboard", error.message);
    });
}

// ---------- Dashboard IPC integration ----------

ipcMain.handle("dashboard:get-account-info", async () => {
    return {
        email: store.get("email") || "User",
    };
});
// ---------- Dashboard: fetch live transfer history ----------

ipcMain.handle("dashboard:get-shares", async () => {
    try {
        const token = store.get("token");

        if (!token) {
            throw new Error("Please log in again.");
        }

        const response = await fetch(
            `${API_URL.replace(/\/$/, "")}/shares`,
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "Could not load transfer history."
            );
        }

        return {
            ok: true,
            sent: data.sent || [],
            received: data.received || [],
        };

    } catch (error) {
        console.error(
            "Dashboard share history failed:",
            error
        );

        return {
            ok: false,
            error: error.message || "Could not load transfer history.",
            sent: [],
            received: [],
        };
    }
});

ipcMain.handle("dashboard:action", async (_event, action) => {
    try {
        switch (action) {
            case "clipboard": {
                const text = await clipboard.readText();

                console.log("CLIPBOARD BUTTON CLICKED");
                console.log("Clipboard value:", text);
                console.log("Clipboard type:", typeof text);

                if (typeof text !== "string" || !text.trim()) {
                    throw new Error(
                        "Your clipboard is empty or does not contain text."
                    );
                }

                showTextSharePopup(text);

                console.log("Text sharing popup requested.");

                return { ok: true };
            }

            case "url": {
                const text = await clipboard.readText();

                if (typeof text !== "string" || !text.trim()) {
                    throw new Error("Copy a URL first, then try again.");
                }

                showTextSharePopup(text);
                return { ok: true };
            }

            case "select-file":
                showFileSharePopup();
                return { ok: true };

            case "open-sync": {
                const result = await shell.openPath(getSyncFolder());

                if (result) {
                    throw new Error(result);
                }

                return { ok: true };
            }

            default:
                return {
                    ok: false,
                    error: "This dashboard action is not connected yet.",
                };
        }
    } catch (error) {
        console.error("Dashboard action failed:", error);

        return {
            ok: false,
            error: error.message || "Could not complete the action.",
        };
    }
});

ipcMain.handle("dashboard:window", async (_event, action) => {
    if (!dashboardWindow || dashboardWindow.isDestroyed()) {
        return { ok: false };
    }

    if (action === "minimize") {
        dashboardWindow.minimize();
    } else if (action === "maximize") {
        if (dashboardWindow.isMaximized()) {
            dashboardWindow.unmaximize();
        } else {
            dashboardWindow.maximize();
        }
    } else if (action === "hide") {
        dashboardWindow.hide();
    }

    return { ok: true };
});

// ---------- Application lifecycle ----------

app.on("before-quit", () => {
    isQuitting = true;

    if (clipboardTimer) {
        clearInterval(clipboardTimer);
        clipboardTimer = null;
    }

    if (socket) {
        socket.disconnect();
        socket = null;
    }
});

// Keep CloudBridge running in the system tray
// when all application windows are closed.
app.on("window-all-closed", (event) => {
    if (!isQuitting) {
        event.preventDefault();
    }
});

