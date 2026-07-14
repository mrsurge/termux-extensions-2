const API_ROOT = "/android-api";

async function request(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return body.data;
}

let toastTimer = 0;

export function toast(message) {
  const element = document.querySelector("#toast");
  if (!element) return;
  element.textContent = String(message || "");
  element.dataset.visible = "true";
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    element.dataset.visible = "false";
  }, 2800);
}

export const androidShellHost = {
  getApps: () => request("/apps"),
  reloadApps: () => request("/apps/reload", { method: "POST" }),
  openApp: (appId) => request(`/apps/${encodeURIComponent(appId)}/open`, { method: "POST" }),
  quitApp: (appId) => request(`/apps/${encodeURIComponent(appId)}/quit`, { method: "POST" }),
  getSettings: () => request("/settings"),
  saveSettings: (settings) => request("/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  }),
  getFrameworkStatus: () => request("/framework/status"),
  getFwsStatus: () => request("/fws/status"),
  toast,
};
