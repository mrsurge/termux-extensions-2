import { desktopShellHost } from "./host.js";

const hostInput = document.querySelector("#framework-host");
const portInput = document.querySelector("#framework-port");
const saveButton = document.querySelector("#save-settings");
const testButton = document.querySelector("#test-framework");
const settingsStatus = document.querySelector("#settings-status");
const fwsStatus = document.querySelector("#fws-status");
const fwsFrame = document.querySelector("#fws-frame");
const fwsUnavailable = document.querySelector("#fws-unavailable");
const assetStatus = document.querySelector("#asset-status");
const assetVersion = document.querySelector("#asset-version");
const assetInterceptor = document.querySelector("#asset-interceptor");
const assetRoot = document.querySelector("#asset-root");
const updateAssetsButton = document.querySelector("#update-assets");

function setStatus(element, state, text) {
  if (!element) return;
  element.dataset.state = state;
  element.textContent = text;
}

async function loadSettings() {
  const settings = await desktopShellHost.getSettings();
  hostInput.value = settings.frameworkHost || "127.0.0.1";
  portInput.value = String(settings.frameworkPort || 8089);
  setStatus(
    settingsStatus,
    "online",
    "Desktop settings loaded",
  );
}

async function testFramework() {
  testButton.disabled = true;
  setStatus(
    settingsStatus,
    "loading",
    "Checking framework",
  );

  try {
    const result =
      await desktopShellHost.getFrameworkStatus();

    setStatus(
      settingsStatus,
      result.online ? "online" : "offline",
      result.online
        ? `Connected to ${result.frameworkBaseUrl}`
        : "Framework unavailable",
    );
  } catch (error) {
    setStatus(
      settingsStatus,
      "error",
      error?.message || "Framework check failed",
    );
  } finally {
    testButton.disabled = false;
  }
}

async function refreshFrameworkShells() {
  setStatus(
    fwsStatus,
    "loading",
    "Checking availability",
  );

  fwsFrame.hidden = true;
  fwsUnavailable.hidden = true;

  try {
    const result = await desktopShellHost.getFwsStatus();

    if (!result.available) {
      setStatus(fwsStatus, "offline", "Unavailable");
      fwsUnavailable.hidden = false;
      return;
    }

    setStatus(fwsStatus, "online", "Connected");
    if (fwsFrame.src !== result.url) {
      fwsFrame.src = result.url;
    }

    fwsFrame.hidden = false;
  } catch (error) {
    setStatus(
      fwsStatus,
      "error",
      error?.message || "Availability check failed",
    );

    fwsUnavailable.hidden = false;
  }
}

function renderAssetStatus(result) {
  const valid = result?.valid === true;
  const intercepted = result?.interceptorAvailable === true;
  const error = String(
    result?.error || result?.interceptorError || "",
  ).trim();

  assetVersion.textContent = result?.localVersion || "None";
  assetRoot.textContent = result?.assetRoot || "Unknown";
  assetInterceptor.textContent = intercepted
    ? "Active"
    : "Unavailable";

  if (valid && intercepted) {
    setStatus(assetStatus, "online", "Local framework assets are active");
  } else if (valid) {
    setStatus(
      assetStatus,
      "offline",
      error || "Assets installed, but WebKit interception is unavailable",
    );
  } else {
    setStatus(
      assetStatus,
      "offline",
      error || "No complete desktop asset bundle is installed",
    );
  }
}

async function refreshAssetStatus() {
  setStatus(assetStatus, "loading", "Checking local assets");
  try {
    renderAssetStatus(await desktopShellHost.getAssetStatus());
  } catch (error) {
    setStatus(
      assetStatus,
      "error",
      error?.message || "Asset status check failed",
    );
  }
}

async function updateAssets() {
  updateAssetsButton.disabled = true;
  setStatus(assetStatus, "loading", "Downloading desktop assets");
  try {
    const result = await desktopShellHost.updateAssets();
    renderAssetStatus(result);
    desktopShellHost.toast(
      result.updated
        ? `Desktop assets updated to v${result.localVersion}`
        : result.error || "Desktop assets are already current",
    );
  } catch (error) {
    setStatus(
      assetStatus,
      "error",
      error?.message || "Asset update failed",
    );
    desktopShellHost.toast(error?.message || "Asset update failed");
  } finally {
    updateAssetsButton.disabled = false;
  }
}

saveButton?.addEventListener("click", async () => {
  saveButton.disabled = true;

  try {
    const settings = await desktopShellHost.saveSettings({
      frameworkHost: hostInput.value,
      frameworkPort: Number(portInput.value),
    });

    hostInput.value = settings.frameworkHost;
    portInput.value = String(settings.frameworkPort);
    desktopShellHost.toast(
      "Desktop settings saved",
    );

    await Promise.all([
      testFramework(),
      refreshFrameworkShells(),
    ]);
  } catch (error) {
    setStatus(
      settingsStatus,
      "error",
      error?.message || "Save failed",
    );

    desktopShellHost.toast(
      error?.message || "Save failed",
    );
  } finally {
    saveButton.disabled = false;
  }
});

testButton?.addEventListener(
  "click",
  () => void testFramework(),
);

document
  .querySelector("#refresh-fws")
  ?.addEventListener(
    "click",
    () => void refreshFrameworkShells(),
  );

updateAssetsButton?.addEventListener(
  "click",
  () => void updateAssets(),
);

try {
  await loadSettings();

  await Promise.all([
    testFramework(),
    refreshFrameworkShells(),
    refreshAssetStatus(),
  ]);
} catch (error) {
  setStatus(
    settingsStatus,
    "error",
    error?.message || "Failed to load settings",
  );
}
