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
const frameworkBookmarksSection = document.querySelector("#framework-bookmarks-section");
const frameworkBookmarkNameInput = document.querySelector("#framework-bookmark-name");
const saveFrameworkBookmarkButton = document.querySelector("#save-framework-bookmark");
const frameworkBookmarksList = document.querySelector("#framework-bookmarks");
const frameworkBookmarksEmpty = document.querySelector("#framework-bookmarks-empty");
const settingsStatus = document.querySelector("#settings-status");
const powerPolicyStatus = document.querySelector("#power-policy-status");
const notificationPermissionStatus = document.querySelector("#notification-permission-status");
const openPowerSettingsButton = document.querySelector("#open-power-settings");
const fwsStatus = document.querySelector("#fws-status");
const fwsFrame = document.querySelector("#fws-frame");
const fwsUnavailable = document.querySelector("#fws-unavailable");
let frameworkBookmarks = [];

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

function supportsFrameworkBookmarks(settings) {
  return Number(settings?.nativeSettingsSchemaVersion) >= 3;
}

function endpointLabel(bookmark) {
  if (typeof bookmark?.frameworkBaseUrl === "string" && bookmark.frameworkBaseUrl) {
    return bookmark.frameworkBaseUrl;
  }
  const host = String(bookmark?.frameworkHost || "");
  const authority = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${authority}:${Number(bookmark?.frameworkPort) || 0}`;
}

async function connectToFramework(frameworkHost, frameworkPort, successMessage) {
  setStatus(settingsStatus, "loading", "Switching framework target");
  const settings = await androidShellHost.saveSettings({
    frameworkHost,
    frameworkPort,
  });
  hostInput.value = settings.frameworkHost;
  portInput.value = String(settings.frameworkPort);
  androidShellHost.toast(successMessage);
  await Promise.all([testFramework(), refreshFrameworkShells()]);
  return settings;
}

function renderFrameworkBookmarks() {
  frameworkBookmarksList.replaceChildren();
  frameworkBookmarksEmpty.hidden = frameworkBookmarks.length > 0;
  for (const bookmark of frameworkBookmarks) {
    const card = document.createElement("div");
    card.className = "framework-bookmark-card";

    const useButton = document.createElement("button");
    useButton.type = "button";
    useButton.className = "framework-bookmark-use";
    const name = document.createElement("strong");
    name.textContent = bookmark.name;
    const endpoint = document.createElement("small");
    endpoint.textContent = endpointLabel(bookmark);
    useButton.append(name, endpoint);
    useButton.addEventListener("click", async () => {
      hostInput.value = bookmark.frameworkHost;
      portInput.value = String(bookmark.frameworkPort);
      useButton.disabled = true;
      try {
        await connectToFramework(
          bookmark.frameworkHost,
          Number(bookmark.frameworkPort),
          `Switched to ${bookmark.name}`,
        );
      } catch (error) {
        setStatus(settingsStatus, "error", error?.message || "Framework switch failed");
        androidShellHost.toast(error?.message || "Framework switch failed");
      } finally {
        useButton.disabled = false;
      }
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "framework-bookmark-remove";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", async () => {
      removeButton.disabled = true;
      try {
        const result = await androidShellHost.deleteFrameworkBookmark(bookmark.name);
        frameworkBookmarks = Array.isArray(result?.bookmarks) ? result.bookmarks : [];
        renderFrameworkBookmarks();
        androidShellHost.toast(`Removed ${bookmark.name}`);
      } catch (error) {
        androidShellHost.toast(error?.message || "Bookmark removal failed");
        removeButton.disabled = false;
      }
    });

    card.append(useButton, removeButton);
    frameworkBookmarksList.appendChild(card);
  }
}

async function loadFrameworkBookmarks() {
  const result = await androidShellHost.getFrameworkBookmarks();
  frameworkBookmarks = Array.isArray(result?.bookmarks) ? result.bookmarks : [];
  renderFrameworkBookmarks();
}

async function loadSettings() {
  const settings = await androidShellHost.getSettings();
  hostInput.value = settings.frameworkHost || "127.0.0.1";
  portInput.value = String(settings.frameworkPort || 8089);
  persistentToggle.checked = !!settings.persistentNetworkNotification;
  imeContextSwitchingToggle.checked = !!settings.imeContextSwitchingEnabled;
  applyDevToolsSettings(settings);
  frameworkBookmarksSection.hidden = !supportsFrameworkBookmarks(settings);
  if (!frameworkBookmarksSection.hidden) await loadFrameworkBookmarks();
  const runtime = settings.runtime || {};
  setStatus(
    powerPolicyStatus,
    runtime.batteryOptimizationExempt ? "online" : "offline",
    runtime.batteryOptimizationExempt
      ? "Battery optimization exemption enabled"
      : "Android may suspend the remote runtime during idle",
  );
  setStatus(
    notificationPermissionStatus,
    runtime.notificationPermissionGranted ? "online" : "offline",
    runtime.notificationPermissionGranted
      ? "Notification permission enabled"
      : "Notification permission disabled",
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

saveFrameworkBookmarkButton?.addEventListener("click", async () => {
  saveFrameworkBookmarkButton.disabled = true;
  try {
    const result = await androidShellHost.saveFrameworkBookmark({
      name: frameworkBookmarkNameInput.value,
      frameworkHost: hostInput.value,
      frameworkPort: Number(portInput.value),
    });
    frameworkBookmarks = Array.isArray(result?.bookmarks) ? result.bookmarks : [];
    renderFrameworkBookmarks();
    const savedName = frameworkBookmarkNameInput.value.trim();
    frameworkBookmarkNameInput.value = "";
    androidShellHost.toast(`Saved ${savedName}`);
  } catch (error) {
    androidShellHost.toast(error?.message || "Bookmark save failed");
  } finally {
    saveFrameworkBookmarkButton.disabled = false;
  }
});
persistToggle(
  imeContextSwitchingToggle,
  "imeContextSwitchingEnabled",
  (settings) => !!settings.imeContextSwitchingEnabled,
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
    await connectToFramework(
      hostInput.value,
      Number(portInput.value),
      "Framework address saved",
    );
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

let foregroundRefresh = null;

function refreshSettingsOnForeground() {
  if (document.visibilityState === "hidden" || foregroundRefresh) return;
  foregroundRefresh = Promise.resolve()
    .then(() => loadSettings())
    .catch((error) => {
      setStatus(settingsStatus, "error", error?.message || "Failed to refresh settings");
    })
    .finally(() => {
      foregroundRefresh = null;
    });
}

window.addEventListener("pageshow", refreshSettingsOnForeground);
window.addEventListener("focus", refreshSettingsOnForeground);
document.addEventListener("visibilitychange", refreshSettingsOnForeground);

try {
  await loadSettings();
  await Promise.all([testFramework(), refreshFrameworkShells()]);
} catch (error) {
  setStatus(settingsStatus, "error", error?.message || "Failed to load settings");
}
