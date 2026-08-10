import {
  EXTENSION_ACTIVITY_EVENT,
  EXTENSION_ACTIVITY_READY_EVENT,
  requestExtensionActivity,
} from "../connections/extension-activity-bridge.ts";

interface ExtensionActivity {
  id: number;
  ts_ms: number;
  extensionId: string;
  kind: string;
  severity: "info" | "warning" | "error";
  message: string;
  detail?: string;
}

interface ExtensionStatusEntry {
  entryId: string;
  extensionId: string;
  name: string;
  text: string;
  tooltip: string | null;
  alignLeft: boolean;
  priority: number | null;
  accessibilityLabel: string | null;
}

interface ExtensionLogChannel {
  id: string;
  extensionId: string;
  label: string;
  kind: "output" | "logger";
}

interface ExtensionCatalogItem {
  id: string;
  label: string;
}

interface ExtensionActivitySnapshot {
  extensions?: ExtensionCatalogItem[];
  activities?: ExtensionActivity[];
  statusEntries?: ExtensionStatusEntry[];
  channels?: ExtensionLogChannel[];
}

interface ExtensionActivityPanelDeps {
  openDrawer(): void;
  closeDrawer(): void;
}

interface ListboxOption {
  value: string;
  label: string;
}

interface ListboxControl {
  setOptions(options: ListboxOption[], value: string): void;
  destroy(): void;
}

export interface ExtensionActivityPanelController {
  show(): void;
  hide(): void;
  open(extensionId?: string): void;
  destroy(): void;
}

const MAX_ACTIVITY_ITEMS = 500;
const MAX_RENDERED_LOG_CHARS = 512 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function snapshotFromReply(value: unknown): ExtensionActivitySnapshot {
  if (!isRecord(value)) return {};
  return isRecord(value.result)
    ? (value.result as ExtensionActivitySnapshot)
    : (value as ExtensionActivitySnapshot);
}

function eventDetail(event: Event): Record<string, unknown> {
  return event instanceof CustomEvent && isRecord(event.detail)
    ? event.detail
    : {};
}

function statusTextParts(
  container: HTMLElement,
  text: string,
): void {
  container.replaceChildren();
  const pattern = /\$\(([-a-z0-9]+)(?:~[-a-z0-9]+)?\)/gi;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > offset) {
      container.append(document.createTextNode(text.slice(offset, index)));
    }
    const icon = document.createElement("span");
    icon.className = `codicon codicon-${match[1]}`;
    icon.setAttribute("aria-hidden", "true");
    container.append(icon);
    offset = index + match[0].length;
  }
  if (offset < text.length) {
    container.append(document.createTextNode(text.slice(offset)));
  }
}

function formatActivityTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function nearBottom(element: HTMLElement): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight < 48
  );
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing extension activity element: #${id}`);
  }
  return element as T;
}

function closeExtensionListboxes(except?: HTMLElement): void {
  document
    .querySelectorAll<HTMLElement>(".extension-log-filter-menu.show")
    .forEach((menu) => {
      if (menu === except) return;
      menu.classList.remove("show");
      const toggle = document.querySelector<HTMLElement>(
        `[aria-controls="${menu.id}"]`,
      );
      toggle?.setAttribute("aria-expanded", "false");
    });
}

function createListboxControl(
  toggle: HTMLButtonElement,
  menu: HTMLElement,
  onSelect: (value: string) => void,
): ListboxControl {
  let options: ListboxOption[] = [];
  let value = "";

  const close = (restoreFocus = false) => {
    menu.classList.remove("show");
    toggle.setAttribute("aria-expanded", "false");
    if (restoreFocus) toggle.focus();
  };

  const focusOption = (index: number) => {
    const items = [...menu.querySelectorAll<HTMLElement>('[role="option"]')];
    if (!items.length) return;
    items[Math.max(0, Math.min(index, items.length - 1))]?.focus();
  };

  const open = (focusSelected = false) => {
    closeExtensionListboxes(menu);
    menu.classList.add("show");
    toggle.setAttribute("aria-expanded", "true");
    if (!focusSelected) return;
    const selectedIndex = Math.max(
      0,
      options.findIndex((option) => option.value === value),
    );
    queueMicrotask(() => focusOption(selectedIndex));
  };

  const select = (nextValue: string) => {
    if (!options.some((option) => option.value === nextValue)) return;
    value = nextValue;
    render();
    close(true);
    onSelect(nextValue);
  };

  const render = () => {
    const active =
      options.find((option) => option.value === value) ?? options[0];
    if (active) {
      value = active.value;
      toggle.textContent = active.label;
      toggle.title = active.label;
    } else {
      value = "";
      toggle.textContent = "";
      toggle.removeAttribute("title");
    }
    menu.replaceChildren(
      ...options.map((option) => {
        const item = document.createElement("div");
        item.className = "fe-dd-item";
        item.dataset.checkable = "true";
        item.dataset.value = option.value;
        item.setAttribute("role", "option");
        item.setAttribute(
          "aria-selected",
          option.value === value ? "true" : "false",
        );
        item.tabIndex = -1;
        item.textContent = option.label;
        item.title = option.label;
        item.classList.toggle(
          "fe-menu-item-checked",
          option.value === value,
        );
        item.addEventListener("click", (event) => {
          event.stopPropagation();
          select(option.value);
        });
        return item;
      }),
    );
  };

  const toggleClick = (event: MouseEvent) => {
    event.stopPropagation();
    if (menu.classList.contains("show")) close();
    else open();
  };
  const toggleKeydown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    open(true);
  };
  const menuKeydown = (event: KeyboardEvent) => {
    const items = [...menu.querySelectorAll<HTMLElement>('[role="option"]')];
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = current < 0
        ? 0
        : (current + delta + items.length) % items.length;
      focusOption(next);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusOption(event.key === "Home" ? 0 : items.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const item = items[current];
      if (item?.dataset.value !== undefined) select(item.dataset.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      close();
    }
  };
  const outsideClick = (event: MouseEvent) => {
    if (
      event.target instanceof Node &&
      event.target !== toggle &&
      !menu.contains(event.target)
    ) {
      close();
    }
  };

  toggle.addEventListener("click", toggleClick);
  toggle.addEventListener("keydown", toggleKeydown);
  menu.addEventListener("keydown", menuKeydown);
  document.addEventListener("click", outsideClick);

  return {
    setOptions(nextOptions, nextValue) {
      options = nextOptions;
      value = nextValue;
      render();
    },
    destroy() {
      toggle.removeEventListener("click", toggleClick);
      toggle.removeEventListener("keydown", toggleKeydown);
      menu.removeEventListener("keydown", menuKeydown);
      document.removeEventListener("click", outsideClick);
    },
  };
}

export function createExtensionActivityPanel(
  deps: ExtensionActivityPanelDeps,
): ExtensionActivityPanelController {
  const panel = requireElement<HTMLElement>("extension-log-container");
  const header = requireElement<HTMLElement>("extension-log-header");
  const extensionFilterToggle = requireElement<HTMLButtonElement>(
    "extension-log-extension-filter",
  );
  const extensionFilterMenu = requireElement<HTMLElement>(
    "extension-log-extension-menu",
  );
  const channelFilterToggle = requireElement<HTMLButtonElement>(
    "extension-log-channel-filter",
  );
  const channelFilterMenu = requireElement<HTMLElement>(
    "extension-log-channel-menu",
  );
  const clearButton = requireElement<HTMLButtonElement>("extension-log-clear");
  const collapseButton = requireElement<HTMLButtonElement>(
    "extension-log-collapse",
  );
  const statusBar = requireElement<HTMLElement>("extension-statusbar");
  const statusLeft = requireElement<HTMLElement>("extension-status-left");
  const statusRight = requireElement<HTMLElement>("extension-status-right");
  const healthButton = requireElement<HTMLButtonElement>(
    "extension-status-health",
  );
  const logOutput = requireElement<HTMLElement>("extension-log-output");
  const activityList = requireElement<HTMLElement>("extension-activity-list");
  const emptyState = requireElement<HTMLElement>("extension-log-empty");

  let extensions: ExtensionCatalogItem[] = [];
  let activities: ExtensionActivity[] = [];
  let statusEntries: ExtensionStatusEntry[] = [];
  let channels: ExtensionLogChannel[] = [];
  let selectedExtension = "";
  let selectedChannel = "";
  let destroyed = false;
  let refreshGeneration = 0;
  const extensionFilter = createListboxControl(
    extensionFilterToggle,
    extensionFilterMenu,
    (nextValue) => {
      selectedExtension = nextValue;
      selectedChannel = "";
      renderChannelFilter();
      renderActivities();
      showSelectedView();
    },
  );
  const channelFilter = createListboxControl(
    channelFilterToggle,
    channelFilterMenu,
    (nextValue) => {
      void selectChannel(nextValue);
    },
  );

  function extensionLabel(extensionId: string): string {
    return (
      extensions.find((entry) => entry.id === extensionId)?.label ??
      extensionId
    );
  }

  function filteredActivities(): ExtensionActivity[] {
    if (!selectedExtension) return activities;
    return activities.filter(
      (activity) => activity.extensionId === selectedExtension,
    );
  }

  function filteredChannels(): ExtensionLogChannel[] {
    if (!selectedExtension) return channels;
    return channels.filter(
      (channel) => channel.extensionId === selectedExtension,
    );
  }

  function renderExtensionFilter(): void {
    const ids = new Map<string, string>();
    for (const entry of extensions) ids.set(entry.id, entry.label);
    for (const activity of activities) {
      if (!ids.has(activity.extensionId)) {
        ids.set(activity.extensionId, activity.extensionId);
      }
    }
    for (const channel of channels) {
      if (!ids.has(channel.extensionId)) {
        ids.set(channel.extensionId, channel.extensionId);
      }
    }
    for (const entry of statusEntries) {
      if (!ids.has(entry.extensionId)) {
        ids.set(entry.extensionId, entry.extensionId);
      }
    }

    const options = [
      { value: "", label: "All extensions" },
      ...[...ids.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
    ];
    selectedExtension = ids.has(selectedExtension)
      ? selectedExtension
      : "";
    extensionFilter.setOptions(options, selectedExtension);
  }

  function renderChannelFilter(): void {
    const available = filteredChannels();
    const options = [{ value: "", label: "Activity" }, ...available.map(
      (channel) => ({
        value: channel.id,
        label: `${channel.label} (${channel.kind})`,
      }),
    )];
    if (!available.some((channel) => channel.id === selectedChannel)) {
      selectedChannel = "";
    }
    channelFilter.setOptions(options, selectedChannel);
  }

  function renderActivities(): void {
    const visible = filteredActivities();
    activityList.replaceChildren();
    for (const activity of visible.slice().reverse()) {
      const row = document.createElement("article");
      row.className = `extension-activity-row severity-${activity.severity}`;

      const meta = document.createElement("div");
      meta.className = "extension-activity-meta";
      const extension = document.createElement("span");
      extension.className = "extension-activity-extension";
      extension.textContent = extensionLabel(activity.extensionId);
      const time = document.createElement("time");
      time.dateTime = new Date(activity.ts_ms).toISOString();
      time.textContent = formatActivityTime(activity.ts_ms);
      meta.append(extension, time);

      const message = document.createElement("div");
      message.className = "extension-activity-message";
      message.textContent = activity.message;
      row.append(meta, message);
      if (activity.detail) {
        const detail = document.createElement("pre");
        detail.className = "extension-activity-detail";
        detail.textContent = activity.detail;
        row.append(detail);
      }
      activityList.append(row);
    }
    emptyState.hidden = visible.length > 0;
  }

  function renderStatusBar(): void {
    const leftEntries = statusEntries.filter((entry) => entry.alignLeft);
    const rightEntries = statusEntries
      .filter((entry) => !entry.alignLeft)
      .slice()
      .reverse();
    const renderEntries = (
      container: HTMLElement,
      entries: ExtensionStatusEntry[],
    ) => {
      container.replaceChildren();
      for (const entry of entries) {
        const item = document.createElement("span");
        item.className = "extension-status-entry";
        item.dataset.extensionId = entry.extensionId;
        item.title =
          entry.tooltip ??
          entry.accessibilityLabel ??
          `${extensionLabel(entry.extensionId)}: ${entry.name}`;
        statusTextParts(item, entry.text);
        container.append(item);
      }
    };
    renderEntries(statusLeft, leftEntries);
    renderEntries(statusRight, rightEntries);

    const errors = activities.filter(
      (activity) => activity.severity === "error",
    );
    const warnings = activities.filter(
      (activity) => activity.severity === "warning",
    );
    const latest = [...errors, ...warnings].sort(
      (a, b) => b.ts_ms - a.ts_ms,
    )[0];
    healthButton.classList.toggle("has-errors", errors.length > 0);
    healthButton.classList.toggle(
      "has-warnings",
      errors.length === 0 && warnings.length > 0,
    );
    healthButton.textContent = errors.length
      ? `Extensions: ${errors.length} error${errors.length === 1 ? "" : "s"}`
      : warnings.length
        ? `Extensions: ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
        : "Extensions";
    healthButton.title = latest
      ? `${extensionLabel(latest.extensionId)}: ${latest.message}`
      : "Open extension activity and logs";
    statusBar.hidden = false;
  }

  function showSelectedView(): void {
    const showingLog = !!selectedChannel;
    logOutput.hidden = !showingLog;
    activityList.hidden = showingLog;
    emptyState.hidden = showingLog || filteredActivities().length > 0;
  }

  function renderAll(): void {
    renderExtensionFilter();
    renderChannelFilter();
    renderActivities();
    renderStatusBar();
    showSelectedView();
  }

  function replaceLog(content: string, message = ""): void {
    logOutput.textContent = content;
    logOutput.dataset.message = message;
    logOutput.scrollTop = logOutput.scrollHeight;
  }

  function appendLog(content: string): void {
    if (!content) return;
    const shouldStick = nearBottom(logOutput);
    logOutput.append(document.createTextNode(content));
    const rendered = logOutput.textContent ?? "";
    if (rendered.length > MAX_RENDERED_LOG_CHARS) {
      logOutput.textContent = rendered.slice(-MAX_RENDERED_LOG_CHARS);
    }
    if (shouldStick) logOutput.scrollTop = logOutput.scrollHeight;
  }

  async function selectChannel(channelId: string): Promise<void> {
    selectedChannel = channelId;
    showSelectedView();
    if (!channelId) {
      renderActivities();
      return;
    }
    const generation = ++refreshGeneration;
    replaceLog("", "Loading extension log...");
    try {
      const response = snapshotFromReply(
        await requestExtensionActivity(
          "extensions.logs.select",
          { channelId },
          { timeoutMs: 10000 },
        ),
      ) as Record<string, unknown>;
      if (destroyed || generation !== refreshGeneration) return;
      const content =
        typeof response.content === "string" ? response.content : "";
      const exists = response.exists !== false;
      replaceLog(
        content,
        exists ? "" : "The extension has not created this log file yet.",
      );
    } catch (error) {
      if (destroyed || generation !== refreshGeneration) return;
      replaceLog(
        "",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function refreshSnapshot(): Promise<void> {
    const generation = ++refreshGeneration;
    try {
      const snapshot = snapshotFromReply(
        await requestExtensionActivity(
          "extensions.activity.snapshot",
          {},
          { timeoutMs: 10000 },
        ),
      );
      if (destroyed || generation !== refreshGeneration) return;
      extensions = asArray<ExtensionCatalogItem>(snapshot.extensions);
      activities = asArray<ExtensionActivity>(snapshot.activities).slice(
        -MAX_ACTIVITY_ITEMS,
      );
      statusEntries = asArray<ExtensionStatusEntry>(
        snapshot.statusEntries,
      );
      channels = asArray<ExtensionLogChannel>(snapshot.channels);
      renderAll();
      if (selectedChannel) void selectChannel(selectedChannel);
    } catch (error) {
      if (destroyed || generation !== refreshGeneration) return;
      emptyState.hidden = false;
      emptyState.textContent =
        error instanceof Error ? error.message : String(error);
    }
  }

  function handleRuntimeEvent(event: Event): void {
    const detail = eventDetail(event);
    const type = typeof detail.type === "string" ? detail.type : "";
    if (type === "extension/activityChanged" && isRecord(detail.activity)) {
      activities.push(detail.activity as unknown as ExtensionActivity);
      activities = activities.slice(-MAX_ACTIVITY_ITEMS);
      renderExtensionFilter();
      renderActivities();
      renderStatusBar();
      return;
    }
    if (type === "extension/catalogChanged") {
      extensions = asArray<ExtensionCatalogItem>(detail.extensions);
      renderExtensionFilter();
      renderChannelFilter();
      renderActivities();
      renderStatusBar();
      return;
    }
    if (type === "extension/statusBarChanged") {
      statusEntries = asArray<ExtensionStatusEntry>(detail.entries);
      renderExtensionFilter();
      renderStatusBar();
      return;
    }
    if (type === "extension/channelsChanged") {
      channels = asArray<ExtensionLogChannel>(detail.channels);
      renderExtensionFilter();
      renderChannelFilter();
      if (
        selectedChannel &&
        !channels.some((channel) => channel.id === selectedChannel)
      ) {
        void selectChannel("");
      }
      return;
    }
    if (
      type === "extension/logAppend" &&
      detail.channelId === selectedChannel &&
      typeof detail.content === "string"
    ) {
      appendLog(detail.content);
      return;
    }
    if (
      type === "extension/logSnapshot" &&
      detail.channelId === selectedChannel
    ) {
      replaceLog(
        typeof detail.content === "string" ? detail.content : "",
        detail.exists === false
          ? "The extension has not created this log file yet."
          : "",
      );
      return;
    }
    if (
      type === "extension/logError" &&
      detail.channelId === selectedChannel
    ) {
      logOutput.dataset.message =
        typeof detail.message === "string"
          ? detail.message
          : "Extension log read failed";
      return;
    }
    if (type === "extension/sessionReset") {
      activities = [];
      statusEntries = [];
      channels = [];
      selectedChannel = "";
      renderAll();
      void refreshSnapshot();
    }
  }

  function show(): void {
    header.style.display = "";
    panel.style.display = "";
    void refreshSnapshot();
  }

  function hide(): void {
    header.style.display = "none";
    panel.style.display = "none";
  }

  function open(extensionId = ""): void {
    selectedExtension = extensionId;
    const tab = document.querySelector<HTMLElement>(
      '.drawer-tab[data-tab="extensions"]',
    );
    tab?.click();
    deps.openDrawer();
  }

  clearButton.addEventListener("click", () => {
    if (selectedChannel) replaceLog("");
  });
  collapseButton.addEventListener("click", () => deps.closeDrawer());
  healthButton.addEventListener("click", () => {
    const latest = activities
      .filter((activity) => activity.severity !== "info")
      .sort((a, b) => b.ts_ms - a.ts_ms)[0];
    open(latest?.extensionId ?? "");
  });

  const runtimeListener = (event: Event) => handleRuntimeEvent(event);
  const readyListener = () => void refreshSnapshot();
  window.addEventListener(EXTENSION_ACTIVITY_EVENT, runtimeListener);
  window.addEventListener(EXTENSION_ACTIVITY_READY_EVENT, readyListener);
  renderAll();

  return {
    show,
    hide,
    open,
    destroy() {
      destroyed = true;
      window.removeEventListener(EXTENSION_ACTIVITY_EVENT, runtimeListener);
      window.removeEventListener(
        EXTENSION_ACTIVITY_READY_EVENT,
        readyListener,
      );
      extensionFilter.destroy();
      channelFilter.destroy();
    },
  };
}
