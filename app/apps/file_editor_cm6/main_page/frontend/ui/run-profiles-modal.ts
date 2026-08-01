import {
  createDeclarativeForm,
  createDeclarativeModalShell,
  type DeclarativeFormContract,
  type DeclarativeFormHandle,
} from "./declarative-modal.ts";
import {
  createJsonTextmateField,
  type JsonTextmateFieldHandle,
} from "./cm6-json-textmate-field.ts";

type UnknownRecord = Record<string, unknown>;

interface RunProfilesModalDeps {
  requestRunProfilesGet: () => Promise<unknown>;
  requestRunProfilesSave: (payload: UnknownRecord) => Promise<unknown>;
  toast: (msg: string) => void;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function asProfiles(value: unknown): UnknownRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    saveDrafts: "included",
    showSaveWarning: true,
    devTools: false,
    ...item,
  }));
}

function profileId(profile: UnknownRecord, fallback: string): string {
  const value = profile.profileId || profile.profile_id;
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function defaultProfile(index: number): UnknownRecord {
  return {
    profileId: `custom-${index + 1}`,
    runner: "custom",
    include: [],
    exec: "",
    entry: "",
    args: [],
    cwd: "",
    env: {},
    sidebarUrl: "",
    runningBehavior: "just save",
    saveDrafts: "included",
    showSaveWarning: true,
    devTools: false,
  };
}

function configFromJson(value: unknown): UnknownRecord {
  if (Array.isArray(value)) {
    return { version: 1, profiles: asProfiles(value) };
  }
  if (!isRecord(value)) {
    return { version: 1, profiles: [] };
  }
  if (value.profileId || value.profile_id) {
    return { version: 1, profiles: [{ ...value }] };
  }
  return {
    ...value,
    version: typeof value.version === "number" ? value.version : 1,
    profiles: asProfiles(value.profiles),
  };
}

function configFromProfiles(
  baseConfig: UnknownRecord,
  profiles: UnknownRecord[],
): UnknownRecord {
  return {
    ...baseConfig,
    version: 1,
    profiles: profiles.map((profile) => ({ ...profile })),
  };
}

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizeResponse(result: unknown): UnknownRecord {
  const outer = asRecord(result);
  return asRecord(outer.data || outer);
}

function contractFromResponse(data: UnknownRecord): DeclarativeFormContract {
  const contract = asRecord(data.profileContract);
  const fields = Array.isArray(contract.fields) ? contract.fields : [];
  return {
    fields: fields.filter(
      isRecord,
    ) as unknown as DeclarativeFormContract["fields"],
  };
}

export function createRunProfilesModalController(deps: RunProfilesModalDeps) {
  let shell: ReturnType<typeof createDeclarativeModalShell> | null = null;
  let listEl: HTMLElement | null = null;
  let formEl: HTMLElement | null = null;
  let emptyEl: HTMLElement | null = null;
  let rawJsonEditor: JsonTextmateFieldHandle | null = null;
  let pathEl: HTMLElement | null = null;
  let saveBtn: HTMLButtonElement | null = null;
  let formHandle: DeclarativeFormHandle | null = null;
  let contract: DeclarativeFormContract = { fields: [] };
  let config: UnknownRecord = { version: 1, profiles: [] };
  let profiles: UnknownRecord[] = [];
  let selectedIndex = -1;

  function ensureShell(): void {
    if (shell) return;
    shell = createDeclarativeModalShell({
      id: "run-profiles-modal",
      surfaceId: "code-te2.run-profiles",
      title: "Run Profiles",
      width: "min(940px, 94vw)",
      maxHeight: "min(86vh, 900px)",
      fields: [],
    });

    const meta = document.createElement("div");
    meta.className = "run-profiles-meta";
    pathEl = meta;
    shell.bodyEl.appendChild(meta);

    const layout = document.createElement("div");
    layout.className = "run-profiles-layout";

    const listPane = document.createElement("div");
    listPane.className = "run-profiles-list";
    const listActions = document.createElement("div");
    listActions.className = "run-profiles-actions";

    const addBtn = document.createElement("button");
    addBtn.className = "fe-btn";
    addBtn.type = "button";
    addBtn.textContent = "Add";
    addBtn.addEventListener("click", () => addProfile());
    listActions.appendChild(addBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "fe-btn";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => deleteSelectedProfile());
    listActions.appendChild(deleteBtn);

    listEl = document.createElement("div");
    listEl.className = "run-profiles-list-items";
    listPane.appendChild(listActions);
    listPane.appendChild(listEl);

    const editorPane = document.createElement("div");
    editorPane.className = "run-profiles-editor";
    emptyEl = document.createElement("div");
    emptyEl.className = "run-profiles-meta";
    emptyEl.textContent =
      "Add a profile to edit run behavior for included files.";
    formEl = document.createElement("div");

    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Raw JSON";
    details.appendChild(summary);
    rawJsonEditor = createJsonTextmateField({
      value: "",
      rows: 10,
      className: "run-profiles-json",
      validateJson: true,
    });
    details.appendChild(rawJsonEditor.element);

    const applyRawBtn = document.createElement("button");
    applyRawBtn.className = "fe-btn";
    applyRawBtn.type = "button";
    applyRawBtn.textContent = "Apply JSON";
    applyRawBtn.addEventListener("click", () => applyRawJson());
    details.appendChild(applyRawBtn);

    editorPane.appendChild(emptyEl);
    editorPane.appendChild(formEl);
    editorPane.appendChild(details);
    layout.appendChild(listPane);
    layout.appendChild(editorPane);
    shell.bodyEl.appendChild(layout);

    const reloadBtn = document.createElement("button");
    reloadBtn.className = "fe-btn";
    reloadBtn.type = "button";
    reloadBtn.textContent = "Reload";
    reloadBtn.addEventListener("click", () => void open());
    shell.footerEl.appendChild(reloadBtn);

    const closeBtn = document.createElement("button");
    closeBtn.className = "fe-btn";
    closeBtn.type = "button";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", () => shell?.close());
    shell.footerEl.appendChild(closeBtn);

    saveBtn = document.createElement("button");
    saveBtn.className = "fe-btn fe-btn-primary";
    saveBtn.type = "button";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => void save());
    shell.footerEl.appendChild(saveBtn);
  }

  function renderProfileList(): void {
    if (!listEl) return;
    listEl.innerHTML = "";
    profiles.forEach((profile, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "run-profiles-list-item";
      item.classList.toggle("is-active", index === selectedIndex);
      const name = document.createElement("span");
      name.textContent = profileId(profile, `Profile ${index + 1}`);
      const runner = document.createElement("span");
      runner.className = "run-profiles-meta";
      runner.textContent =
        typeof profile.runner === "string" ? profile.runner : "";
      item.appendChild(name);
      item.appendChild(runner);
      item.addEventListener("click", () => selectProfile(index));
      listEl?.appendChild(item);
    });
  }

  function renderForm(): void {
    formHandle?.destroy();
    formHandle = null;
    if (!formEl || !emptyEl) return;
    const profile = profiles[selectedIndex];
    const hasProfile = isRecord(profile);
    formEl.style.display = hasProfile ? "" : "none";
    emptyEl.style.display = hasProfile ? "none" : "";
    if (!hasProfile) return;
    formHandle = createDeclarativeForm(formEl, contract, profile, {
      onChange(values) {
        profiles[selectedIndex] = values;
        syncRawJson();
        renderProfileList();
      },
    });
  }

  function syncRawJson(): void {
    config = configFromProfiles(config, profiles);
    rawJsonEditor?.setValue(formatJson(config));
  }

  function selectProfile(index: number): void {
    selectedIndex = index >= 0 && index < profiles.length ? index : -1;
    renderProfileList();
    renderForm();
  }

  function addProfile(): void {
    profiles.push(defaultProfile(profiles.length));
    selectProfile(profiles.length - 1);
    syncRawJson();
  }

  function deleteSelectedProfile(): void {
    if (selectedIndex < 0 || selectedIndex >= profiles.length) return;
    profiles.splice(selectedIndex, 1);
    selectProfile(Math.min(selectedIndex, profiles.length - 1));
    syncRawJson();
  }

  function applyRawJson(): void {
    if (!rawJsonEditor) return;
    try {
      const decoded = JSON.parse(rawJsonEditor.getValue() || "[]") as unknown;
      config = configFromJson(decoded);
      profiles = asProfiles(config.profiles);
      selectProfile(profiles.length ? 0 : -1);
      syncRawJson();
    } catch (error) {
      deps.toast((error as { message?: string })?.message || "Invalid JSON");
    }
  }

  async function open(): Promise<void> {
    ensureShell();
    shell?.open();
    if (pathEl) pathEl.textContent = "Loading run profiles...";
    try {
      const result = await deps.requestRunProfilesGet();
      const outer = asRecord(result);
      if (outer.ok === false) {
        deps.toast(
          typeof outer.error === "string"
            ? outer.error
            : "Failed to load run profiles",
        );
        if (pathEl) pathEl.textContent = "Failed to load run profiles";
        return;
      }
      const data = normalizeResponse(result);
      const error = data.validationError;
      contract = contractFromResponse(data);
      profiles = asProfiles(data.profiles);
      try {
        const rawConfig = typeof data.rawJson === "string"
          ? JSON.parse(data.rawJson) as unknown
          : { version: 1, profiles };
        config = configFromProfiles(configFromJson(rawConfig), profiles);
      } catch {
        config = configFromProfiles({ version: 1, profiles: [] }, profiles);
      }
      selectedIndex = profiles.length ? 0 : -1;
      if (pathEl) {
        const configPath =
          typeof data.configPath === "string"
            ? data.configPath
            : ".code_te2/run_profiles.json";
        pathEl.textContent = error
          ? `${configPath} - ${String(error)}`
          : configPath;
      }
      if (rawJsonEditor)
        rawJsonEditor.setValue(
          typeof data.rawJson === "string"
            ? data.rawJson
            : formatJson(config),
        );
      renderProfileList();
      renderForm();
    } catch (error) {
      deps.toast(
        (error as { message?: string })?.message ||
          "Failed to load run profiles",
      );
      if (pathEl) pathEl.textContent = "Failed to load run profiles";
    }
  }

  async function save(): Promise<void> {
    if (!rawJsonEditor || !saveBtn) return;
    saveBtn.disabled = true;
    try {
      const result = await deps.requestRunProfilesSave({
        rawJson: rawJsonEditor.getValue(),
      });
      const outer = asRecord(result);
      if (outer.ok === false) {
        deps.toast(
          typeof outer.error === "string"
            ? outer.error
            : "Run profile save failed",
        );
        return;
      }
      const data = normalizeResponse(result);
      contract = contractFromResponse(data);
      profiles = asProfiles(data.profiles);
      try {
        const rawConfig = typeof data.rawJson === "string"
          ? JSON.parse(data.rawJson) as unknown
          : { version: 1, profiles };
        config = configFromProfiles(configFromJson(rawConfig), profiles);
      } catch {
        config = configFromProfiles({ version: 1, profiles: [] }, profiles);
      }
      selectedIndex = profiles.length
        ? Math.min(Math.max(selectedIndex, 0), profiles.length - 1)
        : -1;
      if (pathEl && typeof data.configPath === "string")
        pathEl.textContent = data.configPath;
      if (rawJsonEditor && typeof data.rawJson === "string")
        rawJsonEditor.setValue(data.rawJson);
      renderProfileList();
      renderForm();
      deps.toast("Run profiles saved");
    } catch (error) {
      deps.toast(
        (error as { message?: string })?.message || "Run profile save failed",
      );
    } finally {
      saveBtn.disabled = false;
    }
  }

  return {
    open,
  };
}
