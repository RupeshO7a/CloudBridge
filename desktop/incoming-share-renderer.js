
const { ipcRenderer } = require("electron");

let share = null;
let busy = false;
let expanded = false;

const notification = document.getElementById("notification");
const senderElement = document.getElementById("sender");
const kindElement = document.getElementById("kind");
const previewElement = document.getElementById("preview");
const compactTextElement = document.getElementById("compactText");
const statusElement = document.getElementById("status");

const acceptButton = document.getElementById("acceptBtn");
const declineButton = document.getElementById("declineBtn");
const expandButton = document.getElementById("expandBtn");
const closeButton = document.getElementById("closeBtn");
const compactPreview = document.getElementById("compactPreview");
const expandHint = document.getElementById("expandHint");

function getPreview(data) {
    const contentType = data.contentType || "text";

    if (contentType === "file") {
        const name = data.fileName || "Unnamed file";
        const size = Number(data.fileSize);

        const sizeText =
            Number.isFinite(size) && size > 0
                ? ` (${(size / 1024 / 1024).toFixed(2)} MB)`
                : "";

        return `File: ${name}${sizeText}\n\nAccept to continue.`;
    }

    const content = String(data.textContent || "").trim();

    if (!content) {
        return "Preview unavailable.";
    }

    const maxLength = 400;

    const preview =
        content.length > maxLength
            ? content.slice(0, maxLength) + "…"
            : content;

    if (contentType === "url") {
        return `Link preview:\n${preview}`;
    }

    return `Message preview:\n${preview}`;
}

function getCompactPreview(data) {
    if (data.contentType === "file") {
        return `File: ${data.fileName || "Unnamed file"}`;
    }

    const content = String(data.textContent || "").trim();

    if (!content) {
        return "New shared content";
    }

    return content.length > 75
        ? content.slice(0, 75) + "…"
        : content;
}

function setExpanded(value) {
    expanded = value;

    notification.classList.toggle("expanded", expanded);

    expandButton.textContent = expanded ? "⌃" : "⌄";
    expandButton.title = expanded ? "Collapse notification" : "Expand notification";

    expandHint.textContent = expanded
        ? "Click to collapse"
        : "Click to view details";

    ipcRenderer.send("resize-incoming-share", expanded);
}

function dismissNotification() {
    if (busy) return;

    ipcRenderer.send("close-incoming-share");
}

ipcRenderer.on("incoming-share-data", (_event, data) => {
    if (!data || !data.id) return;

    share = data;
    busy = false;

    senderElement.textContent =
        `${data.senderEmail || "A CloudBridge user"} wants to share with you`;

    kindElement.textContent =
        `Type: ${data.contentType || "text"}`;

    previewElement.textContent = getPreview(data);
    compactTextElement.textContent = getCompactPreview(data);

    statusElement.textContent = "";

    acceptButton.disabled = false;
    declineButton.disabled = false;

    setExpanded(false);
});

async function choose(action) {
    if (!share?.id || busy) return;

    busy = true;

    acceptButton.disabled = true;
    declineButton.disabled = true;

    statusElement.textContent =
        action === "accept"
            ? "Accepting share..."
            : "Declining share...";

    try {
        const result = await ipcRenderer.invoke(
            "respond-to-incoming-share",
            {
                shareId: share.id,
                action
            }
        );

        if (!result?.ok) {
            throw new Error(result?.error || "The request failed.");
        }

        statusElement.textContent =
            action === "accept"
                ? "Share accepted successfully."
                : "Share declined successfully.";

        setTimeout(() => {
            ipcRenderer.send("complete-incoming-share");
        }, 700);

    } catch (error) {
        statusElement.textContent =
            error.message || "Something went wrong.";

        busy = false;

        acceptButton.disabled = false;
        declineButton.disabled = false;
    }
}

expandButton.addEventListener("click", () => {
    setExpanded(!expanded);
});

compactPreview.addEventListener("click", () => {
    if (!expanded) {
        setExpanded(true);
    }
});

expandHint.addEventListener("click", () => {
    setExpanded(!expanded);
});

closeButton.addEventListener("click", dismissNotification);

acceptButton.addEventListener("click", () => choose("accept"));
declineButton.addEventListener("click", () => choose("decline"));
