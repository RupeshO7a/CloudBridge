
const { ipcRenderer } = require("electron");

const preview = document.getElementById("preview");
const recipient = document.getElementById("recipient");
const expires = document.getElementById("expires");

const sendBtn = document.getElementById("sendBtn");
const closeBtn = document.getElementById("closeBtn");
const status = document.getElementById("status");

let current = {
    text: "",
    type: "text"
};

// Receive clipboard content from main.js
ipcRenderer.on("clipboard-content", (_event, data) => {
    console.log("DEBUG clipboard-content received:", data);
    console.log("DEBUG received text type:", typeof data?.text);

    const receivedText = typeof data === "string"
        ? data
        : data?.text;

    current = {
        text: typeof receivedText === "string" ? receivedText : "",
        type: data?.type || "text"
    };

    preview.value = current.text;
    status.textContent = "";

    if (receivedText != null && typeof receivedText !== "string") {
        console.error("Invalid clipboard text received:", receivedText);
        status.textContent = "Clipboard data format is invalid.";
    }
});

// Send text or URL
sendBtn.addEventListener("click", async () => {
    const email = recipient.value.trim();

    if (!email) {
        status.textContent = "Please enter the recipient's email.";
        return;
    }

    if (!current.text || !current.text.trim()) {
        status.textContent = "No clipboard text available.";
        return;
    }

    try {
        sendBtn.disabled = true;
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
        console.error("Text sharing failed:", error);
        status.textContent = error.message || "Could not send text.";

    } finally {
        sendBtn.disabled = false;
    }
});

// Close popup
closeBtn.addEventListener("click", () => {
    ipcRenderer.send("dismiss-popup");
});
