
const { ipcRenderer } = require("electron");

const preview = document.getElementById("preview");

const recipient = document.getElementById("recipient");
const fileRecipient = document.getElementById("fileRecipient");

const expires = document.getElementById("expires");

const sendBtn = document.getElementById("sendBtn");
const fileBtn = document.getElementById("fileBtn");
const sendFileBtn = document.getElementById("sendFileBtn");
const ignoreBtn = document.getElementById("ignoreBtn");

const fileName = document.getElementById("fileName");
const status = document.getElementById("status");

let current = {
    text: "",
    type: "text"
};

let selectedFile = false;

// Receive clipboard content
ipcRenderer.on("clipboard-content", (_event, data) => {
    current = data || { text: "", type: "text" };

    preview.value = current.text || "";
    status.textContent = "";
});

// Send text or URL
sendBtn.addEventListener("click", async () => {
    const email = recipient.value.trim();

    if (!email) {
        status.textContent = "Enter the text recipient email.";
        return;
    }

    if (!current.text || !current.text.trim()) {
        status.textContent = "No clipboard text available to share.";
        return;
    }

    try {
        sendBtn.disabled = true;
        fileBtn.disabled = true;
        sendFileBtn.disabled = true;

        status.textContent = "Sending text...";

        const result = await ipcRenderer.invoke("send-share", {
            text: current.text,
            type: current.type || "text",
            recipientEmail: email,
            expiresInHours: Number(expires.value)
        });

        if (!result || !result.ok) {
            throw new Error(result?.error || "Text sharing failed.");
        }

        status.textContent = `Text sent successfully to ${email}!`;

        alert(`Text sent successfully to ${email}!`);

        window.close();

    } catch (error) {
        console.error("Text sharing error:", error);
        status.textContent = error.message || "Could not send text.";

    } finally {
        sendBtn.disabled = false;
        fileBtn.disabled = false;
        sendFileBtn.disabled = !selectedFile;
    }
});

// Choose a file without uploading it
fileBtn.addEventListener("click", async () => {
    try {
        fileBtn.disabled = true;
        status.textContent = "Opening file picker...";

        const result = await ipcRenderer.invoke("select-file");

        if (!result || result.cancelled) {
            status.textContent = "File selection cancelled.";
            return;
        }

        if (!result.ok) {
            throw new Error(result.error || "Could not select file.");
        }

        selectedFile = true;

        fileName.textContent = `Selected: ${result.fileName}`;
        status.textContent = "File selected. Click Send File to upload it.";

        sendFileBtn.disabled = false;

    } catch (error) {
        console.error("File selection error:", error);
        status.textContent = error.message || "Could not select file.";

    } finally {
        fileBtn.disabled = false;
    }
});

// Upload the selected file only after clicking Send File
sendFileBtn.addEventListener("click", async () => {
    const email = fileRecipient.value.trim();

    if (!email) {
        status.textContent = "Enter the file recipient email.";
        return;
    }

    if (!selectedFile) {
        status.textContent = "Choose a file first.";
        return;
    }

    try {
        sendBtn.disabled = true;
        fileBtn.disabled = true;
        sendFileBtn.disabled = true;

        status.textContent = "Uploading file...";

        const result = await ipcRenderer.invoke("send-selected-file", {
            recipientEmail: email,
            expiresInHours: Number(expires.value)
        });

        if (!result || !result.ok) {
            throw new Error(result?.error || "File upload failed.");
        }

        selectedFile = false;

        fileName.textContent = `Sent: ${result.fileName || "File"}`;
        status.textContent = `File sent successfully to ${email}!`;

        alert(`File sent successfully to ${email}!`);

        window.close();

    } catch (error) {
        console.error("File upload error:", error);
        status.textContent = error.message || "Could not upload file.";

    } finally {
        sendBtn.disabled = false;
        fileBtn.disabled = false;
        sendFileBtn.disabled = !selectedFile;
    }
});

// Close popup
ignoreBtn.addEventListener("click", () => {
    ipcRenderer.send("dismiss-popup");
});
