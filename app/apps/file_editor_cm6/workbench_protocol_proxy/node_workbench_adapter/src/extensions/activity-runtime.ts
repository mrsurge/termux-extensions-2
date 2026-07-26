import { watch as watchDirectory, type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export interface ExtensionActivityRpcIds {
  MainThreadConsole: number;
  MainThreadExtensionService: number;
  MainThreadLogger: number;
  MainThreadOutputService: number;
  MainThreadStatusBar: number;
}

export interface ExtensionActivityRequest {
  req: number;
  rpcId?: number;
  method?: string;
  args?: unknown[];
}

export interface ExtensionActivityRequestResult {
  handledReply?: boolean;
  replyResult?: unknown;
}

export interface ExtensionActivityItem {
  id: number;
  ts_ms: number;
  extensionId: string;
  kind: "activation" | "error" | "warning" | "log" | "output";
  severity: "info" | "warning" | "error";
  message: string;
  detail?: string;
}

export interface ExtensionStatusBarEntry {
  entryId: string;
  id: string;
  extensionId: string;
  name: string;
  text: string;
  tooltip: string | null;
  alignLeft: boolean;
  priority: number | null;
  color: string | null;
  backgroundColor: string | null;
  accessibilityLabel: string | null;
  updatedAt: number;
}

export interface ExtensionLogChannel {
  id: string;
  extensionId: string;
  label: string;
  kind: "output" | "logger";
  languageId: string | null;
  resource: string | null;
  hidden: boolean;
  visible: boolean;
  updatedAt: number;
}

interface ExtensionCatalogItem {
  id: string;
  label: string;
}

interface ChannelState {
  descriptor: ExtensionLogChannel;
  filePath: string | null;
  memoryText: string;
}

interface TailWatcher {
  channelId: string;
  filePath: string;
  watcher: FSWatcher | null;
  closed: boolean;
  offset: number;
  inode: bigint | number | null;
  decoder: TextDecoder;
  timer: NodeJS.Timeout | null;
  running: boolean;
  dirty: boolean;
  lastAccess: number;
}

export interface ExtensionActivityRuntimeOptions {
  rpcIds: ExtensionActivityRpcIds;
  onEvent: (payload: Record<string, unknown>) => void;
  resolveFsPath: (uri: unknown) => string | null;
  nowMs?: () => number;
  activityLimit?: number;
  directLogBytes?: number;
  tailBytes?: number;
  watcherLimit?: number;
}

const DEFAULT_ACTIVITY_LIMIT = 500;
const DEFAULT_DIRECT_LOG_BYTES = 256 * 1024;
const DEFAULT_TAIL_BYTES = 256 * 1024;
const DEFAULT_WATCHER_LIMIT = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boolValue(value: unknown): boolean {
  return value === true;
}

function boundedText(value: unknown, max = 16 * 1024): string {
  let text = "";
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value) ?? String(value ?? "");
    } catch {
      text = String(value ?? "");
    }
  }
  return text.length > max ? `${text.slice(0, max)}...(truncated)` : text;
}

function unwrapSerialized(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (Object.prototype.hasOwnProperty.call(value, "__json_with_buffers__")) {
    return value.__json_with_buffers__;
  }
  return value;
}

function extensionIdFrom(value: unknown): string | null {
  const unwrapped = unwrapSerialized(value);
  if (typeof unwrapped === "string") return stringValue(unwrapped);
  if (!isRecord(unwrapped)) return null;
  const direct =
    stringValue(unwrapped.id) ??
    stringValue(unwrapped.extensionId) ??
    stringValue(unwrapped.value);
  if (direct) return direct;
  return (
    extensionIdFrom(unwrapped.identifier) ??
    extensionIdFrom(unwrapped.extension) ??
    extensionIdFrom(unwrapped.value)
  );
}

function uriString(value: unknown): string | null {
  if (typeof value === "string") return stringValue(value);
  if (!isRecord(value)) return null;
  const external = stringValue(value.external);
  if (external) return external;
  const scheme = stringValue(value.scheme);
  const authority = stringValue(value.authority) ?? "";
  const uriPath = stringValue(value.path) ?? stringValue(value.fsPath);
  if (!uriPath) return null;
  if (!scheme) return uriPath;
  return `${scheme}://${authority}${uriPath}`;
}

function tooltipText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return null;
  return stringValue(value.value) ?? stringValue(value.message);
}

function themeValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return null;
  return stringValue(value.id);
}

function errorParts(value: unknown): { message: string; detail?: string } {
  const unwrapped = unwrapSerialized(value);
  if (typeof unwrapped === "string") return { message: unwrapped };
  if (!isRecord(unwrapped)) return { message: boundedText(unwrapped) || "Unknown extension error" };
  const name = stringValue(unwrapped.name);
  const message =
    stringValue(unwrapped.message) ??
    stringValue(unwrapped.detail) ??
    boundedText(unwrapped, 2 * 1024);
  const stack = stringValue(unwrapped.stack);
  return {
    message: name && !message.startsWith(name) ? `${name}: ${message}` : message,
    ...(stack ? { detail: boundedText(stack) } : {}),
  };
}

function consoleMessage(entry: unknown): {
  severity: "info" | "warning" | "error";
  message: string;
  detail?: string;
} {
  const unwrapped = unwrapSerialized(entry);
  if (!isRecord(unwrapped)) {
    return { severity: "info", message: boundedText(unwrapped) };
  }
  const rawSeverity = stringValue(unwrapped.severity) ?? "log";
  const severity =
    rawSeverity === "error"
      ? "error"
      : rawSeverity === "warn"
        ? "warning"
        : "info";
  const rawArguments = stringValue(unwrapped.arguments);
  if (!rawArguments) {
    return { severity, message: boundedText(unwrapped) };
  }
  try {
    const parsed = JSON.parse(rawArguments) as unknown;
    if (Array.isArray(parsed)) {
      const messages: string[] = [];
      let detail: string | undefined;
      for (const item of parsed) {
        if (isRecord(item) && typeof item.__$stack === "string") {
          detail = boundedText(item.__$stack);
        } else if (typeof item === "string") {
          messages.push(item);
        } else {
          messages.push(boundedText(item, 2 * 1024));
        }
      }
      return {
        severity,
        message: boundedText(messages.join(" "), 4 * 1024),
        ...(detail ? { detail } : {}),
      };
    }
  } catch {
    // The extension host already bounds this string; keep it readable as-is.
  }
  return { severity, message: boundedText(rawArguments, 4 * 1024) };
}

function loggerKey(resource: unknown): string {
  return uriString(resource) ?? boundedText(resource, 1024);
}

function appendBounded(current: string, added: string, maxBytes: number): string {
  const next = current + added;
  if (Buffer.byteLength(next, "utf8") <= maxBytes) return next;
  const bytes = Buffer.from(next, "utf8");
  return bytes.subarray(Math.max(0, bytes.length - maxBytes)).toString("utf8");
}

export class ExtensionActivityRuntime {
  private readonly rpcIds: ExtensionActivityRpcIds;
  private readonly onEvent: (payload: Record<string, unknown>) => void;
  private readonly resolveFsPath: (uri: unknown) => string | null;
  private readonly nowMs: () => number;
  private readonly activityLimit: number;
  private readonly directLogBytes: number;
  private readonly tailBytes: number;
  private readonly watcherLimit: number;
  private readonly activities: ExtensionActivityItem[] = [];
  private readonly statusEntries = new Map<string, ExtensionStatusBarEntry>();
  private readonly channels = new Map<string, ChannelState>();
  private readonly loggerChannelsByResource = new Map<string, string>();
  private readonly watchers = new Map<string, TailWatcher>();
  private readonly selectedChannels = new Set<string>();
  private readonly extensions = new Map<string, ExtensionCatalogItem>();
  private nextActivityId = 1;

  constructor(options: ExtensionActivityRuntimeOptions) {
    this.rpcIds = options.rpcIds;
    this.onEvent = options.onEvent;
    this.resolveFsPath = options.resolveFsPath;
    this.nowMs = options.nowMs ?? Date.now;
    this.activityLimit = Math.max(1, options.activityLimit ?? DEFAULT_ACTIVITY_LIMIT);
    this.directLogBytes = Math.max(1024, options.directLogBytes ?? DEFAULT_DIRECT_LOG_BYTES);
    this.tailBytes = Math.max(1024, options.tailBytes ?? DEFAULT_TAIL_BYTES);
    this.watcherLimit = Math.max(1, options.watcherLimit ?? DEFAULT_WATCHER_LIMIT);
  }

  setExtensions(entries: unknown[]): void {
    this.extensions.clear();
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const id = extensionIdFrom(entry);
      if (!id) continue;
      const label =
        stringValue(entry.displayName) ??
        stringValue(entry.name) ??
        id;
      this.extensions.set(id, { id, label });
    }
    this.emitSnapshotChanged();
  }

  reset(reason = "session_reset"): void {
    for (const watcher of this.watchers.values()) this.closeWatcher(watcher);
    this.watchers.clear();
    this.activities.length = 0;
    this.statusEntries.clear();
    this.channels.clear();
    this.loggerChannelsByResource.clear();
    this.selectedChannels.clear();
    this.extensions.clear();
    this.nextActivityId = 1;
    this.emit({
      type: "extension/sessionReset",
      ts_ms: this.nowMs(),
      reason,
    });
  }

  snapshot(): Record<string, unknown> {
    return {
      ok: true,
      ts_ms: this.nowMs(),
      extensions: [...this.extensions.values()].sort((a, b) =>
        a.label.localeCompare(b.label),
      ),
      activities: [...this.activities],
      statusEntries: this.statusSnapshot(),
      channels: this.channelSnapshot(),
    };
  }

  handleRequest(request: ExtensionActivityRequest): ExtensionActivityRequestResult {
    const method = request.method ?? "";
    const args = Array.isArray(request.args) ? request.args : [];
    const rpcId = request.rpcId;

    if (
      rpcId === this.rpcIds.MainThreadExtensionService ||
      method === "$onUnexpectedError"
    ) {
      this.handleExtensionLifecycle(method, args);
    }
    if (
      rpcId === this.rpcIds.MainThreadConsole &&
      method === "$logExtensionHostMessage"
    ) {
      this.handleExtensionHostConsole(args[0]);
    }
    if (rpcId === this.rpcIds.MainThreadStatusBar) {
      this.handleStatusBar(method, args);
    }
    if (rpcId === this.rpcIds.MainThreadLogger) {
      this.handleLogger(method, args);
    }
    if (rpcId === this.rpcIds.MainThreadOutputService) {
      return this.handleOutput(method, args, request.req);
    }
    return {};
  }

  async selectLog(channelId: string): Promise<Record<string, unknown>> {
    const state = this.channels.get(channelId);
    if (!state) {
      throw new Error(`Unknown extension log channel: ${channelId}`);
    }
    const selectedAt = this.nowMs();
    this.selectedChannels.add(channelId);
    let content = state.memoryText;
    let exists = false;
    let truncated = false;

    if (state.filePath) {
      const snapshot = await this.readTailSnapshot(state.filePath);
      exists = snapshot.exists;
      truncated = snapshot.truncated;
      content = snapshot.content + state.memoryText;
      await this.ensureWatcher(channelId, state.filePath, snapshot.offset, snapshot.inode);
    }

    return {
      ok: true,
      ts_ms: selectedAt,
      channel: state.descriptor,
      content,
      exists: state.filePath ? exists : true,
      truncated,
    };
  }

  private handleExtensionLifecycle(method: string, args: unknown[]): void {
    const extensionId = extensionIdFrom(args[0]) ?? "extension-host";
    if (method === "$onWillActivateExtension") {
      this.recordActivity(extensionId, "activation", "info", `Activating ${extensionId}`);
      return;
    }
    if (method === "$onDidActivateExtension") {
      this.recordActivity(extensionId, "activation", "info", `Activated ${extensionId}`);
      return;
    }
    if (method === "$onExtensionActivationError") {
      const error = errorParts(args[1]);
      this.recordActivity(
        extensionId,
        "error",
        "error",
        `Activation failed: ${error.message}`,
        error.detail,
      );
      return;
    }
    if (method === "$onExtensionRuntimeError") {
      const error = errorParts(args[1]);
      this.recordActivity(
        extensionId,
        "error",
        "error",
        error.message,
        error.detail,
      );
      return;
    }
    if (method === "$onUnexpectedError") {
      const error = errorParts(args[0]);
      this.recordActivity(
        "extension-host",
        "error",
        "error",
        error.message,
        error.detail,
      );
    }
  }

  private handleExtensionHostConsole(entry: unknown): void {
    const parsed = consoleMessage(entry);
    if (parsed.severity === "info") return;
    this.recordActivity(
      "extension-host",
      parsed.severity === "error" ? "error" : "warning",
      parsed.severity,
      parsed.message,
      parsed.detail,
    );
  }

  private handleStatusBar(method: string, args: unknown[]): void {
    if (method === "$disposeEntry") {
      const entryId = stringValue(args[0]);
      if (entryId && this.statusEntries.delete(entryId)) this.emitStatusChanged();
      return;
    }
    if (method !== "$setEntry") return;
    const entryId = stringValue(args[0]);
    if (!entryId) return;
    const accessibility = isRecord(args[12]) ? args[12] : {};
    const entry: ExtensionStatusBarEntry = {
      entryId,
      id: stringValue(args[1]) ?? entryId,
      extensionId: stringValue(args[2]) ?? "core",
      name: stringValue(args[3]) ?? stringValue(args[1]) ?? entryId,
      text: typeof args[4] === "string" ? args[4] : "",
      tooltip: tooltipText(args[5]),
      alignLeft: boolValue(args[10]),
      priority: numberValue(args[11]),
      color: themeValue(args[8]),
      backgroundColor: themeValue(args[9]),
      accessibilityLabel: stringValue(accessibility.label),
      updatedAt: this.nowMs(),
    };
    this.statusEntries.set(entryId, entry);
    this.emitStatusChanged();
  }

  private handleOutput(
    method: string,
    args: unknown[],
    requestId: number,
  ): ExtensionActivityRequestResult {
    if (method === "$register") {
      const extensionId = stringValue(args[3]) ?? "extension-host";
      const label = stringValue(args[0]) ?? "Output";
      const channelId = `te2-output-${requestId}`;
      const descriptor: ExtensionLogChannel = {
        id: channelId,
        extensionId,
        label,
        kind: "output",
        languageId: stringValue(args[2]),
        resource: uriString(args[1]),
        hidden: false,
        visible: false,
        updatedAt: this.nowMs(),
      };
      this.channels.set(channelId, {
        descriptor,
        filePath: this.resolveFsPath(args[1]),
        memoryText: "",
      });
      this.emitChannelsChanged();
      this.recordActivity(
        extensionId,
        "output",
        "info",
        `Registered output channel: ${label}`,
      );
      return { handledReply: true, replyResult: channelId };
    }

    const channelId = stringValue(args[0]);
    if (!channelId) return {};
    const state = this.channels.get(channelId);
    if (method === "$dispose") {
      this.removeChannel(channelId);
      return {};
    }
    if (!state) return {};
    state.descriptor.updatedAt = this.nowMs();
    if (method === "$reveal") {
      state.descriptor.visible = true;
      this.recordActivity(
        state.descriptor.extensionId,
        "output",
        "info",
        `Showed output channel: ${state.descriptor.label}`,
      );
      this.emitChannelsChanged();
    } else if (method === "$close") {
      state.descriptor.visible = false;
      this.emitChannelsChanged();
    }
    return {};
  }

  private handleLogger(method: string, args: unknown[]): void {
    if (method === "$registerLogger") {
      const raw = isRecord(args[0]) ? args[0] : {};
      const resource = raw.resource;
      const resourceKey = loggerKey(resource);
      const channelId =
        stringValue(raw.id) ??
        `te2-logger-${Buffer.from(resourceKey).toString("base64url").slice(0, 40)}`;
      const descriptor: ExtensionLogChannel = {
        id: channelId,
        extensionId: stringValue(raw.extensionId) ?? "extension-host",
        label: stringValue(raw.name) ?? stringValue(raw.id) ?? "Extension Log",
        kind: "logger",
        languageId: "log",
        resource: uriString(resource),
        hidden: boolValue(raw.hidden),
        visible: !boolValue(raw.hidden),
        updatedAt: this.nowMs(),
      };
      this.channels.set(channelId, {
        descriptor,
        filePath: this.resolveFsPath(resource),
        memoryText: "",
      });
      this.loggerChannelsByResource.set(resourceKey, channelId);
      this.emitChannelsChanged();
      return;
    }

    const resourceKey = loggerKey(args[0]);
    const channelId = this.loggerChannelsByResource.get(resourceKey);
    if (!channelId) return;
    const state = this.channels.get(channelId);
    if (!state) return;

    if (method === "$deregisterLogger") {
      this.removeChannel(channelId);
      return;
    }
    if (method === "$setVisibility") {
      state.descriptor.visible = boolValue(args[1]);
      state.descriptor.hidden = !state.descriptor.visible;
      state.descriptor.updatedAt = this.nowMs();
      this.emitChannelsChanged();
      return;
    }
    if (method === "$log") {
      const messages = Array.isArray(args[1]) ? args[1] : [];
      const text = messages
        .map((item) => {
          if (!Array.isArray(item)) return "";
          const level = Number(item[0]);
          const label =
            level >= 4 ? "ERROR" : level === 3 ? "WARN" : level === 1 ? "TRACE" : "INFO";
          return `[${label}] ${boundedText(item[1], 32 * 1024)}\n`;
        })
        .join("");
      if (!text) return;
      state.memoryText = appendBounded(
        state.memoryText,
        text,
        this.directLogBytes,
      );
      state.descriptor.updatedAt = this.nowMs();
      const highestSeverity = messages.reduce(
        (current, item) =>
          Array.isArray(item) && Number.isFinite(Number(item[0]))
            ? Math.max(current, Number(item[0]))
            : current,
        0,
      );
      if (highestSeverity >= 3) {
        const firstMessage = messages.find(
          (item) => Array.isArray(item) && Number(item[0]) === highestSeverity,
        );
        this.recordActivity(
          state.descriptor.extensionId,
          highestSeverity >= 4 ? "error" : "warning",
          highestSeverity >= 4 ? "error" : "warning",
          `${state.descriptor.label}: ${boundedText(
            Array.isArray(firstMessage) ? firstMessage[1] : text,
            4 * 1024,
          )}`,
        );
      }
      if (this.selectedChannels.has(channelId)) {
        this.emit({
          type: "extension/logAppend",
          ts_ms: this.nowMs(),
          channelId,
          content: text,
          source: "rpc",
        });
      }
    }
  }

  private recordActivity(
    extensionId: string,
    kind: ExtensionActivityItem["kind"],
    severity: ExtensionActivityItem["severity"],
    message: string,
    detail?: string,
  ): void {
    const item: ExtensionActivityItem = {
      id: this.nextActivityId++,
      ts_ms: this.nowMs(),
      extensionId,
      kind,
      severity,
      message: boundedText(message, 4 * 1024),
      ...(detail ? { detail: boundedText(detail) } : {}),
    };
    this.activities.push(item);
    while (this.activities.length > this.activityLimit) this.activities.shift();
    this.emit({
      type: "extension/activityChanged",
      ts_ms: item.ts_ms,
      activity: item,
    });
  }

  private statusSnapshot(): ExtensionStatusBarEntry[] {
    return [...this.statusEntries.values()].sort((a, b) => {
      if (a.alignLeft !== b.alignLeft) return a.alignLeft ? -1 : 1;
      return (b.priority ?? 0) - (a.priority ?? 0);
    });
  }

  private channelSnapshot(): ExtensionLogChannel[] {
    return [...this.channels.values()]
      .map((state) => state.descriptor)
      .sort((a, b) => {
        const extensionOrder = a.extensionId.localeCompare(b.extensionId);
        return extensionOrder || a.label.localeCompare(b.label);
      });
  }

  private emitSnapshotChanged(): void {
    this.emit({
      type: "extension/catalogChanged",
      ts_ms: this.nowMs(),
      extensions: [...this.extensions.values()],
    });
  }

  private emitStatusChanged(): void {
    this.emit({
      type: "extension/statusBarChanged",
      ts_ms: this.nowMs(),
      entries: this.statusSnapshot(),
    });
  }

  private emitChannelsChanged(): void {
    this.emit({
      type: "extension/channelsChanged",
      ts_ms: this.nowMs(),
      channels: this.channelSnapshot(),
    });
  }

  private emit(payload: Record<string, unknown>): void {
    try {
      this.onEvent(payload);
    } catch {
      // Extension observability must never interrupt the extension host.
    }
  }

  private removeChannel(channelId: string): void {
    const state = this.channels.get(channelId);
    if (!state) return;
    this.channels.delete(channelId);
    this.selectedChannels.delete(channelId);
    for (const [resource, id] of this.loggerChannelsByResource) {
      if (id === channelId) this.loggerChannelsByResource.delete(resource);
    }
    const watcher = this.watchers.get(channelId);
    if (watcher) {
      this.closeWatcher(watcher);
      this.watchers.delete(channelId);
    }
    this.emitChannelsChanged();
    this.emit({
      type: "extension/logClosed",
      ts_ms: this.nowMs(),
      channelId,
    });
  }

  private async readTailSnapshot(filePath: string): Promise<{
    content: string;
    exists: boolean;
    truncated: boolean;
    offset: number;
    inode: bigint | number | null;
  }> {
    try {
      const stat = await fs.stat(filePath, { bigint: true });
      const size = Number(stat.size);
      const start = Math.max(0, size - this.tailBytes);
      let bytes = await this.readRange(filePath, start, size - start);
      if (start > 0) {
        const newline = bytes.indexOf(0x0a);
        if (newline >= 0) bytes = bytes.subarray(newline + 1);
      }
      return {
        content: new TextDecoder().decode(bytes),
        exists: true,
        truncated: start > 0,
        offset: size,
        inode: stat.ino,
      };
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") {
        return {
          content: "",
          exists: false,
          truncated: false,
          offset: 0,
          inode: null,
        };
      }
      throw error;
    }
  }

  private async readRange(
    filePath: string,
    offset: number,
    length: number,
  ): Promise<Uint8Array> {
    if (length <= 0) return new Uint8Array();
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.allocUnsafe(length);
      const result = await handle.read(buffer, 0, length, offset);
      return buffer.subarray(0, result.bytesRead);
    } finally {
      await handle.close();
    }
  }

  private async ensureWatcher(
    channelId: string,
    filePath: string,
    offset: number,
    inode: bigint | number | null,
  ): Promise<void> {
    const existing = this.watchers.get(channelId);
    if (existing) {
      existing.lastAccess = this.nowMs();
      if (existing.filePath !== filePath) {
        this.closeWatcher(existing);
        this.watchers.delete(channelId);
      } else {
        return;
      }
    }

    while (this.watchers.size >= this.watcherLimit) {
      const oldest = [...this.watchers.values()].sort(
        (a, b) => a.lastAccess - b.lastAccess,
      )[0];
      if (!oldest) break;
      this.closeWatcher(oldest);
      this.watchers.delete(oldest.channelId);
    }

    const tail: TailWatcher = {
      channelId,
      filePath,
      watcher: null,
      closed: false,
      offset,
      inode,
      decoder: new TextDecoder(),
      timer: null,
      running: false,
      dirty: false,
      lastAccess: this.nowMs(),
    };
    this.watchers.set(channelId, tail);
    try {
      const parent = path.dirname(filePath);
      const basename = path.basename(filePath);
      tail.watcher = watchDirectory(
        parent,
        { persistent: false },
        (_eventType, filename) => {
          if (filename && filename.toString() !== basename) return;
          this.scheduleWatcherRefresh(tail);
        },
      );
      tail.watcher.on("error", () => {
        this.scheduleWatcherRefresh(tail);
      });
      this.scheduleWatcherRefresh(tail);
    } catch {
      // The channel may create its directory later; selection still returns its snapshot.
    }
  }

  private scheduleWatcherRefresh(tail: TailWatcher): void {
    if (tail.closed) return;
    tail.dirty = true;
    if (tail.timer) return;
    tail.timer = setTimeout(() => {
      tail.timer = null;
      void this.refreshWatcher(tail);
    }, 20);
    tail.timer.unref?.();
  }

  private async refreshWatcher(tail: TailWatcher): Promise<void> {
    if (tail.closed) return;
    if (tail.running) {
      tail.dirty = true;
      return;
    }
    tail.running = true;
    try {
      do {
        tail.dirty = false;
        let stat: Awaited<ReturnType<typeof fs.stat>>;
        try {
          stat = await fs.stat(tail.filePath, { bigint: true });
        } catch (error) {
          if (!isRecord(error) || error.code !== "ENOENT") throw error;
          if (tail.offset !== 0 || tail.inode != null) {
            tail.offset = 0;
            tail.inode = null;
            tail.decoder = new TextDecoder();
            if (tail.closed) return;
            this.emit({
              type: "extension/logSnapshot",
              ts_ms: this.nowMs(),
              channelId: tail.channelId,
              content: "",
              exists: false,
              truncated: false,
            });
          }
          continue;
        }

        const size = Number(stat.size);
        const replaced =
          tail.inode != null &&
          stat.ino != null &&
          stat.ino !== tail.inode;
        const reset =
          replaced ||
          size < tail.offset ||
          size - tail.offset > this.tailBytes;
        if (reset) {
          const snapshot = await this.readTailSnapshot(tail.filePath);
          tail.offset = snapshot.offset;
          tail.inode = snapshot.inode;
          tail.decoder = new TextDecoder();
          if (tail.closed) return;
          this.emit({
            type: "extension/logSnapshot",
            ts_ms: this.nowMs(),
            channelId: tail.channelId,
            content:
              snapshot.content +
              (this.channels.get(tail.channelId)?.memoryText ?? ""),
            exists: true,
            truncated: snapshot.truncated,
          });
          continue;
        }

        if (size > tail.offset) {
          const bytes = await this.readRange(
            tail.filePath,
            tail.offset,
            size - tail.offset,
          );
          tail.offset = size;
          tail.inode = stat.ino;
          const content = tail.decoder.decode(bytes, { stream: true });
          if (content && !tail.closed) {
            this.emit({
              type: "extension/logAppend",
              ts_ms: this.nowMs(),
              channelId: tail.channelId,
              content,
              source: "file",
            });
          }
        }
      } while (tail.dirty);
    } catch (error) {
      this.emit({
        type: "extension/logError",
        ts_ms: this.nowMs(),
        channelId: tail.channelId,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      tail.running = false;
    }
  }

  private closeWatcher(tail: TailWatcher): void {
    tail.closed = true;
    tail.dirty = false;
    if (tail.timer) clearTimeout(tail.timer);
    tail.timer = null;
    try {
      tail.watcher?.close();
    } catch {
      // Best-effort cleanup during adapter reconnect/shutdown.
    }
    tail.watcher = null;
  }
}
