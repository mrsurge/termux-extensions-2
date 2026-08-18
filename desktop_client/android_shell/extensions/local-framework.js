function actionLabel(state) {
  if (state.phase === "probing") return "Checking";
  if (state.phase === "starting") return "Starting";
  if (state.phase === "stopping") return "Stopping";
  return "Start Local";
}

function statusText(state) {
  if (state.phase === "running" && state.ownership === "electron") {
    return state.selected
      ? `Running locally at ${state.localOrigin}`
      : `Electron-owned TE2 is running at ${state.localOrigin}`;
  }
  if (state.phase === "running") {
    return state.selected
      ? `Using external TE2 at ${state.localOrigin}`
      : `External TE2 detected at ${state.localOrigin}`;
  }
  if (state.phase === "starting") return `Starting TE2 at ${state.localOrigin}`;
  if (state.phase === "stopping") return "Stopping the Electron-owned TE2 framework";
  if (state.phase === "probing") return `Checking ${state.localOrigin}`;
  if (state.phase === "failed") return state.error || "Local framework action failed";
  if (state.phase === "unavailable") {
    return state.error || "TE2 is not configured; set its command in Settings";
  }
  if (state.phase === "exited") return "The Electron-owned TE2 framework has stopped";
  return Array.isArray(state.broadcast) && state.broadcast.length > 0
    ? `Start TE2 at ${state.localOrigin} with configured broadcast exposure`
    : `Start a loopback-only TE2 framework at ${state.localOrigin}`;
}

function refreshLauncherSurfaces() {
  window.dispatchEvent(new CustomEvent("te2:launcher-refresh"));
}

export const localFrameworkExtension = {
  id: "local-framework",
  mount(root, host) {
    root.hidden = true;
    let state = null;
    let disposed = false;
    let actionPending = false;

    const runAction = async (operation) => {
      if (actionPending) return;
      actionPending = true;
      render();
      try {
        state = await operation();
        render();
        refreshLauncherSurfaces();
      } catch (error) {
        host.toast(error?.message || "Local framework action failed");
        await refresh();
      } finally {
        actionPending = false;
        render();
      }
    };

    const render = () => {
      if (disposed) return;
      root.replaceChildren();
      root.hidden = !state?.supported;
      if (!state?.supported) return;

      const card = document.createElement("article");
      card.className = "local-framework-card";
      card.dataset.phase = state.phase;

      const summary = document.createElement("div");
      summary.className = "local-framework-summary";
      const title = document.createElement("strong");
      title.textContent = "Local Framework";
      const status = document.createElement("span");
      status.className = "status-line";
      status.dataset.state = state.phase === "running"
        ? "online"
        : state.phase === "failed"
          ? "error"
          : "loading";
      status.textContent = statusText(state);
      summary.append(title, status);

      const details = document.createElement("div");
      details.className = "local-framework-details";
      const command = document.createElement("span");
      const source = state.commandSource === "detected"
        ? "PATH detection"
        : state.commandSource === "override"
          ? "source override"
          : "saved configuration";
      command.textContent = state.commandDetected
        ? `TE2 detected (${source}): ${state.command}`
        : "TE2 executable not detected";
      details.appendChild(command);
      if (state.venv) {
        const venv = document.createElement("span");
        venv.textContent = state.phase === "running" && state.ownership === "electron"
          ? `Virtual environment loaded: ${state.venvPath}`
          : `Virtual environment ready: ${state.venvPath}`;
        details.appendChild(venv);
      }
      if (Array.isArray(state.broadcast) && state.broadcast.length > 0) {
        const broadcast = document.createElement("span");
        broadcast.textContent = `Broadcast: ${state.broadcast.join(", ")}`;
        details.appendChild(broadcast);
      }
      summary.appendChild(details);

      const actions = document.createElement("div");
      actions.className = "local-framework-actions";
      const busy = actionPending || ["probing", "starting", "stopping"].includes(state.phase);

      if (state.phase === "running") {
        const useButton = document.createElement("button");
        useButton.type = "button";
        useButton.className = "primary-button";
        useButton.textContent = state.selected ? "In Use" : "Use Local";
        useButton.disabled = busy || state.selected;
        useButton.addEventListener("click", () => {
          void runAction(() => host.useLocalFramework());
        });
        actions.appendChild(useButton);

        if (state.ownership === "electron") {
          const stopButton = document.createElement("button");
          stopButton.type = "button";
          stopButton.className = "secondary-button";
          stopButton.textContent = "Stop";
          stopButton.disabled = busy;
          stopButton.addEventListener("click", () => {
            void runAction(() => host.stopLocalFramework());
          });
          actions.appendChild(stopButton);
        }
      } else {
        const startButton = document.createElement("button");
        startButton.type = "button";
        startButton.className = "primary-button";
        startButton.textContent = actionLabel(state);
        startButton.disabled = busy || !state.commandDetected || Boolean(state.error);
        startButton.addEventListener("click", () => {
          void runAction(() => host.startLocalFramework());
        });
        actions.appendChild(startButton);
      }

      card.append(summary, actions);
      root.appendChild(card);
    };

    const refresh = async () => {
      if (disposed) return;
      try {
        state = await host.getLocalFrameworkState();
        render();
      } catch (error) {
        host.toast(error?.message || "Local framework state is unavailable");
      }
    };

    const unsubscribe = host.onLocalFrameworkState((nextState) => {
      state = nextState;
      render();
    });
    void refresh();

    return {
      refresh,
      dispose() {
        disposed = true;
        unsubscribe?.();
        root.replaceChildren();
      },
    };
  },
};
