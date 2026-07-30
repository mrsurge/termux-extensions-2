import { EXPLORER_RPC_METHODS } from "../../../src/explorer/rpc/contract.ts";
import { createJsonTextmateField } from "./cm6-json-textmate-field.ts";

interface RawSettingsJsonField {
  getValue: () => string;
  setValue: (value: string) => void;
}

function createRawSettingsJsonField(
  textarea: HTMLTextAreaElement,
): RawSettingsJsonField {
  const rows = Number(textarea.rows) || 6;
  const editor = createJsonTextmateField({
    value: textarea.value,
    rows,
    placeholder: textarea.placeholder,
    validateJson: true,
    className: "settings-raw-json-field",
    onChange(raw) {
      textarea.value = raw;
    },
  });

  // Languages & Extensions keeps the textarea as the stable DOM/form anchor;
  // the mounted CM6 field is the visible editor.
  textarea.style.display = "none";
  textarea.setAttribute("aria-hidden", "true");
  textarea.tabIndex = -1;
  textarea.insertAdjacentElement("afterend", editor.element);

  return {
    getValue: () => editor.getValue(),
    setValue(value: string) {
      textarea.value = value;
      editor.setValue(value);
    },
  };
}

/**
 * @param {{
 *   getEditorViewState: () => any,
 *   getUiPrefs: () => Record<string, unknown>,
 *   settingsModalEl: HTMLElement,
 *   themeSummaryEl: HTMLElement,
 *   extSummaryEl: HTMLElement,
 *   customSettingsInputEl: HTMLTextAreaElement,
 *   customSettingsSaveEl: HTMLButtonElement,
 *   extManagerModalEl: HTMLElement,
 *   busRequest: (event: string, payload?: any, timeoutMs?: number) => Promise<any>,
 *   busNotify: (event: string, payload?: any) => void,
 *   requestLanguageBackendSet: (mode: "code-server" | "web-workers") => Promise<any>,
 *   toast: (msg: string, ms?: number) => void,
 *   reloadEditorFrame: () => void
 * }} deps
 */
export function createSettingsRefreshController(deps: any) {
  // ── Scope tab switching ──
  let activeScope = "user";
  const extManagerModalEl = deps.extManagerModalEl as HTMLElement;
  const customSettingsField = createRawSettingsJsonField(
    deps.customSettingsInputEl,
  );
  const workspaceSettingsInputEl = extManagerModalEl.querySelector(
    "#editor-ext-workspace-settings-input",
  ) as HTMLTextAreaElement | null;
  const workspaceSettingsField: RawSettingsJsonField | null =
    workspaceSettingsInputEl
      ? createRawSettingsJsonField(workspaceSettingsInputEl)
      : null;

  function installScopeTabs() {
    const tabs = extManagerModalEl.querySelectorAll<HTMLElement>(
      "#settings-scope-tabs .settings-scope-tab",
    );
    const userPane = extManagerModalEl.querySelector<HTMLElement>("#settings-scope-user");
    const wsPane = extManagerModalEl.querySelector<HTMLElement>("#settings-scope-workspace");
    const modal = extManagerModalEl;
    if (!tabs.length || !userPane || !wsPane || !modal) return;

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const scope = tab.dataset.scope || "user";
        if (scope === activeScope) return;
        activeScope = scope;

        tabs.forEach((t) => {
          const isActive = t.dataset.scope === scope;
          t.classList.toggle("active", isActive);
          t.style.borderBottomColor = isActive
            ? "var(--fe-accent, #58a6ff)"
            : "transparent";
          t.style.color = isActive
            ? "var(--fg, #e6edf3)"
            : "var(--fg-dim, #6e7681)";
        });

        userPane.style.display = scope === "user" ? "" : "none";
        wsPane.style.display = scope === "workspace" ? "" : "none";

        // Toggle workspace class on modal to hide toggle/uninstall/install via CSS
        modal.classList.toggle("ext-scope-workspace", scope === "workspace");

        if (scope === "workspace") loadWorkspaceSettings();
      });
    });
  }

  // ── User settings (existing) ──
  async function loadCustomSettings() {
    try {
      const res = await deps.busRequest(
        EXPLORER_RPC_METHODS.extensionsCustomSettingsGet,
        {},
        8000,
      );
      const settings = res?.settings || {};
      const keys = Object.keys(settings);
      customSettingsField.setValue(
        keys.length ? JSON.stringify(settings, null, 2) : "",
      );
    } catch (_) {
      customSettingsField.setValue("");
    }
  }

  // ── Workspace settings ──
  async function loadWorkspaceSettings() {
    if (!workspaceSettingsField) return;
    try {
      const res = await deps.busRequest(
        EXPLORER_RPC_METHODS.extensionsWorkspaceSettingsGet,
        {},
        8000,
      );
      const settings = res?.settings || {};
      const keys = Object.keys(settings);
      workspaceSettingsField.setValue(
        keys.length ? JSON.stringify(settings, null, 2) : "",
      );
    } catch (_) {
      workspaceSettingsField.setValue("");
    }
  }

  function installWorkspaceSettingsSaveHandler() {
    const saveBtn = extManagerModalEl.querySelector(
      "#editor-ext-workspace-settings-save",
    ) as HTMLButtonElement | null;
    if (!saveBtn || !workspaceSettingsField) return;

    saveBtn.addEventListener("click", async () => {
      const raw = workspaceSettingsField.getValue().trim();
      let parsed = {};
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          deps.toast("Invalid JSON: " + (e as { message?: string }).message);
          return;
        }
        if (typeof parsed !== "object" || Array.isArray(parsed)) {
          deps.toast("Settings must be a JSON object");
          return;
        }
      }
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      try {
        const res = await deps.busRequest(
          EXPLORER_RPC_METHODS.extensionsWorkspaceSettingsSet,
          { settings: parsed },
          15000,
        );
        if (res?.ok) {
          deps.toast(
            `Workspace settings saved (${res.count} keys) — reloading adapter…`,
          );
          deps.reloadEditorFrame();
        } else {
          deps.toast(res?.error || "Save failed");
        }
      } catch (e) {
        deps.toast((e as { message?: string })?.message || "Save failed");
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
      }
    });
  }

  async function refreshEditorSettingsModal() {
    const languageBackendSummary = deps.settingsModalEl.querySelector(
      "#editor-settings-language-backend-summary",
    ) as HTMLElement | null;
    const languageBackendAction = deps.settingsModalEl.querySelector(
      "#editor-settings-language-backend-action",
    ) as HTMLButtonElement | null;
    const webWorkersEnabled = deps.getUiPrefs()?.webWorkersEnabled === true;
    if (languageBackendSummary) {
      languageBackendSummary.textContent = webWorkersEnabled
        ? "Active: Monaco language web workers"
        : "Active: TE2-managed Code Server 4.130.0";
    }
    if (languageBackendAction) {
      languageBackendAction.textContent = webWorkersEnabled
        ? "Switch to Code Server"
        : "Switch to Monaco Web Workers";
      languageBackendAction.dataset.targetMode = webWorkersEnabled
        ? "code-server"
        : "web-workers";
    }

    const currentTheme =
      deps.getEditorViewState()?.theme || "github-dark-default";
    try {
      const res = await fetch(
        "/api/app/file_editor_cm6/ui/monaco_editor/available_themes",
        { cache: "no-store" },
      );
      if (res.ok) {
        const data = await res.json();
        const themes = data?.themes || [];
        const active = themes.find((t: any) => t.id === currentTheme);
        const label = active ? active.label : currentTheme;
        deps.themeSummaryEl.textContent = `${label} — ${themes.length} available`;
      } else {
        deps.themeSummaryEl.textContent = currentTheme;
      }
    } catch (_) {
      deps.themeSummaryEl.textContent = currentTheme;
    }

    try {
      if (typeof deps.busRequest === "function") {
        const res = await deps.busRequest(
          EXPLORER_RPC_METHODS.extensionsList,
          {},
          8000,
        );
        const exts = res?.extensions || [];
        const active = exts.filter((e: any) => e.active);
        const user = exts.filter((e: any) => e.source === "user");
        deps.extSummaryEl.textContent = `${active.length} active, ${user.length} user-installed, ${exts.length} total`;
      }
    } catch (_) {
      deps.extSummaryEl.textContent = "Click to manage";
    }

    try {
      if (typeof deps.busNotify === "function") {
        deps.busNotify(EXPLORER_RPC_METHODS.watcherConfigGet, {});
      }
    } catch (_) {}
  }

  function installCustomSettingsSaveHandler() {
    deps.customSettingsSaveEl.addEventListener("click", async () => {
      const raw = customSettingsField.getValue().trim();
      let parsed = {};
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          deps.toast("Invalid JSON: " + (e as { message?: string }).message);
          return;
        }
        if (typeof parsed !== "object" || Array.isArray(parsed)) {
          deps.toast("Settings must be a JSON object");
          return;
        }
      }
      deps.customSettingsSaveEl.disabled = true;
      deps.customSettingsSaveEl.textContent = "Saving…";
      try {
        const res = await deps.busRequest(
          EXPLORER_RPC_METHODS.extensionsCustomSettingsSet,
          { settings: parsed },
          15000,
        );
        if (res?.ok) {
          deps.toast(
            `Custom settings saved (${res.count} keys) — reloading adapter…`,
          );
          deps.reloadEditorFrame();
        } else {
          deps.toast(res?.error || "Save failed");
        }
      } catch (e) {
        deps.toast((e as { message?: string })?.message || "Save failed");
      } finally {
        deps.customSettingsSaveEl.disabled = false;
        deps.customSettingsSaveEl.textContent = "Save";
      }
    });
  }

  function installLanguageBackendPreference() {
    const action = deps.settingsModalEl.querySelector(
      "#editor-settings-language-backend-action",
    ) as HTMLButtonElement | null;
    if (!action) return;
    action.addEventListener("click", async () => {
      const targetMode = action.dataset.targetMode === "code-server"
        ? "code-server"
        : "web-workers";
      const idleLabel = action.textContent || "Switch Language Backend";
      action.disabled = true;
      action.textContent = targetMode === "code-server"
        ? "Installing Code Server…"
        : "Removing Code Server…";
      try {
        const response = await deps.requestLanguageBackendSet(targetMode);
        if (!response || response.ok === false) {
          throw new Error(response?.error || "Language backend switch failed");
        }
        deps.toast(
          targetMode === "code-server"
            ? "TE2-managed Code Server enabled — reloading Code TE2."
            : "Monaco language web workers enabled — reloading Code TE2.",
        );
        deps.reloadEditorFrame();
      } catch (error) {
        deps.toast(
          (error as { message?: string })?.message || "Language backend switch failed",
          5000,
        );
        action.disabled = false;
        action.textContent = idleLabel;
      }
    });
  }

  return {
    loadCustomSettings,
    loadWorkspaceSettings,
    refreshEditorSettingsModal,
    installCustomSettingsSaveHandler,
    installWorkspaceSettingsSaveHandler,
    installScopeTabs,
    installLanguageBackendPreference,
    getActiveScope: () => activeScope,
  };
}
