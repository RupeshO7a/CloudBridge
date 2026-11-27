
const { ipcRenderer } = require("electron");

const pageTitles = {
    overview: "Overview",
    send: "Send Files",
    received: "Received",
    activity: "Activity",
    devices: "Devices",
    contacts: "Contacts",
    settings: "Settings",
    account: "Account & Identity"
};

let transferData = {
    sent: [],
    received: []
};

let isLoadingShares = false;

// --------------------------------------------------
// TOAST NOTIFICATIONS
// --------------------------------------------------

function showToast(message) {
    const toast = document.getElementById("toast");

    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(showToast.timer);

    showToast.timer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2800);
}

// --------------------------------------------------
// NAVIGATION
// --------------------------------------------------

function navigate(page) {
    if (!pageTitles[page]) return;

    document.querySelectorAll(".page").forEach(el => {
        el.classList.remove("active-page");
    });

    document.getElementById(`page-${page}`)?.classList.add("active-page");

    document.querySelectorAll(".nav-item").forEach(el => {
        el.classList.toggle("active", el.dataset.page === page);
    });

    document.title = `CloudBridge — ${pageTitles[page]}`;

    const pageWrap = document.querySelector(".page-wrap");

    if (pageWrap) {
        pageWrap.scrollTop = 0;
    }

    if (page === "received" || page === "activity" || page === "overview") {
        loadShareHistory();
    }
}

document.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", () => navigate(button.dataset.page));
});

document.querySelectorAll("[data-go]").forEach(button => {
    button.addEventListener("click", () => navigate(button.dataset.go));
});

// --------------------------------------------------
// DASHBOARD FILE SHARING + DATA ACTIONS
// --------------------------------------------------

let dashboardSelectedFile = null;

const fileDisplay = document.getElementById("dashboard-file-display");
const fileBadge = document.getElementById("dashboard-file-badge");
const fileStatus = document.getElementById("dashboard-file-status");
const sendFileButton = document.getElementById("dashboard-send-file");

function updateDashboardFile(fileName) {
    dashboardSelectedFile = fileName;

    if (fileDisplay) {
        fileDisplay.textContent = `▧  ${fileName}`;
    }

    if (fileBadge) {
        fileBadge.textContent = "1 file selected";
    }

    if (sendFileButton) {
        sendFileButton.disabled = false;
    }

    if (fileStatus) {
        fileStatus.textContent = "File ready to send.";
    }
}

async function selectDashboardFile() {
    try {
        if (fileStatus) {
            fileStatus.textContent = "Opening file picker...";
        }

        const result = await ipcRenderer.invoke("select-file");

        if (!result || result.cancelled) {
            if (fileStatus) {
                fileStatus.textContent = "File selection cancelled.";
            }
            return;
        }

        if (!result.ok) {
            throw new Error(result.error || "File selection failed.");
        }

        updateDashboardFile(result.fileName);

        showToast("File selected successfully.");

    } catch (error) {
        console.error("Dashboard file selection failed:", error);

        if (fileStatus) {
            fileStatus.textContent = error.message;
        }

        showToast(error.message || "Could not select file.");
    }
}

// Browse files buttons
document.querySelectorAll('[data-action="select-file"]').forEach(button => {
    button.addEventListener("click", selectDashboardFile);
});

// Upload selected file
sendFileButton?.addEventListener("click", async () => {
    const recipientEmail = document
        .getElementById("recipient-email")
        ?.value.trim();

    const expiresInHours = Number(
        document.getElementById("expiry-select")?.value || 24
    );

    if (!dashboardSelectedFile) {
        showToast("Please select a file first.");
        return;
    }

    if (!recipientEmail) {
        showToast("Please enter the recipient's email.");
        return;
    }

    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail);

    if (!emailValid) {
        showToast("Please enter a valid email address.");
        return;
    }

    try {
        sendFileButton.disabled = true;
        sendFileButton.textContent = "Uploading...";

        if (fileStatus) {
            fileStatus.textContent = "Uploading your file...";
        }

        const result = await ipcRenderer.invoke("send-selected-file", {
            recipientEmail,
            expiresInHours
        });

        if (!result || !result.ok) {
            throw new Error(result?.error || "File upload failed.");
        }

        dashboardSelectedFile = null;

        if (fileDisplay) {
            fileDisplay.textContent = "Your selected file will appear here.";
        }

        if (fileBadge) {
            fileBadge.textContent = "No files selected";
        }

        if (fileStatus) {
            fileStatus.textContent = "File sent successfully!";
        }

        document.getElementById("recipient-email").value = "";

        sendFileButton.disabled = true;
        sendFileButton.textContent = "Send file";

        showToast(`Successfully sent ${result.fileName}!`);

        await loadShareHistory();

    } catch (error) {
        console.error("Dashboard file upload failed:", error);

        if (fileStatus) {
            fileStatus.textContent = error.message;
        }

        showToast(error.message || "File upload failed.");

        sendFileButton.disabled = false;

    } finally {
        if (sendFileButton) {
            sendFileButton.textContent = "Send file";

            if (dashboardSelectedFile) {
                sendFileButton.disabled = false;
            }
        }
    }
});

// Other dashboard actions
document.querySelectorAll("[data-action]").forEach(button => {
    if (button.dataset.action === "select-file") return;

    button.addEventListener("click", async () => {
        const action = button.dataset.action;

        if (action === "refresh") {
            await loadShareHistory();
            showToast("Transfer history refreshed.");
            return;
        }

        if (action === "account-refresh") {
            await loadAccountInfo();
            showToast("Account information refreshed.");
            return;
        }

        try {
            const result = await ipcRenderer.invoke(
                "dashboard:action",
                action
            );

            if (result?.ok) {
                showToast(
                    action === "open-sync"
                        ? "Opening CloudBridge folder."
                        : "Action completed."
                );
            } else {
                showToast(
                    result?.error || "This feature is not connected yet."
                );
            }
        } catch (error) {
            showToast(error.message || "Action could not be completed.");
        }
    });
});
// --------------------------------------------------
// SEND TABS
// --------------------------------------------------

document.querySelectorAll("[data-send-tab]").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll("[data-send-tab]").forEach(el => {
            el.classList.remove("selected");
        });

        tab.classList.add("selected");

        showToast(`${tab.dataset.sendTab} view selected.`);
    });
});

// --------------------------------------------------
// SEARCH
// --------------------------------------------------

document.getElementById("global-search")?.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        event.target.value = "";
    }

    if (event.key === "Enter" && event.target.value.trim()) {
        showToast("Search integration is pending.");
    }
});

document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.getElementById("global-search")?.focus();
    }
});

// --------------------------------------------------
// WINDOW CONTROLS
// --------------------------------------------------

document.getElementById("minimize-window")?.addEventListener("click", () => {
    ipcRenderer.invoke("dashboard:window", "minimize");
});

document.getElementById("maximize-window")?.addEventListener("click", () => {
    ipcRenderer.invoke("dashboard:window", "maximize");
});

document.getElementById("close-window")?.addEventListener("click", () => {
    ipcRenderer.invoke("dashboard:window", "hide");
});

// --------------------------------------------------
// NOTIFICATIONS AND PROFILE
// --------------------------------------------------

document.getElementById("notifications")?.addEventListener("click", () => {
    navigate("received");
});

document.getElementById("profile-menu")?.addEventListener("click", () => {
    navigate("account");
});

// --------------------------------------------------
// ACCOUNT INFORMATION
// --------------------------------------------------

async function loadAccountInfo() {
    try {
        const info = await ipcRenderer.invoke("dashboard:get-account-info");

        if (!info) return;

        const email = info.email || "Signed-in account";
        const name = email.includes("@")
            ? email.split("@")[0]
            : email;

        const profileName = document.getElementById("profile-name");
        const profileEmail = document.getElementById("profile-email");
        const accountName = document.getElementById("account-name");
        const accountEmail = document.getElementById("account-email");
        const detailEmail = document.getElementById("detail-email");

        if (profileName) profileName.textContent = name;
        if (profileEmail) profileEmail.textContent = email;
        if (accountName) accountName.textContent = name;
        if (accountEmail) accountEmail.textContent = email;
        if (detailEmail) detailEmail.textContent = email;

        const initials = name
            .split(/[ ._-]/)
            .filter(Boolean)
            .slice(0, 2)
            .map(s => s[0].toUpperCase())
            .join("") || "CB";

        const profileAvatar = document.getElementById("profile-avatar");
        const accountAvatar = document.getElementById("account-avatar");

        if (profileAvatar) profileAvatar.textContent = initials;
        if (accountAvatar) accountAvatar.textContent = initials;

    } catch (error) {
        console.error("Could not load account information:", error);
    }
}

// --------------------------------------------------
// TRANSFER FORMATTING
// --------------------------------------------------

function formatDate(dateValue) {
    if (!dateValue) return "Date unavailable";

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return "Date unavailable";
    }

    return date.toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short"
    });
}

function formatFileSize(bytes) {
    if (bytes === null || bytes === undefined) {
        return "Size unavailable";
    }

    const size = Number(bytes);

    if (!Number.isFinite(size) || size < 0) {
        return "Size unavailable";
    }

    if (size < 1024) {
        return `${size} B`;
    }

    if (size < 1024 * 1024) {
        return `${(size / 1024).toFixed(1)} KB`;
    }

    if (size < 1024 * 1024 * 1024) {
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }

    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getTransferTitle(share) {
    if (share.fileName) return share.fileName;

    switch (share.contentType) {
        case "text":
            return "Text message";
        case "url":
            return "Shared URL";
        case "file":
            return "Shared file";
        default:
            return "CloudBridge transfer";
    }
}

function getStatusLabel(status) {
    const normalized = String(status || "unknown").toLowerCase();

    const labels = {
        pending: "Pending",
        accepted: "Accepted",
        declined: "Declined",
        expired: "Expired",
        revoked: "Revoked"
    };

    return labels[normalized] || normalized;
}

function getPerson(share, direction) {
    if (direction === "sent") {
        return share.recipient?.email || "Unknown recipient";
    }

    return share.sender?.email || "Unknown sender";
}

// --------------------------------------------------
// SAFE TRANSFER ELEMENT CREATION
// --------------------------------------------------

function createElement(tag, className, text) {
    const element = document.createElement(tag);

    if (className) {
        element.className = className;
    }

    if (text !== undefined && text !== null) {
        element.textContent = String(text);
    }

    return element;
}

function createTransferCard(share, direction) {
    const card = createElement("article", "transfer-row");

    const icon = createElement(
        "div",
        "transfer-icon",
        share.contentType === "file" ? "▧" :
            share.contentType === "url" ? "↗" : "▤"
    );

    const details = createElement("div", "transfer-details");

    const title = createElement(
        "strong",
        "transfer-title",
        getTransferTitle(share)
    );

    const person = createElement(
        "span",
        "transfer-person",
        `${direction === "sent" ? "To" : "From"}: ${getPerson(share, direction)}`
    );

    const date = createElement(
        "span",
        "transfer-date",
        formatDate(share.createdAt)
    );

    details.append(title, person, date);

    if (share.contentType === "file" && share.fileSize !== null && share.fileSize !== undefined) {
        details.append(
            createElement(
                "span",
                "transfer-size",
                formatFileSize(share.fileSize)
            )
        );
    }

    const status = createElement(
        "span",
        `transfer-status status-${String(share.status || "unknown").toLowerCase()}`,
        getStatusLabel(share.status)
    );

    card.append(icon, details, status);

    return card;
}

// --------------------------------------------------
// EMPTY AND ERROR STATES
// --------------------------------------------------

function renderEmptyState(container, title, description) {
    if (!container) return;

    container.replaceChildren();

    const empty = createElement("div", "empty-state");

    const icon = createElement(
        "div",
        "empty-illustration large",
        "◷"
    );

    const heading = createElement("strong", "", title);
    const paragraph = createElement("p", "", description);

    empty.append(icon, heading, paragraph);
    container.appendChild(empty);
}

function renderErrorState(container, message) {
    if (!container) return;

    container.replaceChildren();

    const empty = createElement("div", "empty-state");

    empty.append(
        createElement("div", "empty-illustration large", "!"),
        createElement("strong", "", "Unable to load transfers"),
        createElement("p", "", message)
    );

    container.appendChild(empty);
}

// --------------------------------------------------
// RECEIVED TRANSFERS
// --------------------------------------------------

function renderReceivedTransfers(received) {
    const pendingContainer = document.getElementById(
        "received-pending-list"
    );

    const historyContainer = document.getElementById(
        "received-history-list"
    );

    if (!pendingContainer || !historyContainer) return;

    const pending = received.filter(
        share => String(share.status).toLowerCase() === "pending"
    );

    const history = received.filter(
        share => String(share.status).toLowerCase() !== "pending"
    );

    pendingContainer.replaceChildren();
    historyContainer.replaceChildren();

    if (pending.length === 0) {
        renderEmptyState(
            pendingContainer,
            "No incoming transfers",
            "You currently have no transfers waiting for approval."
        );
    } else {
        pending.forEach(share => {
            pendingContainer.appendChild(
                createTransferCard(share, "received")
            );
        });
    }

    if (history.length === 0) {
        renderEmptyState(
            historyContainer,
            "No received history yet",
            "Accepted, declined, expired and revoked transfers will appear here."
        );
    } else {
        history.forEach(share => {
            historyContainer.appendChild(
                createTransferCard(share, "received")
            );
        });
    }

    const pendingCount = document.getElementById("pending-count");

    if (pendingCount) {
        pendingCount.textContent = pending.length;
    }
}

// --------------------------------------------------
// ACTIVITY TIMELINE
// --------------------------------------------------

function renderActivity(sent, received) {
    const container = document.getElementById("activity-list");

    if (!container) return;

    const activities = [
        ...sent.map(share => ({
            ...share,
            direction: "sent"
        })),
        ...received.map(share => ({
            ...share,
            direction: "received"
        }))
    ];

    activities.sort((a, b) => {
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    container.replaceChildren();

    if (activities.length === 0) {
        renderEmptyState(
            container,
            "Your activity timeline is empty",
            "Your sent and received transfers will appear here."
        );
        return;
    }

    activities.forEach(share => {
        container.appendChild(
            createTransferCard(share, share.direction)
        );
    });
}

// --------------------------------------------------
// ACTIVITY STATISTICS
// --------------------------------------------------

function updateActivityStats(sent, received) {
    const allTransfers = [...sent, ...received];

    const today = new Date();

    const todayCount = allTransfers.filter(share => {
        if (!share.createdAt) return false;

        const date = new Date(share.createdAt);

        return (
            !Number.isNaN(date.getTime()) &&
            date.getFullYear() === today.getFullYear() &&
            date.getMonth() === today.getMonth() &&
            date.getDate() === today.getDate()
        );
    }).length;

    const totalBytes = allTransfers.reduce((total, share) => {
        const size = Number(share.fileSize);

        return total + (
            Number.isFinite(size) && size > 0 ? size : 0
        );
    }, 0);

    const successfulCount = allTransfers.filter(
        share => String(share.status).toLowerCase() === "accepted"
    ).length;

    const pendingCount = allTransfers.filter(
        share => String(share.status).toLowerCase() === "pending"
    ).length;

    const values = [
        todayCount,
        formatFileSize(totalBytes),
        successfulCount,
        pendingCount
    ];

    document.querySelectorAll(
        ".activity-stats .stat-card .stat-value"
    ).forEach((element, index) => {
        if (values[index] !== undefined) {
            element.textContent = values[index];
        }
    });
}

// --------------------------------------------------
// OVERVIEW DASHBOARD
// --------------------------------------------------

function renderOverview(sent, received) {
    const now = Date.now();

    // Count only pending transfers that have not expired.
    const isActivePending = share => {
        if (String(share.status || "").toLowerCase() !== "pending") {
            return false;
        }

        // If expiresAt is missing, retain the pending status.
        if (!share.expiresAt) return true;

        const expiryTime = new Date(share.expiresAt).getTime();

        return Number.isFinite(expiryTime) && expiryTime > now;
    };

    const pendingSent = sent.filter(isActivePending);
    const pendingReceived = received.filter(isActivePending);

    const totalPending = pendingSent.length + pendingReceived.length;

    const setValue = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    };

    setValue("overview-total-sent", sent.length);
    setValue("overview-total-received", received.length);
    setValue("overview-pending", totalPending);

    // Device count is not available from the current backend API.
    setValue("overview-devices", "N/A");

    setValue(
        "overview-data-status",
        "Transfer data updated successfully"
    );

    renderOverviewRecentActivity(sent, received);

    // Only show active incoming transfers.
    renderOverviewIncoming(pendingReceived);
}

function renderOverviewRecentActivity(sent, received) {
    const container = document.getElementById("overview-recent-activity");
    if (!container) return;

    const activities = [
        ...sent.map(share => ({ ...share, direction: "sent" })),
        ...received.map(share => ({ ...share, direction: "received" }))
    ];

    activities.sort((a, b) =>
        new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );

    container.replaceChildren();

    if (!activities.length) {
        container.appendChild(
            createElement("div", "overview-empty", "No transfers yet.")
        );
        return;
    }

    activities.slice(0, 4).forEach(share => {
        container.appendChild(createOverviewRow(share));
    });
}

function renderOverviewIncoming(pending) {
    const container = document.getElementById("overview-incoming-list");
    if (!container) return;

    container.replaceChildren();

    if (!pending.length) {
        container.appendChild(
            createElement(
                "div",
                "overview-empty",
                "No incoming transfers waiting for approval."
            )
        );
        return;
    }

    pending.slice(0, 3).forEach(share => {
        container.appendChild(createOverviewRow(share));
    });
}

function createOverviewRow(share) {
    const row = createElement("div", "overview-transfer-row");

    const iconText = share.contentType === "file"
        ? "▧"
        : share.contentType === "url" ? "↗" : "▤";

    const icon = createElement("div", "overview-transfer-icon", iconText);

    const details = createElement("div", "overview-transfer-details");

    const title = createElement(
        "strong",
        "overview-transfer-title",
        getTransferTitle(share)
    );

    const person = createElement(
        "span",
        "overview-transfer-person",
        `${share.sender?.email || "Unknown sender"}`
    );

    const date = createElement(
        "span",
        "overview-transfer-date",
        formatDate(share.createdAt)
    );

    details.append(title, person, date);

    const status = createElement(
        "span",
        `overview-status status-${String(share.status || "unknown").toLowerCase()}`,
        getStatusLabel(share.status)
    );

    row.append(icon, details, status);

    return row;
}

// --------------------------------------------------
// FETCH REAL BACKEND TRANSFER HISTORY
// --------------------------------------------------

async function loadShareHistory() {
    if (isLoadingShares) return;

    isLoadingShares = true;

    const pendingContainer = document.getElementById(
        "received-pending-list"
    );

    const historyContainer = document.getElementById(
        "received-history-list"
    );

    const activityContainer = document.getElementById(
        "activity-list"
    );

    try {
        const result = await ipcRenderer.invoke(
            "dashboard:get-shares"
        );

        if (!result || !result.ok) {
            throw new Error(
                result?.error || "Could not retrieve transfer history."
            );
        }

        transferData.sent = Array.isArray(result.sent)
            ? result.sent
            : [];

        transferData.received = Array.isArray(result.received)
            ? result.received
            : [];
        console.table([
            ...transferData.sent
                .filter(s => s.status === "pending")
                .map(s => ({
                    direction: "SENT",
                    id: s.id,
                    file: s.fileName || s.contentType,
                    createdAt: s.createdAt,
                    expiresAt: s.expiresAt,
                    status: s.status
                })),

            ...transferData.received
                .filter(s => s.status === "pending")
                .map(s => ({
                    direction: "RECEIVED",
                    id: s.id,
                    file: s.fileName || s.contentType,
                    createdAt: s.createdAt,
                    expiresAt: s.expiresAt,
                    status: s.status
                }))
        ]);

        renderReceivedTransfers(transferData.received);

        renderActivity(
            transferData.sent,
            transferData.received
        );

        renderOverview(
            transferData.sent,
            transferData.received
        );

        updateActivityStats(
            transferData.sent,
            transferData.received
        );

        const settingsConnection = document.getElementById(
            "settings-connection"
        );

        if (settingsConnection) {
            settingsConnection.textContent = "Connected";
        }

        const accountConnection = document.getElementById(
            "account-connection"
        );

        if (accountConnection) {
            accountConnection.textContent = "Connected";
        }

        const syncLabel = document.getElementById("sync-label");

        if (syncLabel) {
            syncLabel.textContent = "Connected";
        }

    } catch (error) {
        console.error("Could not load transfer history:", error);

        renderErrorState(
            pendingContainer,
            error.message
        );

        renderErrorState(
            historyContainer,
            error.message
        );

        renderErrorState(
            activityContainer,
            error.message
        );

        showToast(error.message || "Could not load transfer history.");

    } finally {
        isLoadingShares = false;
    }
}

// --------------------------------------------------
// INITIALIZATION
// --------------------------------------------------

window.addEventListener("DOMContentLoaded", async () => {
    const syncLabel = document.getElementById("sync-label");
    const settingsConnection = document.getElementById(
        "settings-connection"
    );
    const accountConnection = document.getElementById(
        "account-connection"
    );

    if (syncLabel) syncLabel.textContent = "Checking";
    if (settingsConnection) settingsConnection.textContent = "Checking";
    if (accountConnection) accountConnection.textContent = "Checking";

    await loadAccountInfo();
    await loadShareHistory();
});