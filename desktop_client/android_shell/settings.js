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
