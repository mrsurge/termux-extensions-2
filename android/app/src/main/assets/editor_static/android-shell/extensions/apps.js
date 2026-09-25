function setFrameworkStatus(online, frameworkBaseUrl) {
  const status = document.querySelector("#framework-status");
  if (!status) return;
  status.dataset.state = online ? "online" : "offline";
  status.textContent = online ? `Connected to ${frameworkBaseUrl}` : "Framework offline";
}

function resolveIcon(app) {
  const source = typeof app.icon_src === "string" ? app.icon_src.trim() : "";
  if (source) return { source, text: "" };
  const text = String(app.icon_emoji || app.icon_text || "").trim();
  return { source: "", text };
}

let activeCardMenu = null;

function closeActiveCardMenu() {
  if (!activeCardMenu) return;
  activeCardMenu.dataset.open = "false";
  activeCardMenu = null;
}

function clampMenuOffset(value, min, max) {
  if (!Number.isFinite(value) || max <= min) return min;
  return Math.max(min, Math.min(max, value));
}

function renderApps(root, host, payload) {
  const apps = Array.isArray(payload?.apps) ? payload.apps : [];
  setFrameworkStatus(!!payload?.online, payload?.frameworkBaseUrl || "framework");

  closeActiveCardMenu();
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
        window.location.assign(result.url);
      } catch (error) {
        host.toast(error?.message || "Failed to open app");
        launch.disabled = false;
      }
    });

    card.appendChild(launch);
    if (app.running && !app.local) {
      let longPressTimer = 0;
      let suppressClickUntil = 0;
      let pointerId = null;
      let startX = 0;
      let startY = 0;

      const menuGroup = document.createElement("div");
      menuGroup.className = "app-card-menu-group";
      menuGroup.dataset.open = "false";

      const menu = document.createElement("div");
      menu.className = "app-card-menu";
      menu.setAttribute("role", "menu");

      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "app-card-menu-close";
      closeButton.setAttribute("role", "menuitem");
      closeButton.setAttribute("aria-label", `Close ${app.name || app.id}`);
      closeButton.innerHTML = `
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M3 3l10 10M13 3L3 13"></path>
        </svg>
        <span>Close</span>
      `;

      const openCardMenu = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const rect = card.getBoundingClientRect();
        const localX = typeof event?.clientX === "number"
          ? event.clientX - rect.left
          : rect.width - 20;
        const localY = typeof event?.clientY === "number"
          ? event.clientY - rect.top
          : 18;
        closeActiveCardMenu();
        menu.style.left = `${clampMenuOffset(localX, 8, rect.width - 116)}px`;
        menu.style.top = `${clampMenuOffset(localY, 8, rect.height - 44)}px`;
        menuGroup.dataset.open = "true";
        activeCardMenu = menuGroup;
        suppressClickUntil = Date.now() + 900;
        closeButton.focus({ preventScroll: true });
      };

      closeButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeButton.disabled = true;
        try {
          await host.quitApp(app.id);
          closeActiveCardMenu();
          await refresh();
        } catch (error) {
          host.toast(error?.message || "Failed to quit app");
          closeButton.disabled = false;
        }
      });

      card.addEventListener("contextmenu", openCardMenu);
      card.addEventListener("pointerdown", (event) => {
        if (event.pointerType !== "touch") return;
        pointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        longPressTimer = window.setTimeout(() => openCardMenu(event), 520);
      });
      card.addEventListener("pointermove", (event) => {
        if (event.pointerId !== pointerId || !longPressTimer) return;
        if (
          Math.abs(event.clientX - startX) > 8
          || Math.abs(event.clientY - startY) > 8
        ) {
          clearTimeout(longPressTimer);
          longPressTimer = 0;
        }
      });
      const clearLongPress = (event) => {
        if (pointerId !== null && event.pointerId !== pointerId) return;
        clearTimeout(longPressTimer);
        longPressTimer = 0;
        pointerId = null;
      };
      card.addEventListener("pointerup", clearLongPress);
      card.addEventListener("pointercancel", clearLongPress);
      launch.addEventListener("click", (event) => {
        if (Date.now() >= suppressClickUntil) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressClickUntil = 0;
      }, { capture: true });

      menu.appendChild(closeButton);
      menuGroup.appendChild(menu);
      card.appendChild(menuGroup);
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
    const closeMenuOnPointerDown = (event) => {
      if (!activeCardMenu || activeCardMenu.contains(event.target)) return;
      closeActiveCardMenu();
    };
    const closeMenuOnKeyDown = (event) => {
      if (event.key === "Escape") closeActiveCardMenu();
    };
    document.addEventListener("pointerdown", closeMenuOnPointerDown);
    document.addEventListener("keydown", closeMenuOnKeyDown);
    return {
      refresh,
      dispose() {
        document.removeEventListener("pointerdown", closeMenuOnPointerDown);
        document.removeEventListener("keydown", closeMenuOnKeyDown);
        closeActiveCardMenu();
        clearInterval(refreshTimer);
        refreshTimer = 0;
        activeRoot = null;
        activeHost = null;
      },
    };
  },
};
