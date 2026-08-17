import { androidShellHost } from "./host.js";

const hostInput = document.querySelector("#framework-host");
const portInput = document.querySelector("#framework-port");
const persistentToggle = document.querySelector("#persistent-network-notification");
const imeContextSwitchingToggle = document.querySelector("#ime-context-switching-enabled");
const devToolsRunProfilesRow = document.querySelector("#devtools-run-profiles-row");
const devToolsRunProfilesToggle = document.querySelector("#devtools-run-profiles-enabled");
const devToolsDebugRow = document.querySelector("#devtools-debug-row");
const devToolsDebugToggle = document.querySelector("#devtools-debug-enabled");
const devToolsLegacyRow = document.querySelector("#devtools-legacy-row");
const devToolsLegacyToggle = document.querySelector("#devtools-inspector-enabled");
const saveButton = document.querySelector("#save-settings");
const testButton = document.querySelector("#test-framework");
const settingsStatus = document.querySelector("#settings-status");
const powerPolicyStatus = document.querySelector("#power-policy-status");
const openPowerSettingsButton = document.querySelector("#open-power-settings");
const fwsStatus = document.querySelector("#fws-status");
const fwsFrame = document.querySelector("#fws-frame");
const fwsUnavailable = document.querySelector("#fws-unavailable");

function setStatus(element, state, text) {
  if (!element) return;
  element.dataset.state = state;
  element.textContent = text;
}

function supportsSplitDevToolsSettings(settings) {
  return Number(settings?.nativeSettingsSchemaVersion) >= 2 || (
    typeof settings?.devToolsRunProfilesEnabled === "boolean" &&
    typeof settings?.devToolsDebugEnabled === "boolean"
  );
}

function applyDevToolsSettings(settings) {
  const splitSettings = supportsSplitDevToolsSettings(settings);
  devToolsRunProfilesRow.hidden = !splitSettings;
  devToolsDebugRow.hidden = !splitSettings;
  devToolsLegacyRow.hidden = splitSettings;

  if (splitSettings) {
    devToolsRunProfilesToggle.checked = !!settings.devToolsRunProfilesEnabled;
    devToolsDebugToggle.checked = !!settings.devToolsDebugEnabled;
  } else {
    devToolsLegacyToggle.checked = !!settings.devToolsInspectorEnabled;
  }
}

async function loadSettings() {
  const settings = await androidShellHost.getSettings();
  hostInput.value = settings.frameworkHost || "127.0.0.1";
  portInput.value = String(settings.frameworkPort || 8089);
  persistentToggle.checked = !!settings.persistentNetworkNotification;
  imeContextSwitchingToggle.checked = settings.imeContextSwitchingEnabled !== false;
  applyDevToolsSettings(settings);
  const runtime = settings.runtime || {};
  setStatus(
    powerPolicyStatus,
    runtime.batteryOptimizationExempt ? "online" : "offline",
    runtime.batteryOptimizationExempt
      ? "Battery optimization exemption enabled"
      : "Android may suspend the remote runtime during idle",
  );
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

function persistToggle(toggle, settingName, readValue) {
  toggle?.addEventListener("change", async () => {
    const requested = toggle.checked;
    toggle.disabled = true;
    try {
      const settings = await androidShellHost.saveSettings({
        [settingName]: requested,
      });
      toggle.checked = readValue(settings);
      setStatus(settingsStatus, "online", "Android settings saved");
    } catch (error) {
      toggle.checked = !requested;
      setStatus(settingsStatus, "error", error?.message || "Save failed");
      androidShellHost.toast(error?.message || "Save failed");
    } finally {
      toggle.disabled = false;
    }
  });
}

persistToggle(
  persistentToggle,
  "persistentNetworkNotification",
  (settings) => !!settings.persistentNetworkNotification,
);
persistToggle(
  imeContextSwitchingToggle,
  "imeContextSwitchingEnabled",
  (settings) => settings.imeContextSwitchingEnabled !== false,
);
persistToggle(
  devToolsRunProfilesToggle,
  "devToolsRunProfilesEnabled",
  (settings) => !!settings.devToolsRunProfilesEnabled,
);
persistToggle(
  devToolsDebugToggle,
  "devToolsDebugEnabled",
  (settings) => !!settings.devToolsDebugEnabled,
);
persistToggle(
  devToolsLegacyToggle,
  "devToolsInspectorEnabled",
  (settings) => !!settings.devToolsInspectorEnabled,
);

saveButton?.addEventListener("click", async () => {
  saveButton.disabled = true;
  try {
    const settings = await androidShellHost.saveSettings({
      frameworkHost: hostInput.value,
      frameworkPort: Number(portInput.value),
    });
    hostInput.value = settings.frameworkHost;
    portInput.value = String(settings.frameworkPort);
    androidShellHost.toast("Framework address saved");
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
openPowerSettingsButton?.addEventListener("click", async () => {
  openPowerSettingsButton.disabled = true;
  try {
    await androidShellHost.openBatterySettings();
  } catch (error) {
    androidShellHost.toast(error?.message || "Unable to open battery settings");
  } finally {
    openPowerSettingsButton.disabled = false;
  }
});

try {
  await loadSettings();
  await Promise.all([testFramework(), refreshFrameworkShells()]);
} catch (error) {
  setStatus(settingsStatus, "error", error?.message || "Failed to load settings");
}
