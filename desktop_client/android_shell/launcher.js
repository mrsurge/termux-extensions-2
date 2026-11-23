import { desktopShellHost } from "./host.js";
import { launcherExtensions } from "./extensions/registry.js";

const root = document.querySelector("#launcher-root");
const refreshButton = document.querySelector("#refresh-apps");

const extensionInstances = new Map(launcherExtensions.map((extension) => {
  const surface = document.createElement("section");
  surface.dataset.launcherExtension = extension.id;
  root.appendChild(surface);

  return [extension.id, extension.mount(surface, desktopShellHost)];
}));

refreshButton?.addEventListener("click", async () => {
  refreshButton.disabled = true;

  try {
    await desktopShellHost.reloadApps();

    await Promise.all(
      Array.from(extensionInstances.values(),
        (instance) => instance?.refresh?.(),
      ),
    );
  } catch (error) {
    desktopShellHost.toast(
      error?.message || "Refresh failed",
    );
  } finally {
    refreshButton.disabled = false;
  }
});

// Framework state notifications already carry the card state. Reading it again
// here would start a new local probe on Electron.
window.addEventListener("te2:launcher-apps-refresh", () => {
  void extensionInstances.get("apps")?.refresh?.().catch((error) => {
    desktopShellHost.toast(error?.message || "Apps refresh failed");
  });
});

window.addEventListener(
  "pagehide",
  () => {
    extensionInstances.forEach(
      (instance) => instance?.dispose?.(),
    );
  },
  { once: true },
);
