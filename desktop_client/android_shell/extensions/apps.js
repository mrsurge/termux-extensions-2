// in `android_shell/extensions/`
function setFrameworkStatus(online, frameworkBaseUrl, error = "") {
  const status = document.querySelector("#framework-status");
  if (!status) return;
  status.dataset.state = online ? "online" : "offline";
  status.textContent = online
    ? `Connected to ${frameworkBaseUrl}`
    : `Framework offline${error ? ` — ${error}` : ""}`;
  status.title = online ? "" : error;
}

function resolveIcon(app) {
  const source = typeof app.icon_src === "string" ? app.icon_src.trim() : "";
  if (source) return { source, text: "" };
  const text = String(app.icon_emoji || app.icon_text || "").trim();
  return { source: "", text };
}

function renderApps(root, host, payload) {
  const apps = Array.isArray(payload?.apps) ? payload.apps : [];
  setFrameworkStatus(
    !!payload?.online,
    payload?.frameworkBaseUrl || "framework",
    String(payload?.error || ""),
  );

  root.innerHTML = "";
  if (apps.length === 0) {
    root.innerHTML = '<div class="empty-state">No applications available.</div>';
    return;
  }

  const grid = document.createElement("div");
  grid.className = "apps-grid";

  apps.forEach((app) => {
    const card = document.createElement("article");
    card.className = "app-card";
    card.dataset.running = String(!!app.running);

    const launch = document.createElement("button");
    launch.type = "button";
    launch.className = "app-launch-button";
    launch.title = app.description || app.name || app.id;

    const icon = document.createElement("span");
    icon.className = "app-icon";
    const resolvedIcon = resolveIcon(app);
    if (resolvedIcon.source) {
      const image = document.createElement("img");
      image.src = resolvedIcon.source;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      icon.appendChild(image);
    } else {
      icon.textContent = resolvedIcon.text || String(app.name || app.id || "?").slice(0, 1);
    }

    const name = document.createElement("span");
    name.className = "app-name";
    name.textContent = app.name || app.id;
    launch.append(icon, name);

    launch.addEventListener("click", async () => {
      launch.disabled = true;
      try {
        const result = await host.openApp(app.id);
        if (!result?.url) throw new Error("App open response is missing a URL");
        host.navigate(result.url);
      } catch (error) {
        host.toast(error?.message || "Failed to open app");
        launch.disabled = false;
      }
    });

    card.appendChild(launch);
    if (app.running && !app.local) {
      const menu = document.createElement("button");
      menu.type = "button";
      menu.className = "app-menu-button";
      menu.textContent = "...";
      menu.title = `Quit ${app.name || app.id}`;
      menu.setAttribute("aria-label", `Quit ${app.name || app.id}`);
      menu.addEventListener("click", async () => {
        menu.disabled = true;
        try {
          await host.quitApp(app.id);
          await refresh();
        } catch (error) {
          host.toast(error?.message || "Failed to quit app");
          menu.disabled = false;
        }
      });
      card.appendChild(menu);
    }
    grid.appendChild(card);
  });

  root.appendChild(grid);
}

let activeRoot = null;
let activeHost = null;
let refreshTimer = 0;

async function refresh() {
  if (!activeRoot || !activeHost) return;
  try {
    renderApps(activeRoot, activeHost, await activeHost.getApps());
  } catch (error) {
    setFrameworkStatus(false, "");
    activeRoot.innerHTML = '<div class="empty-state">Settings is temporarily unavailable.</div>';
  }
}

export const appsExtension = {
  id: "apps",
  mount(root, host) {
    activeRoot = root;
    activeHost = host;
    void refresh();
    refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    return {
      refresh,
      dispose() {
        clearInterval(refreshTimer);
        refreshTimer = 0;
        activeRoot = null;
        activeHost = null;
      },
    };
  },
};
