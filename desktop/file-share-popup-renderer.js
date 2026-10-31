
const { ipcRenderer } = require("electron");

const recipient = document.getElementById("recipient");
const expires = document.getElementById("expires");

const chooseBtn = document.getElementById("chooseBtn");
const sendFileBtn = document.getElementById("sendFileBtn");
const closeBtn = document.getElementById("closeBtn");

const fileName = document.getElementById("fileName");
const status = document.getElementById("status");

let selectedFile = false;
// Receive a file selected through Windows File Explorer.
ipcRenderer.on("external-file-selected", (_event, data) => {
    selectedFile = true;

    fileName.textContent = data.fileName;
    status.textContent = "File selected. Click Send File to upload.";

    sendFileBtn.disabled = false;
});

// Choose file without uploading
chooseBtn.addEventListener("click", async () => {
    try {
        chooseBtn.disabled = true;
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

        fileName.textContent = result.fileName;
        status.textContent = "File selected. Click Send File to upload.";

        sendFileBtn.disabled = false;

    } catch (error) {
        console.error("File selection failed:", error);
        status.textContent = error.message || "Could not select file.";

    } finally {
        chooseBtn.disabled = false;
    }
});

// Upload only after clicking Send File
sendFileBtn.addEventListener("click", async () => {
    const email = recipient.value.trim();

    if (!email) {
        status.textContent = "Please enter the recipient's email.";
        return;
    }

    if (!selectedFile) {
        status.textContent = "Please choose a file first.";
        return;
    }

    try {
        chooseBtn.disabled = true;
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
        console.error("File upload failed:", error);
        status.textContent = error.message || "Could not upload file.";

    } finally {
        chooseBtn.disabled = false;
        sendFileBtn.disabled = !selectedFile;
    }
});

// Close popup
closeBtn.addEventListener("click", () => {
    ipcRenderer.send("dismiss-popup");
});
