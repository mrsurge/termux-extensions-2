export interface AdapterServerSessionState {
  connected: boolean;
  ready: boolean;
  mgmtConnected: boolean;
  extConnected: boolean;
  useRemote: boolean | null;
  authority: string | null;
  serverRootPath: string | null;
  commit: string | null;
  workspaceFolder: string | null;
  activePath: string | null;
  activeUri: string | null;
  activeLanguageId: string | null;
  lastOpenTs: number | null;
  docSymbolsProviderHandle: number | null;
  hoverProviderHandle: number | null;
}

export interface AdapterServerState {
  config: Record<string, unknown>;
  session: AdapterServerSessionState;
}

export interface EventBridgeRuntime {
  wb: {
    status: () => Record<string, unknown>;
  };
  state: AdapterServerState;
  eventLog: unknown[];
  eventLogMax: number;
  eventTruncStrMax: number;
  eventTruncArrMax: number;
  nowMs: () => number;
  wsClientCount: () => number;
  wsBroadcastNotification: (method: string, params: unknown) => void;
  writePushLine: (payload: unknown) => void;
  log: (...args: unknown[]) => void;
}

export interface DiagnosticsItem {
  uri: string;
  markers: unknown[];
}

export interface DiagnosticsUpdate {
  owner: string;
  items: DiagnosticsItem[];
}

const BACKEND_PIPE_EVENT_TYPES = new Set([
  "adapter/sessionReset",
  "document/activeChanged",
  "workspace/switched",
  "watcher/enospc",
  "watcher/fileChanges",
  "diagnostics/update",
  "webview/snapshot",
  "extension/message",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

export function uriObjToString(uriObj: unknown): string | null {
  if (!uriObj) return null;
  if (typeof uriObj === "string") return uriObj;
  if (!isRecord(uriObj)) return null;
  const external = typeof uriObj.external === "string" ? uriObj.external : "";
  if (external) return external;
  const fsPath = typeof uriObj.fsPath === "string" ? uriObj.fsPath : "";
  if (fsPath) return `file://${fsPath}`;
  const scheme = typeof uriObj.scheme === "string" ? uriObj.scheme : "";
  const authority = typeof uriObj.authority === "string" ? uriObj.authority : "";
  const path = typeof uriObj.path === "string" ? uriObj.path : "";
  if (!scheme || !path) return null;
  return `${scheme}://${authority}${path}`;
}

function truncateEvent(runtime: EventBridgeRuntime, ev: unknown): unknown {
  if (!isRecord(ev)) return ev;
  const out: Record<string, unknown> = { ...ev };
  for (const key of ["result", "error", "body", "data"]) {
    const value = out[key];
    if (typeof value === "string" && value.length > runtime.eventTruncStrMax) {
      out[key] = `${value.slice(0, runtime.eventTruncStrMax)}…(truncated ${value.length - runtime.eventTruncStrMax} chars)`;
    }
  }
  if (Array.isArray(out.args) && out.args.length > runtime.eventTruncArrMax) {
    out.args = [
      ...out.args.slice(0, runtime.eventTruncArrMax),
      `…(truncated ${out.args.length - runtime.eventTruncArrMax} items)`,
    ];
  }
  try {
    if (Array.isArray(out.args)) {
      for (let index = 0; index < out.args.length; index += 1) {
        const arg = out.args[index];
        const addedDocuments = isRecord(arg) && Array.isArray(arg.addedDocuments) ? arg.addedDocuments : null;
        if (!addedDocuments) continue;
        const docs = addedDocuments.map((doc) =>
          isRecord(doc)
            ? { ...doc, lines: Array.isArray(doc.lines) ? `…(${doc.lines.length} lines omitted)` : doc.lines }
            : doc,
        );
        out.args[index] = { ...arg, addedDocuments: docs };
      }
    }
  } catch {
    // Truncation is best-effort only.
  }
  return out;
}

export function diagnosticsFromChangeMany(args: unknown): DiagnosticsUpdate | null {
  if (!Array.isArray(args) || args.length < 2) return null;
  const owner = typeof args[0] === "string" ? args[0] : "unknown";
  const pairs = Array.isArray(args[1]) ? args[1] : [];
  const items: DiagnosticsItem[] = [];
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const uriObj = pair[0];
    let markersRaw = pair[1];
    if (isRecord(markersRaw)) {
      if (Object.prototype.hasOwnProperty.call(markersRaw, "__json_with_buffers__")) {
        markersRaw = markersRaw.__json_with_buffers__;
      } else if (Object.prototype.hasOwnProperty.call(markersRaw, "markers")) {
        markersRaw = markersRaw.markers;
      }
    }
    const markers = Array.isArray(markersRaw) ? markersRaw : [];
    const uri = uriObjToString(uriObj);
    if (!uri) continue;
    items.push({ uri, markers });
  }
  return { owner, items };
}

export function emitTe2Event(runtime: EventBridgeRuntime, ev: Record<string, unknown>): void {
  if (Number.isFinite(runtime.eventLogMax) && runtime.eventLogMax > 0) {
    runtime.eventLog.push(ev);
    while (runtime.eventLog.length > runtime.eventLogMax) runtime.eventLog.shift();
  }
  runtime.wsBroadcastNotification("te2.event", ev);
  if (typeof ev.type === "string" && BACKEND_PIPE_EVENT_TYPES.has(ev.type)) {
    runtime.writePushLine({ event: "te2.event", params: ev });
  }
}

export function buildStatusResult(runtime: EventBridgeRuntime): Record<string, unknown> {
  const status = runtime.wb.status();
  runtime.state.session.connected = !!status.connected;
  runtime.state.session.ready = !!status.ready;
  runtime.state.session.mgmtConnected = !!status.mgmtConnected;
  runtime.state.session.extConnected = !!status.extConnected;
  runtime.state.session.useRemote = (status.useRemote as boolean | null | undefined) ?? null;
  runtime.state.session.authority = (status.authority as string | null | undefined) ?? null;
  runtime.state.session.serverRootPath = (status.serverRootPath as string | null | undefined) ?? null;
  runtime.state.session.commit = (status.commit as string | null | undefined) ?? null;
  runtime.state.session.workspaceFolder = (status.workspaceFolder as string | null | undefined) ?? null;
  runtime.state.session.activePath = (status.activePath as string | null | undefined) ?? null;
  runtime.state.session.activeUri = (status.activeUri as string | null | undefined) ?? null;
  runtime.state.session.activeLanguageId = (status.activeLanguageId as string | null | undefined) ?? null;
  runtime.state.session.lastOpenTs = (status.lastOpenTs as number | null | undefined) ?? null;
  runtime.state.session.docSymbolsProviderHandle = (status.docSymbolsProviderHandle as number | null | undefined) ?? null;
  runtime.state.session.hoverProviderHandle = (status.hoverProviderHandle as number | null | undefined) ?? null;
  return {
    ok: true,
    ts_ms: runtime.nowMs(),
    config: runtime.state.config,
    clients: { ws: runtime.wsClientCount() },
    session: runtime.state.session,
  };
}

export function logStatus(runtime: EventBridgeRuntime, reason: string, extra: Record<string, unknown> | null = null): void {
  try {
    const snap = buildStatusResult(runtime);
    const payload: Record<string, unknown> = {
      type: "adapter/status",
      ts_ms: runtime.nowMs(),
      reason: String(reason || "update"),
      clients: snap.clients,
      session: snap.session,
    };
    if (extra && typeof extra === "object") payload.extra = extra;
    runtime.log(JSON.stringify(payload));
  } catch {
    // Status logging is best-effort only.
  }
}

export function createWorkbenchEventHandler(runtime: EventBridgeRuntime): (ev: unknown) => void {
  return (ev: unknown) => {
    const safeEv = truncateEvent(runtime, ev);
    if (isRecord(safeEv)) {
      emitTe2Event(runtime, safeEv);
    }

    if (isRecord(safeEv) && safeEv.type === "provider/semanticTokens") {
      const pushPayload = {
        event: "semantic_tokens_provider_registered",
        handle: safeEv.handle,
        language: safeEv.language,
        legend: safeEv.legend,
        eventHandle: safeEv.eventHandle ?? null,
        range: !!safeEv.range,
      };
      runtime.log(
        `[server] PUSH semantic_tokens_provider_registered lang=${String(safeEv.language ?? "")} handle=${String(safeEv.handle ?? "")} eventHandle=${String(safeEv.eventHandle ?? "none")} range=${!!safeEv.range} legendTypes=${Array.isArray(field(safeEv.legend, "tokenTypes")) ? (field(safeEv.legend, "tokenTypes") as unknown[]).length : 0}`,
      );
      runtime.writePushLine(pushPayload);
    }

    if (isRecord(safeEv) && safeEv.type === "provider/completions") {
      const pushPayload = {
        event: "completions_provider_registered",
        handle: safeEv.handle,
        language: safeEv.language,
        triggerCharacters: Array.isArray(safeEv.triggerCharacters) ? safeEv.triggerCharacters : [],
        supportsResolve: !!safeEv.supportsResolve,
      };
      runtime.log(
        `[server] PUSH completions_provider_registered lang=${String(safeEv.language ?? "")} handle=${String(safeEv.handle ?? "")} triggers=${pushPayload.triggerCharacters.length} resolve=${pushPayload.supportsResolve ? 1 : 0}`,
      );
      runtime.writePushLine(pushPayload);
    }

    if (isRecord(safeEv) && safeEv.type === "provider/documentColors") {
      const pushPayload = {
        event: "document_colors_provider_registered",
        handle: safeEv.handle,
        language: safeEv.language,
      };
      runtime.log(
        `[server] PUSH document_colors_provider_registered lang=${String(safeEv.language ?? "")} handle=${String(safeEv.handle ?? "")}`,
      );
      runtime.writePushLine(pushPayload);
    }

    if (isRecord(safeEv) && safeEv.type === "provider/inlayHints") {
      const pushPayload = {
        event: "inlay_hints_provider_registered",
        handle: safeEv.handle,
        language: safeEv.language,
        supportsResolve: !!safeEv.supportsResolve,
        displayName: typeof safeEv.displayName === "string" ? safeEv.displayName : null,
        eventHandle: safeEv.eventHandle ?? null,
      };
      runtime.log(
        `[server] PUSH inlay_hints_provider_registered lang=${String(safeEv.language ?? "")} handle=${String(safeEv.handle ?? "")} resolve=${pushPayload.supportsResolve ? 1 : 0}`,
      );
      runtime.writePushLine(pushPayload);
    }

    if (isRecord(safeEv) && safeEv.type === "provider/inlineCompletions") {
      const pushPayload = {
        event: "inline_completions_provider_registered",
        handle: safeEv.handle,
        language: safeEv.language,
        supportsHandleEvents: !!safeEv.supportsHandleEvents,
        extensionId: typeof safeEv.extensionId === "string" ? safeEv.extensionId : null,
        extensionVersion: typeof safeEv.extensionVersion === "string" ? safeEv.extensionVersion : null,
        groupId: typeof safeEv.groupId === "string" ? safeEv.groupId : null,
        yieldsToGroupIds: Array.isArray(safeEv.yieldsToGroupIds) ? safeEv.yieldsToGroupIds : [],
        excludesGroupIds: Array.isArray(safeEv.excludesGroupIds) ? safeEv.excludesGroupIds : [],
        displayName: typeof safeEv.displayName === "string" ? safeEv.displayName : null,
        debounceDelayMs: typeof safeEv.debounceDelayMs === "number" ? safeEv.debounceDelayMs : null,
        eventHandle: safeEv.eventHandle ?? null,
      };
      runtime.log(
        `[server] PUSH inline_completions_provider_registered lang=${String(safeEv.language ?? "")} handle=${String(safeEv.handle ?? "")} handleEvents=${pushPayload.supportsHandleEvents ? 1 : 0}`,
      );
      runtime.writePushLine(pushPayload);
    }

    if (isRecord(safeEv) && safeEv.type === "diagnostics/changeMany" && Array.isArray(safeEv.args)) {
      const normalized = diagnosticsFromChangeMany(safeEv.args);
      runtime.log(
        `[server] diagnostics/changeMany -> norm=${normalized ? `owner=${normalized.owner} items=${normalized.items.length} markerCounts=[${normalized.items.map((item) => (item.markers || []).length).join(",")}]` : "null"}`,
      );
      if (normalized) {
        emitTe2Event(runtime, {
          type: "diagnostics/update",
          ts_ms: runtime.nowMs(),
          owner: normalized.owner,
          items: normalized.items,
        });
      }
    }
  };
}
