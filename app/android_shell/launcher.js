import { androidShellHost } from "./host.js";
import { launcherExtensions } from "./extensions/registry.js";

const root = document.querySelector("#launcher-root");
const refreshButton = document.querySelector("#refresh-apps");

const extensionInstances = launcherExtensions.map((extension) => {
  const surface = document.createElement("section");
  surface.dataset.launcherExtension = extension.id;
  root.appendChild(surface);
  return extension.mount(surface, androidShellHost);
});

refreshButton?.addEventListener("click", async () => {
  refreshButton.disabled = true;
  try {
    await androidShellHost.reloadApps();
    await Promise.all(extensionInstances.map((instance) => instance?.refresh?.()));
  } catch (error) {
    androidShellHost.toast(error?.message || "Refresh failed");
  } finally {
    refreshButton.disabled = false;
  }
});

window.addEventListener("pagehide", () => {
  extensionInstances.forEach((instance) => instance?.dispose?.());
}, { once: true });
