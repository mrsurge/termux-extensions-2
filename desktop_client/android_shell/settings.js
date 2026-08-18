import { desktopShellHost } from "./host.js";

const hostInput = document.querySelector("#framework-host");
const portInput = document.querySelector("#framework-port");
const saveButton = document.querySelector("#save-settings");
const testButton = document.querySelector("#test-framework");
const frameworkBookmarkNameInput = document.querySelector("#framework-bookmark-name");
const saveFrameworkBookmarkButton = document.querySelector("#save-framework-bookmark");
const frameworkBookmarksList = document.querySelector("#framework-bookmarks");
const frameworkBookmarksEmpty = document.querySelector("#framework-bookmarks-empty");
const settingsStatus = document.querySelector("#settings-status");
const fwsStatus = document.querySelector("#fws-status");
const fwsFrame = document.querySelector("#fws-frame");
const fwsUnavailable = document.querySelector("#fws-unavailable");
const assetStatus = document.querySelector("#asset-status");
const assetVersion = document.querySelector("#asset-version");
const assetInterceptor = document.querySelector("#asset-interceptor");
const assetRoot = document.querySelector("#asset-root");
const updateAssetsButton = document.querySelector("#update-assets");
const localFrameworkCommandInput = document.querySelector("#local-framework-command");
const localFrameworkVenvInput = document.querySelector("#local-framework-venv");
const localFrameworkPortInput = document.querySelector("#local-framework-port");
const localFrameworkBroadcastRows = document.querySelector("#local-framework-broadcast");
const localFrameworkEnvironmentRows = document.querySelector("#local-framework-env");
const localFrameworkConfigStatus = document.querySelector("#local-framework-config-status");
const localFrameworkConfigPath = document.querySelector("#local-framework-config-path");
const saveLocalFrameworkConfigButton = document.querySelector("#save-local-framework-config");
const addLocalFrameworkBroadcastButton = document.querySelector("#add-local-framework-broadcast");
const addLocalFrameworkEnvironmentButton = document.querySelector("#add-local-framework-env");
let frameworkBookmarks = [];

function setStatus(element, state, text) {
  if (!element) return;
  element.dataset.state = state;
  element.textContent = text;
}

function endpointLabel(bookmark) {
  if (typeof bookmark?.frameworkBaseUrl === "string" && bookmark.frameworkBaseUrl) {
    return bookmark.frameworkBaseUrl;
  }
  const host = String(bookmark?.frameworkHost || "");
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(host) ? host : `http://${host}`;
  try {
    const url = new URL(candidate);
    url.port = String(Number(bookmark?.frameworkPort) || 0);
    return url.origin;
  } catch {
    return `${host}:${Number(bookmark?.frameworkPort) || 0}`;
  }
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
    useButton.addEventListener("click", () => {
      hostInput.value = bookmark.frameworkHost;
      portInput.value = String(bookmark.frameworkPort);
      desktopShellHost.toast(`Loaded ${bookmark.name}; press Save to connect`);
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "framework-bookmark-remove";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", async () => {
      removeButton.disabled = true;
      try {
        const result = await desktopShellHost.deleteFrameworkBookmark(bookmark.name);
        frameworkBookmarks = Array.isArray(result?.bookmarks) ? result.bookmarks : [];
        renderFrameworkBookmarks();
        desktopShellHost.toast(`Removed ${bookmark.name}`);
      } catch (error) {
        desktopShellHost.toast(error?.message || "Bookmark removal failed");
        removeButton.disabled = false;
      }
    });

    card.append(useButton, removeButton);
    frameworkBookmarksList.appendChild(card);
  }
}

async function loadFrameworkBookmarks() {
  const result = await desktopShellHost.getFrameworkBookmarks();
  frameworkBookmarks = Array.isArray(result?.bookmarks) ? result.bookmarks : [];
  renderFrameworkBookmarks();
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
  await loadFrameworkBookmarks();
}

function createRemoveButton(row) {
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "secondary-button compact-button local-framework-row-remove";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => row.remove());
  return removeButton;
}

function appendBroadcastRow(value = "") {
  const row = document.createElement("div");
  row.className = "local-framework-row local-framework-broadcast-row";
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "tailscale0";
  input.value = String(value || "");
  row.append(input, createRemoveButton(row));
  localFrameworkBroadcastRows.appendChild(row);
}

function appendEnvironmentRow(key = "", value = "") {
  const row = document.createElement("div");
  row.className = "local-framework-row local-framework-env-row";
  const keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.autocomplete = "off";
  keyInput.spellcheck = false;
  keyInput.placeholder = "ENV_VARIABLE";
  keyInput.value = String(key || "");
  keyInput.dataset.role = "key";
  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.autocomplete = "off";
  valueInput.spellcheck = false;
  valueInput.placeholder = "value";
  valueInput.value = String(value ?? "");
  valueInput.dataset.role = "value";
  row.append(keyInput, valueInput, createRemoveButton(row));
  localFrameworkEnvironmentRows.appendChild(row);
}

function renderLocalFrameworkConfig(config) {
  localFrameworkCommandInput.value = String(config?.command || "");
  localFrameworkVenvInput.value = String(config?.venvPath || "");
  localFrameworkPortInput.value = String(config?.port || 8089);
  localFrameworkBroadcastRows.replaceChildren();
  for (const selector of Array.isArray(config?.broadcast) ? config.broadcast : []) {
    appendBroadcastRow(selector);
  }
  localFrameworkEnvironmentRows.replaceChildren();
  for (const [key, value] of Object.entries(config?.env || {})) {
    appendEnvironmentRow(key, value);
  }
  localFrameworkConfigPath.textContent = String(config?.path || "");

  if (config?.error) {
    setStatus(localFrameworkConfigStatus, "error", config.error);
    return;
  }
  if (config?.commandDetected) {
    const source = config.commandSource === "detected"
      ? "Detected from PATH"
      : config.commandSource === "override"
        ? "Source override detected"
        : "Configured command detected";
    const venv = config.venv
      ? `; virtual environment ready at ${config.venvPath}`
      : "";
    setStatus(localFrameworkConfigStatus, "online", `${source}${venv}`);
    return;
  }
  setStatus(
    localFrameworkConfigStatus,
    "offline",
    "TE2 was not detected; set an absolute command path to enable local launch",
  );
}

async function loadLocalFrameworkConfig() {
  const config = await desktopShellHost.getLocalFrameworkConfig();
  renderLocalFrameworkConfig(config);
}

function collectLocalFrameworkConfig() {
  const broadcast = Array.from(
    localFrameworkBroadcastRows.querySelectorAll("input"),
    (input) => input.value.trim(),
  ).filter(Boolean);
  const env = {};
  for (const row of localFrameworkEnvironmentRows.querySelectorAll(".local-framework-env-row")) {
    const key = row.querySelector('[data-role="key"]')?.value.trim() || "";
    const value = row.querySelector('[data-role="value"]')?.value || "";
    if (!key && value) throw new Error("Environment rows with a value require a variable name");
    if (!key) continue;
    if (Object.hasOwn(env, key)) {
      throw new Error(`Environment variable ${key} is listed more than once`);
    }
    env[key] = value;
  }
  return {
    command: localFrameworkCommandInput.value.trim(),
    venvPath: localFrameworkVenvInput.value.trim(),
    broadcast,
    port: Number(localFrameworkPortInput.value),
    env,
  };
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

async function refreshFrameworkShells(forceReload = false) {
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
    if (forceReload || fwsFrame.src !== result.url) {
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
      settings.connectionChanged
        ? "Desktop connection updated"
        : "Desktop settings saved",
    );

    await Promise.all([
      testFramework(),
      refreshFrameworkShells(settings.connectionChanged),
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

addLocalFrameworkBroadcastButton?.addEventListener("click", () => {
  appendBroadcastRow();
});

addLocalFrameworkEnvironmentButton?.addEventListener("click", () => {
  appendEnvironmentRow();
});

saveLocalFrameworkConfigButton?.addEventListener("click", async () => {
  saveLocalFrameworkConfigButton.disabled = true;
  setStatus(localFrameworkConfigStatus, "loading", "Saving launch configuration");
  try {
    const result = await desktopShellHost.saveLocalFrameworkConfig(
      collectLocalFrameworkConfig(),
    );
    renderLocalFrameworkConfig(result?.config || result);
    desktopShellHost.toast("Local framework launch configuration saved");
  } catch (error) {
    setStatus(
      localFrameworkConfigStatus,
      "error",
      error?.message || "Launch configuration save failed",
    );
    desktopShellHost.toast(error?.message || "Launch configuration save failed");
  } finally {
    saveLocalFrameworkConfigButton.disabled = false;
  }
});

saveFrameworkBookmarkButton?.addEventListener("click", async () => {
  saveFrameworkBookmarkButton.disabled = true;
  try {
    const result = await desktopShellHost.saveFrameworkBookmark({
      name: frameworkBookmarkNameInput.value,
      frameworkHost: hostInput.value,
      frameworkPort: Number(portInput.value),
    });
    frameworkBookmarks = Array.isArray(result?.bookmarks) ? result.bookmarks : [];
    renderFrameworkBookmarks();
    const savedName = frameworkBookmarkNameInput.value.trim();
    frameworkBookmarkNameInput.value = "";
    desktopShellHost.toast(`Saved ${savedName}`);
  } catch (error) {
    desktopShellHost.toast(error?.message || "Bookmark save failed");
  } finally {
    saveFrameworkBookmarkButton.disabled = false;
  }
});

try {
  await Promise.all([
    loadSettings(),
    loadLocalFrameworkConfig(),
  ]);

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
