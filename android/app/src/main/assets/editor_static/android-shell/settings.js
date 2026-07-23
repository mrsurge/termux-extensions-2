import { androidShellHost } from "./host.js";

const hostInput = document.querySelector("#framework-host");
const portInput = document.querySelector("#framework-port");
const persistentToggle = document.querySelector("#persistent-network-notification");
const imeContextSwitchingToggle = document.querySelector("#ime-context-switching-enabled");
const saveButton = document.querySelector("#save-settings");
const testButton = document.querySelector("#test-framework");
const settingsStatus = document.querySelector("#settings-status");
const fwsStatus = document.querySelector("#fws-status");
const fwsFrame = document.querySelector("#fws-frame");
const fwsUnavailable = document.querySelector("#fws-unavailable");

function setStatus(element, state, text) {
  if (!element) return;
  element.dataset.state = state;
  element.textContent = text;
}

async function loadSettings() {
  const settings = await androidShellHost.getSettings();
  hostInput.value = settings.frameworkHost || "127.0.0.1";
  portInput.value = String(settings.frameworkPort || 8089);
  persistentToggle.checked = !!settings.persistentNetworkNotification;
  imeContextSwitchingToggle.checked = settings.imeContextSwitchingEnabled !== false;
  setStatus(settingsStatus, "online", "Android settings loaded");
}

async function testFramework() {
  testButton.disabled = true;
  setStatus(settingsStatus, "loading", "Checking framework");
  try {
    const result = await androidShellHost.getFrameworkStatus();
    setStatus(
      settingsStatus,
      result.online ? "online" : "offline",
      result.online ? `Connected to ${result.frameworkBaseUrl}` : "Framework unavailable",
    );
  } catch (error) {
    setStatus(settingsStatus, "error", error?.message || "Framework check failed");
  } finally {
    testButton.disabled = false;
  }
}

async function refreshFrameworkShells() {
  setStatus(fwsStatus, "loading", "Checking availability");
  fwsFrame.hidden = true;
  fwsUnavailable.hidden = true;
  try {
    const result = await androidShellHost.getFwsStatus();
    if (!result.available) {
      setStatus(fwsStatus, "offline", "Unavailable");
      fwsUnavailable.hidden = false;
      return;
    }
    setStatus(fwsStatus, "online", "Connected");
    if (fwsFrame.src !== result.url) fwsFrame.src = result.url;
    fwsFrame.hidden = false;
  } catch (error) {
    setStatus(fwsStatus, "error", error?.message || "Availability check failed");
    fwsUnavailable.hidden = false;
  }
}

saveButton?.addEventListener("click", async () => {
  saveButton.disabled = true;
  try {
    const settings = await androidShellHost.saveSettings({
      frameworkHost: hostInput.value,
      frameworkPort: Number(portInput.value),
      persistentNetworkNotification: persistentToggle.checked,
      imeContextSwitchingEnabled: imeContextSwitchingToggle.checked,
    });
    hostInput.value = settings.frameworkHost;
    portInput.value = String(settings.frameworkPort);
    persistentToggle.checked = !!settings.persistentNetworkNotification;
    imeContextSwitchingToggle.checked = settings.imeContextSwitchingEnabled !== false;
    androidShellHost.toast("Android settings saved");
    await Promise.all([testFramework(), refreshFrameworkShells()]);
  } catch (error) {
    setStatus(settingsStatus, "error", error?.message || "Save failed");
    androidShellHost.toast(error?.message || "Save failed");
  } finally {
    saveButton.disabled = false;
  }
});

testButton?.addEventListener("click", () => void testFramework());
document.querySelector("#refresh-fws")?.addEventListener("click", () => void refreshFrameworkShells());

try {
  await loadSettings();
  await Promise.all([testFramework(), refreshFrameworkShells()]);
} catch (error) {
  setStatus(settingsStatus, "error", error?.message || "Failed to load settings");
}
