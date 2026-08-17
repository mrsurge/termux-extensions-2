import type { WorkbenchDocumentRegistry } from "./document-registry";

export interface LifecycleExtRpcIds {
  ExtHostDocumentsAndEditors: number;
  ExtHostDocuments: number;
  ExtHostEditors: number;
  ExtHostEditorTabs: number;
  ExtHostExtensionService: number;
  ExtHostWorkspace: number;
}

export interface WorkspaceClientState {
  workspaceFolder: string | null;
  activePath: string | null;
  activeUri: string | null;
  activeLanguageId: string | null;
  lastOpenTs: number | null;
}

export interface WorkspaceSessionState {
  activeEditorId: string | null;
  activeUriObj: unknown;
  activeTab: unknown;
  nextModelNumber: number;
  documentRegistry: WorkbenchDocumentRegistry;
}

export interface WatchSubscriptionLike {
  event: (listener: (payload: unknown) => void) => void;
  dispose?: () => void;
}

export interface MgmtIpcLike {
  listen: (channel: string, event: string, args: unknown[]) => WatchSubscriptionLike;
  call: (channel: string, method: string, args: unknown[]) => Promise<unknown>;
  dispose?: () => void;
}

export interface WorkspaceWatcherState {
  mgmtIpc: MgmtIpcLike | null;
  fsWatcherSub: WatchSubscriptionLike | null;
}

export interface ProjectScopedSwitchCleanup {
  rejectedPendingRequests: number;
  clearedBackgroundDocuments: number;
}

export interface WorkspaceSwitchResult {
  ok: true;
  readyForDocumentOpen: true;
  workspaceFolder: string;
  previousWorkspaceFolder: string | null;
  watcherStatus: "subscribed" | "skipped" | "error";
  watcherError?: string;
  cleanup: ProjectScopedSwitchCleanup;
}

export interface LifecycleRuntime {
  ensureConnected: () => void;
  state: WorkspaceClientState;
  session: WorkspaceSessionState;
  watcher: WorkspaceWatcherState;
  useRemote: boolean;
  authority: string;
  extRpcIds: LifecycleExtRpcIds;
  readTextFile: (path: string) => Promise<string>;
  uriForPath: (path: string, authority: string | null) => Record<string, unknown>;
  uriToString: (uri: unknown) => string;
  resolveLanguageId: (
    path: string,
    text: string,
    requestedLanguageId?: unknown,
  ) => string;
  activateLanguage: (languageId: string) => Promise<unknown>;
  sendExt: (rpcId: number, method: string, args: unknown[], cancellable?: boolean) => unknown;
  spanTrace: <T>(name: string, fn: () => T) => T;
  spanTraceAsync: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  logMetrics: (type: string, data: Record<string, unknown>) => void;
  onEvent: (payload: Record<string, unknown>) => void;
  clearProjectScopedSwitchState: (reason: string) => ProjectScopedSwitchCleanup;
  sha1Short: (text: string) => string;
  randomUuid: () => string;
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export interface DidChangeOptions {
  waitForAck?: boolean;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export function coerceOptionalGeneration(raw: unknown): number | string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") return raw;
  return null;
}

function lineByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function normalizeDocumentText(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function updateActiveState(runtime: LifecycleRuntime, path: string, uriObj: Record<string, unknown>, languageId: string): void {
  try {
    runtime.state.activePath = path;
    runtime.state.activeUri = optionalString(field(uriObj, "external")) ?? runtime.uriToString(uriObj);
    runtime.state.activeLanguageId = languageId;
    runtime.state.lastOpenTs = Date.now();
  } catch {
    // Preserve current WBA behavior: state reflection failures must not abort lifecycle work.
  }
}

function currentOpenGeneration(runtime: LifecycleRuntime, path: string): number | string | null | undefined {
  return runtime.session.documentRegistry.getOpenGeneration(path);
}

function openGuard(runtime: LifecycleRuntime, path: string, generation: number | string | null): Record<string, unknown> | null {
  if (!runtime.session.documentRegistry.getByPath(path)) {
    runtime.warn(`[didChange] drop path=${path} reason=document_not_open`);
    return { ok: false, error: "document_not_open" };
  }
  const openGeneration = currentOpenGeneration(runtime, path);
  if (
    generation !== null &&
    openGeneration !== undefined &&
    openGeneration !== null &&
    openGeneration !== generation
  ) {
    runtime.warn(`[didChange] drop path=${path} reason=stale_generation openGen=${openGeneration} gotGen=${generation}`);
    return { ok: false, error: "stale_generation", openGeneration };
  }
  return null;
}

function shouldTreatAsSameFile(prevUriObj: unknown, nextPath: string): boolean {
  if (!isRecord(prevUriObj)) return false;
  const prevAbs = optionalString(prevUriObj.fsPath) ?? optionalString(prevUriObj.path) ?? "";
  return !!prevAbs && prevAbs === nextPath;
}

function previousPath(prevUriObj: unknown): string {
  if (!isRecord(prevUriObj)) return "";
  return optionalString(prevUriObj.fsPath) ?? optionalString(prevUriObj.path) ?? "";
}

function isRangeArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export async function openFile(runtime: LifecycleRuntime, params: unknown = {}): Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const input = isRecord(params) ? params : {};
  const path = String(input.path ?? "");
  const authority = String(input.authority ?? runtime.authority);
  const forceRefresh = input.forceRefresh === true;
  const generation = coerceOptionalGeneration(input.generation);

  const requestedWorkspace = input.workspaceFolder ? String(input.workspaceFolder) : null;
  if (requestedWorkspace && runtime.state.workspaceFolder && requestedWorkspace !== runtime.state.workspaceFolder) {
    runtime.log(`[openFile] workspace change detected: ${runtime.state.workspaceFolder} → ${requestedWorkspace}`);
    await switchWorkspace(runtime, requestedWorkspace);
  } else if (requestedWorkspace && !runtime.state.workspaceFolder) {
    runtime.log(`[openFile] late workspace init: ${requestedWorkspace}`);
    await switchWorkspace(runtime, requestedWorkspace);
  }

  const prevEditorId = runtime.session.activeEditorId;
  const prevUriObj = runtime.session.activeUriObj;
  const prevTab = runtime.session.activeTab;

  const prevAbs = previousPath(prevUriObj);
  const isSameFileReopen = shouldTreatAsSameFile(prevUriObj, path);
  const existingEntry = runtime.session.documentRegistry.getByPath(path);
  const isDuplicateGeneration = !!(
    isSameFileReopen &&
    existingEntry &&
    generation !== null &&
    existingEntry.openGeneration === generation
  );
  if (isDuplicateGeneration) {
    runtime.log(
      `[openFile] ts=${Date.now()} duplicate path=${path} generation=${String(generation)} no-op`,
    );
    return { ok: true, req: null, duplicate: true, generation };
  }
  const shouldReplaceEditor = !!(
    prevUriObj &&
    prevAbs &&
    !isSameFileReopen &&
    (forceRefresh || prevAbs !== path)
  );
  const generatedUri = runtime.spanTrace(
    "openFile.uriForPath",
    () => runtime.uriForPath(path, authority),
  );
  let text: string | null = null;
  let lines: string[] | null = null;
  let languageId: string;
  if (existingEntry && !isSameFileReopen) {
    languageId =
      typeof input.languageId === "string" && input.languageId
        ? runtime.resolveLanguageId(path, "", input.languageId)
        : existingEntry.languageId;
  } else {
    const rawText = await runtime.spanTraceAsync(
      "openFile.fs.readFile",
      () => runtime.readTextFile(path),
    );
    text = normalizeDocumentText(rawText);
    languageId = runtime.resolveLanguageId(path, text, input.languageId);
    lines = runtime.spanTrace(
      "openFile.text.splitLines",
      () => text!.split("\n"),
    );
    let maxLineLen = 0;
    for (const line of lines) {
      if (line.length > maxLineLen) maxLineLen = line.length;
    }
    runtime.logMetrics("metrics/open_file", {
      path,
      text_bytes: lineByteLength(text),
      lines: lines.length,
      max_line_len: maxLineLen,
    });
  }
  const uriObj = existingEntry?.uri ?? generatedUri;
  const lineCount = existingEntry?.lineCount ?? lines?.length ?? 1;
  const visibleLastLineLength =
    lineCount <= 31
      ? existingEntry?.lastLineLength ?? (lines?.[lineCount - 1] ?? "").length
      : 0;
  updateActiveState(runtime, path, uriObj, languageId);

  const modelN = runtime.session.nextModelNumber++;
  const editorId = `vs.editor.ICodeEditor:2,$model${modelN}`;
  const visibleEndLineNumber = Math.min(lineCount || 1, 31);
  const visibleEndColumn = Math.max(
    1,
    Math.min(visibleLastLineLength + 1, 1000),
  );

  const tabId = `0~default-workbench.editors.files.fileEditorInput-${String(field(uriObj, "external") ?? runtime.uriToString(uriObj))} `;
  const tab = {
    id: tabId,
    label: path.split("/").filter(Boolean).slice(-1)[0] || path,
    editorId: "default",
    input: { kind: 1, uri: uriObj },
    isPinned: false,
    isPreview: true,
    isActive: true,
    isDirty: existingEntry?.dirty ?? false,
  };
  const tabInactive = { ...tab, isActive: false };
  const tabActive = { ...tab, isActive: true };
  try {
    runtime.log(
      `[openFile] ts=${Date.now()} path=${path} lang=${languageId} editorId=${editorId} forceRefresh=${forceRefresh ? 1 : 0} shouldReplaceEditor=${shouldReplaceEditor} prevEditorId=${prevEditorId || ""} prevPath=${prevAbs}`,
    );
  } catch {}

  if (isSameFileReopen) {
    if (text === null) throw new Error(`missing reopen text for ${path}`);
    const replaced = runtime.session.documentRegistry.replaceFullText(
      {
        path,
        text,
        languageId,
        openGeneration: generation,
        dirty: false,
      },
      { isDirtyEvent: false },
    );
    if (!replaced.ok) {
      throw new Error(`${replaced.error}: ${path}`);
    }
    runtime.log(
      `[openFile] ts=${Date.now()} same-file reopen contentChanged=${replaced.contentChanged ? 1 : 0} (v${replaced.previousVersionId}→v${replaced.versionId})`,
    );
    runtime.session.activeEditorId = prevEditorId;
    runtime.session.activeUriObj = uriObj;
    runtime.session.activeTab = prevTab;
    void runtime.activateLanguage(languageId).catch((error) => {
      runtime.warn(
        `[openFile] language activation failed languageId=${languageId}: ${String((error as Error)?.message ?? error)}`,
      );
    });
    runtime.onEvent({
      type: "document/activeChanged",
      ts_ms: Date.now(),
      path,
      activeEpoch: runtime.session.documentRegistry.activeEpoch,
      generation,
      workspaceFolder: runtime.state.workspaceFolder,
    });
    return { ok: true, req: null };
  }

  const retained = existingEntry
    ? { entry: existingEntry, added: false }
    : runtime.spanTrace("openFile.registry.retain", () => {
        if (text === null) throw new Error(`missing initial text for ${path}`);
        return runtime.session.documentRegistry.retain({
          path,
          uri: uriObj,
          text,
          languageId,
          role: "background",
          openGeneration: generation,
          dirty: false,
        });
      });
  const promoted = runtime.session.documentRegistry.promote(path, generation);
  if (promoted.demoted) {
    runtime.log(
      `[openFile] ts=${Date.now()} demotedDocument=[${promoted.demoted.path}] role=provisional-background`,
    );
  }
  runtime.log(
    `[openFile] ts=${Date.now()} ${retained.added ? "addedDocuments" : "promotedDocument"}=[${path}] lineCount=${retained.entry.lineCount}`,
  );

  const editorDelta = runtime.spanTrace("openFile.buildDelta.addedEditors", () => ({
    newActiveEditor: editorId,
    ...(shouldReplaceEditor && prevEditorId
      ? { removedEditors: [prevEditorId] }
      : {}),
    addedEditors: [
      {
        id: editorId,
        documentUri: uriObj,
        options: { insertSpaces: true, tabSize: 4, indentSize: 4, originalIndentSize: "tabSize", cursorStyle: 1, lineNumbers: 1 },
        selections: [
          {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 1,
            selectionStartLineNumber: 1,
            selectionStartColumn: 1,
            positionLineNumber: 1,
            positionColumn: 1,
          },
        ],
        visibleRanges: [{ startLineNumber: 1, startColumn: 1, endLineNumber: visibleEndLineNumber, endColumn: visibleEndColumn }],
        editorPosition: 0,
      },
    ],
  }));
  const reqDocs = runtime.spanTrace("openFile.send.delta.addedEditors", () =>
    runtime.sendExt(runtime.extRpcIds.ExtHostDocumentsAndEditors, "$acceptDocumentsAndEditorsDelta", [editorDelta], false),
  );
  runtime.log(
    `[openFile] ts=${Date.now()} addedEditors=[${editorId}] removedEditors=[${shouldReplaceEditor ? prevEditorId || "" : ""}] newActiveEditor=${editorId}`,
  );

  runtime.spanTrace("openFile.send.editorState", () => {
    runtime.sendExt(runtime.extRpcIds.ExtHostEditors, "$acceptEditorDiffInformation", [editorId, []], false);
    runtime.sendExt(
      runtime.extRpcIds.ExtHostEditors,
      "$acceptEditorPropertiesChanged",
      [
        editorId,
        {
          options: null,
          selections: {
            selections: [
              {
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: 1,
                selectionStartLineNumber: 1,
                selectionStartColumn: 1,
                positionLineNumber: 1,
                positionColumn: 1,
              },
            ],
            source: "mouse",
          },
          visibleRanges: null,
        },
      ],
      false,
    );
    runtime.sendExt(runtime.extRpcIds.ExtHostEditors, "$acceptEditorPositionData", [{ [editorId]: 0 }], false);
    runtime.sendExt(
      runtime.extRpcIds.ExtHostDocuments,
      "$acceptDirtyStateChanged",
      [uriObj, retained.entry.dirty],
      false,
    );
  });
  void runtime.activateLanguage(languageId).catch((error) => {
    runtime.warn(
      `[openFile] language activation failed languageId=${languageId}: ${String((error as Error)?.message ?? error)}`,
    );
  });
  runtime.session.activeEditorId = editorId;
  runtime.session.activeUriObj = uriObj;
  runtime.session.activeTab = tabActive;
  runtime.onEvent({
    type: "document/activeChanged",
    ts_ms: Date.now(),
    path,
    activeEpoch: promoted.entry.activeEpoch,
    generation,
    workspaceFolder: runtime.state.workspaceFolder,
  });
  return { ok: true, req: reqDocs };
}

export function didChange(
  runtime: LifecycleRuntime,
  params: unknown = {},
  opts: DidChangeOptions = {},
): Record<string, unknown> | Promise<Record<string, unknown>> {
  runtime.ensureConnected();
  const input = isRecord(params) ? params : {};
  const path = String(input.path ?? "");
  const text = normalizeDocumentText(String(input.text ?? ""));
  const languageId = runtime.resolveLanguageId(path, text, input.languageId);
  const generation = coerceOptionalGeneration(input.generation);

  const guard = openGuard(runtime, path, generation);
  if (guard) return guard;

  const waitForAck = opts.waitForAck === true;
  const replaced = runtime.session.documentRegistry.replaceFullText(
    {
      path,
      text,
      languageId,
      openGeneration: generation,
      dirty: true,
    },
    {
      waitForAck,
      timeoutMs: Number(opts.timeoutMs ?? 3000),
      isDirtyEvent: true,
    },
  );
  if (!replaced.ok) {
    runtime.warn(`[didChange] drop path=${path} reason=${replaced.error}`);
    return { ok: false, error: replaced.error };
  }
  const nextVersion = replaced.versionId;
  if (runtime.state.activePath === path) {
    runtime.state.activeLanguageId = languageId;
  }
  void runtime.activateLanguage(languageId).catch((error) => {
    runtime.warn(
      `[didChange] language activation failed languageId=${languageId}: ${String((error as Error)?.message ?? error)}`,
    );
  });
  runtime.log(
    `[didChange] ts=${Date.now()} path=${path} ver=${nextVersion} contentChanged=${replaced.contentChanged ? 1 : 0} bytes=${text.length} prevLines=${replaced.previousLineCount} prevLastLineLen=${replaced.previousLastLineLength} newLines=${replaced.entry.lineCount}`,
  );
  if (replaced.ack) {
    return replaced.ack.promise.then((reply) => ({
      ok: true,
      versionId: nextVersion,
      contentChanged: replaced.contentChanged,
      ackReq: replaced.ack!.req,
      ackType: isRecord(reply) ? reply.type : undefined,
    }));
  }
  return {
    ok: true,
    versionId: nextVersion,
    contentChanged: replaced.contentChanged,
  };
}

export async function switchWorkspace(runtime: LifecycleRuntime, newFolder: string): Promise<WorkspaceSwitchResult> {
  runtime.ensureConnected();
  const rootPath = String(newFolder);
  const name = rootPath.split("/").filter(Boolean).slice(-1)[0] || rootPath;
  const wsId = runtime.sha1Short(rootPath);
  const authority = runtime.useRemote ? runtime.authority : null;
  const folderUri = runtime.uriForPath(rootPath, authority);
  const cleanup = runtime.clearProjectScopedSwitchState("workspace_switch");

  if (runtime.session.activeUriObj) {
    try {
      runtime.sendExt(
        runtime.extRpcIds.ExtHostDocumentsAndEditors,
        "$acceptDocumentsAndEditorsDelta",
        [{
          removedEditors: [runtime.session.activeEditorId].filter(Boolean),
          newActiveEditor: null,
        }],
        false,
      );
      runtime.log(
        "[switchWorkspace] removed active editor facade before workspace switch",
      );
    } catch (error) {
      runtime.log(
        `[switchWorkspace] warn: failed to remove active editor: ${String((error as Error)?.message ?? error)}`,
      );
    }
    runtime.session.activeUriObj = null;
    runtime.session.activeEditorId = null;
    runtime.session.activeTab = null;
  }
  try {
    runtime.session.documentRegistry.releaseAll();
  } catch (error) {
    runtime.log(
      `[switchWorkspace] warn: failed to release retained documents: ${String((error as Error)?.message ?? error)}`,
    );
  }

  const workspace = {
    isUntitled: false,
    folders: [{ uri: folderUri, name, index: 0 }],
    id: wsId,
    name,
    transient: false,
  };
  runtime.sendExt(runtime.extRpcIds.ExtHostWorkspace, "$acceptWorkspaceData", [workspace], false);
  runtime.log(`[switchWorkspace] $acceptWorkspaceData → ${rootPath} (id=${wsId})`);

  const prevFolder = runtime.state.workspaceFolder;
  runtime.state.workspaceFolder = rootPath;
  runtime.state.activePath = null;
  runtime.state.activeUri = null;
  runtime.state.activeLanguageId = null;

  let watcherStatus: WorkspaceSwitchResult["watcherStatus"] = runtime.watcher.mgmtIpc ? "subscribed" : "skipped";
  let watcherError: string | undefined;
  try {
    await setupFileWatcher(runtime, rootPath);
    runtime.log(`[switchWorkspace] file watcher re-subscribed to ${rootPath}`);
  } catch (error) {
    watcherStatus = "error";
    watcherError = String((error as Error)?.message ?? error);
    runtime.log(`[switchWorkspace] warn: watcher re-subscribe failed: ${watcherError}`);
  }

  runtime.onEvent({
    type: "workspace/switched",
    ts_ms: Date.now(),
    from: prevFolder,
    to: rootPath,
    workspaceFolder: rootPath,
    readyForDocumentOpen: true,
    cleanup,
    watcherStatus,
  });

  return {
    ok: true,
    readyForDocumentOpen: true,
    workspaceFolder: rootPath,
    previousWorkspaceFolder: prevFolder,
    watcherStatus,
    ...(watcherError ? { watcherError } : {}),
    cleanup,
  };
}

export async function setupFileWatcher(runtime: LifecycleRuntime, workspaceRoot: string | null): Promise<void> {
  if (!runtime.watcher.mgmtIpc) {
    runtime.log("[watcher] no _mgmtIpc, skipping watcher setup");
    return;
  }
  try {
    runtime.watcher.fsWatcherSub?.dispose?.();
    runtime.watcher.fsWatcherSub = null;
    const sessionId = runtime.randomUuid();
    runtime.log(`[watcher] setting up IPC listen on remoteFilesystem/fileChange sessionId=${sessionId}`);
    const sub = runtime.watcher.mgmtIpc.listen("remoteFilesystem", "fileChange", [sessionId]);
    runtime.log("[watcher] listen() called, subscription created");
    sub.event((changes) => {
      runtime.log(`[watcher] EVENT FIRED: ${JSON.stringify(changes)?.slice(0, 500)}`);
      if (Array.isArray(changes) && changes.length > 0) {
        const filtered = changes.filter((change) => {
          const path = String(field(field(change, "resource"), "path") ?? field(field(change, "resource"), "fsPath") ?? "");
          if (path.includes("/.git/") && path.endsWith(".lock")) return false;
          return true;
        });
        if (filtered.length === 0) return;
        const mapped = filtered.map((change) => ({
          type: field(change, "type"),
          path: String(field(field(change, "resource"), "path") ?? field(field(change, "resource"), "fsPath") ?? String(field(change, "resource") ?? "")),
        }));
        runtime.log(`[watcher] forwarding ${mapped.length} changes via onEvent`);
        runtime.onEvent({ type: "watcher/fileChanges", ts_ms: Date.now(), changes: mapped });
      } else if (typeof changes === "string" && changes.includes("ENOSPC")) {
        runtime.log("[watcher] ENOSPC detected, forwarding watcher/enospc");
        runtime.onEvent({ type: "watcher/enospc", ts_ms: Date.now(), message: changes });
      } else {
        runtime.log(`[watcher] EVENT received but not array or empty: type=${typeof changes} isArr=${Array.isArray(changes)}`);
      }
    });
    runtime.watcher.fsWatcherSub = sub;
    if (workspaceRoot) {
      const watchId = 1;
      const authority = runtime.useRemote ? runtime.authority : null;
      const rootUri = runtime.uriForPath(String(workspaceRoot), authority);
      runtime.log(`[watcher] calling watch() sessionId=${sessionId} watchId=${watchId} uri=${JSON.stringify(rootUri)}`);
      await runtime.watcher.mgmtIpc.call("remoteFilesystem", "watch", [sessionId, watchId, rootUri, { recursive: true, excludes: ["**/.git/*.lock"] }]);
      runtime.onEvent({ type: "watcher/subscribed", ts_ms: Date.now(), root: String(workspaceRoot) });
      runtime.log(`[watcher] watch() call returned OK — subscribed to ${workspaceRoot}`);
    } else {
      runtime.log("[watcher] no workspaceRoot, skipping watch() call");
    }
  } catch (error) {
    runtime.onEvent({ type: "watcher/subscribe_error", ts_ms: Date.now(), error: String((error as Error)?.message ?? error) });
    runtime.log(`[watcher] subscribe error: ${String((error as Error)?.stack ?? (error as Error)?.message ?? error)}`);
  }
}

export async function resubscribeWatcher(runtime: LifecycleRuntime): Promise<void> {
  const root = runtime.state.workspaceFolder;
  runtime.log(`[watcher] resubscribeWatcher called, root=${root}`);
  await setupFileWatcher(runtime, root);
}
