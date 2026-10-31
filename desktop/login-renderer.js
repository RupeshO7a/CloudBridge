
const { ipcRenderer } = require("electron");

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const googleBtn = document.getElementById("googleBtn");
const errorElement = document.getElementById("error");
const statusElement = document.getElementById("status");

console.log("CloudBridge login renderer loaded");

function showError(message) {
  console.error("CloudBridge login error:", message);
  errorElement.innerText = message || "Something went wrong.";
  statusElement.innerText = "";
}

function setBusy(busy, message = "") {
  loginBtn.disabled = busy;
  googleBtn.disabled = busy;
  statusElement.innerText = message;
}

googleBtn.addEventListener("click", async () => {
  console.log("Google button clicked");
  errorElement.innerText = "";
  setBusy(true, "Connecting to Supabase...");

  try {
    console.log("Invoking google-login IPC handler");

    const result = await ipcRenderer.invoke("google-login");

    console.log("Google login response:", result);

    if (!result || !result.ok) {
      showError(result?.error || "No response from the desktop app.");
      setBusy(false);
      return;
    }

    setBusy(true, "Your browser should open shortly. Complete Google sign-in there.");
  } catch (error) {
    console.error("Google login failed:", error);
    showError(error.message || "Could not start Google sign-in.");
    setBusy(false);
  }
});

loginBtn.addEventListener("click", async () => {
  errorElement.innerText = "";
  statusElement.innerText = "";

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showError("Enter your email and password.");
    return;
  }

  setBusy(true, "Signing in...");

  try {
    const result = await ipcRenderer.invoke("login", { email, password });

    if (!result?.ok) {
      showError(result?.error || "Login failed.");
      setBusy(false);
      return;
    }

    setBusy(true, "Login successful.");
  } catch (error) {
    showError(error.message || "Login failed.");
    setBusy(false);
  }
});


ipcRenderer.on("oauth-callback", async (_event, { code }) => {
  console.log("OAuth callback received in renderer");

  setBusy(true, "Completing Google sign-in...");
  errorElement.innerText = "";

  try {
    console.log("Calling exchange-oauth-code...");

    const result = await ipcRenderer.invoke(
      "exchange-oauth-code",
      code
    );

    console.log("OAuth exchange result:", result);

    if (!result || !result.ok) {
      showError(
        result?.error || "Could not complete Google sign-in."
      );
      setBusy(false);
      return;
    }

    setBusy(true, "Login successful. Starting CloudBridge...");
  } catch (error) {
    console.error("OAuth renderer error:", error);
    showError(error.message || "Could not complete Google sign-in.");
    setBusy(false);
  }
});


console.log("Google button handler registered:", !!googleBtn);
