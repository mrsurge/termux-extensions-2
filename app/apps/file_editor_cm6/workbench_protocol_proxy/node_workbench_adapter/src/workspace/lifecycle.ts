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
  docVersions: Map<string, number>;
  docLineCount: Map<string, number>;
  docCharCount: Map<string, number>;
  docLastLineLength: Map<string, number>;
  docOpenGeneration: Map<string, number | string | null>;
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
  sendExtAwaitTerminalReply: (
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable?: boolean,
    timeoutMs?: number,
  ) => { req: number; promise: Promise<unknown> };
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

function lastLineLength(lines: string[]): number {
  return (lines[lines.length - 1] ?? "").length;
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

function currentDocVersion(runtime: LifecycleRuntime, path: string): number | null {
  return runtime.session.docVersions.get(path) ?? null;
}

function currentOpenGeneration(runtime: LifecycleRuntime, path: string): number | string | null | undefined {
  return runtime.session.docOpenGeneration.get(path);
}

function openGuard(runtime: LifecycleRuntime, path: string, generation: number | string | null): Record<string, unknown> | null {
  if (
    !runtime.session.docVersions.has(path) ||
    !runtime.session.docLineCount.has(path) ||
    !runtime.session.docCharCount.has(path)
  ) {
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

function clearTrackedDocumentState(runtime: LifecycleRuntime, path: string): void {
  if (!path) return;
  runtime.session.docVersions.delete(path);
  runtime.session.docLineCount.delete(path);
  runtime.session.docCharCount.delete(path);
  runtime.session.docLastLineLength.delete(path);
  runtime.session.docOpenGeneration.delete(path);
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

  const rawText = await runtime.spanTraceAsync("openFile.fs.readFile", () => runtime.readTextFile(path));
  const text = normalizeDocumentText(rawText);
  const languageId = runtime.resolveLanguageId(path, text, input.languageId);
  const lines = runtime.spanTrace("openFile.text.splitLines", () => text.split("\n"));
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
  const uriObj = runtime.spanTrace("openFile.uriForPath", () => runtime.uriForPath(path, authority));
  updateActiveState(runtime, path, uriObj, languageId);

  const prevAbs = previousPath(prevUriObj);
  const isSameFileReopen = shouldTreatAsSameFile(prevUriObj, path);
  const shouldClosePrev = !!(
    prevUriObj &&
    prevAbs &&
    !isSameFileReopen &&
    (forceRefresh || prevAbs !== path)
  );

  const modelN = runtime.session.nextModelNumber++;
  const editorId = `vs.editor.ICodeEditor:2,$model${modelN}`;
  const visibleEndLineNumber = Math.min(lines.length || 1, 31);
  const visibleEndColumn = Math.max(1, Math.min((lines[visibleEndLineNumber - 1] ?? "").length + 1, 1000));

  const tabId = `0~default-workbench.editors.files.fileEditorInput-${String(field(uriObj, "external") ?? runtime.uriToString(uriObj))} `;
  const tab = {
    id: tabId,
    label: path.split("/").filter(Boolean).slice(-1)[0] || path,
    editorId: "default",
    input: { kind: 1, uri: uriObj },
    isPinned: false,
    isPreview: true,
    isActive: true,
    isDirty: false,
  };
  const tabInactive = { ...tab, isActive: false };
  const tabActive = { ...tab, isActive: true };
  const tabModel = [
    {
      groupId: 0,
      isActive: true,
      viewColumn: 0,
      tabs: [tab],
    },
  ];

  try {
    if (shouldClosePrev && prevTab) {
      runtime.spanTrace("openFile.send.tabOp.closePrev", () =>
        runtime.sendExt(runtime.extRpcIds.ExtHostEditorTabs, "$acceptTabOperation", [{ groupId: 0, index: 0, tabDto: prevTab, kind: 1 }], false),
      );
      runtime.log(`[openFile] ts=${Date.now()} tabOp kind=1 closePrev tab=${String(field(prevTab, "label") || "")}`);
    }
  } catch {
    // Keep current behavior: do not abort on tab prelude failures.
  }
  try {
    runtime.spanTrace("openFile.send.tabOp.addInactive", () =>
      runtime.sendExt(runtime.extRpcIds.ExtHostEditorTabs, "$acceptTabOperation", [{ groupId: 0, index: 0, tabDto: tabInactive, kind: 0 }], false),
    );
    runtime.log(`[openFile] ts=${Date.now()} tabOp kind=0 addInactive tab=${String(field(tabInactive, "label") || "")}`);
  } catch {}
  try {
    runtime.spanTrace("openFile.send.tabOp.activate", () =>
      runtime.sendExt(runtime.extRpcIds.ExtHostEditorTabs, "$acceptTabOperation", [{ groupId: 0, index: 0, tabDto: tabActive, kind: 2 }], false),
    );
    runtime.log(`[openFile] ts=${Date.now()} tabOp kind=2 activate tab=${String(field(tabActive, "label") || "")}`);
  } catch {}

  runtime.spanTrace("openFile.send.tabModel", () =>
    runtime.sendExt(runtime.extRpcIds.ExtHostEditorTabs, "$acceptEditorTabModel", [tabModel], false),
  );
  try {
    runtime.log(
      `[openFile] ts=${Date.now()} path=${path} lang=${languageId} editorId=${editorId} forceRefresh=${forceRefresh ? 1 : 0} shouldClosePrev=${shouldClosePrev} prevEditorId=${prevEditorId || ""} prevPath=${prevAbs}`,
    );
  } catch {}

  if (shouldClosePrev) {
    try {
      runtime.spanTrace("openFile.send.delta.removedDocuments", () =>
        runtime.sendExt(runtime.extRpcIds.ExtHostDocumentsAndEditors, "$acceptDocumentsAndEditorsDelta", [{ removedDocuments: [prevUriObj] }], false),
      );
      runtime.log(`[openFile] ts=${Date.now()} removedDocuments=[${prevAbs || "?"}]`);
    } catch {}
    clearTrackedDocumentState(runtime, prevAbs);
  }

  if (isSameFileReopen) {
    const prevVersion = runtime.session.docVersions.get(path) || 1;
    const newVersion = prevVersion + 1;
    const prevLineCount = runtime.session.docLineCount.get(path) || 1;
    const prevCharCount = runtime.session.docCharCount.get(path) || 0;
    const prevLastLineLen = runtime.session.docLastLineLength.get(path) ?? 10000;
    runtime.log(`[openFile] ts=${Date.now()} same-file reopen, sending $didChange instead of remove+add (v${prevVersion}→v${newVersion})`);
    runtime.sendExt(
      runtime.extRpcIds.ExtHostDocuments,
      "$acceptModelChanged",
      [
        uriObj,
        {
          changes: [{
            range: { startLineNumber: 1, startColumn: 1, endLineNumber: prevLineCount, endColumn: prevLastLineLen + 1 },
            rangeOffset: 0,
            rangeLength: prevCharCount,
            text,
          }],
          eol: "\n",
          versionId: newVersion,
          isUndoing: false,
          isRedoing: false,
          isFlush: true,
        },
        false,
      ],
      false,
    );
    runtime.session.docVersions.set(path, newVersion);
    runtime.session.docLineCount.set(path, lines.length);
    runtime.session.docCharCount.set(path, text.length);
    runtime.session.docLastLineLength.set(path, lastLineLength(lines));
    runtime.session.docOpenGeneration.set(path, generation);
    runtime.session.activeEditorId = prevEditorId;
    runtime.session.activeUriObj = uriObj;
    runtime.session.activeTab = prevTab;
    void runtime.activateLanguage(languageId).catch((error) => {
      runtime.warn(
        `[openFile] language activation failed languageId=${languageId}: ${String((error as Error)?.message ?? error)}`,
      );
    });
    return { ok: true, req: null };
  }

  const docDelta = runtime.spanTrace("openFile.buildDelta.addedDocuments", () => ({
    addedDocuments: [{ uri: uriObj, versionId: 1, lines, EOL: "\n", languageId, isDirty: false, encoding: "utf8" }],
  }));
  runtime.spanTrace("openFile.send.delta.addedDocuments", () =>
    runtime.sendExt(runtime.extRpcIds.ExtHostDocumentsAndEditors, "$acceptDocumentsAndEditorsDelta", [docDelta], false),
  );
  runtime.log(`[openFile] ts=${Date.now()} addedDocuments=[${path}] lineCount=${lines.length}`);
  runtime.session.docVersions.set(path, 1);
  runtime.session.docLineCount.set(path, lines.length);
  runtime.session.docCharCount.set(path, text.length);
  runtime.session.docLastLineLength.set(path, lastLineLength(lines));
  runtime.session.docOpenGeneration.set(path, generation);
  try {
    const addedDocuments = (docDelta as { addedDocuments?: Array<{ lines?: unknown }> }).addedDocuments;
    const firstAddedDocument = Array.isArray(addedDocuments) ? addedDocuments[0] : undefined;
    if (firstAddedDocument) {
      firstAddedDocument.lines = null;
    }
  } catch {}

  const editorDelta = runtime.spanTrace("openFile.buildDelta.addedEditors", () => ({
    newActiveEditor: editorId,
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
  runtime.log(`[openFile] ts=${Date.now()} addedEditors=[${editorId}] newActiveEditor=${editorId}`);

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
    runtime.sendExt(runtime.extRpcIds.ExtHostDocuments, "$acceptDirtyStateChanged", [uriObj, false], false);
  });
  void runtime.activateLanguage(languageId).catch((error) => {
    runtime.warn(
      `[openFile] language activation failed languageId=${languageId}: ${String((error as Error)?.message ?? error)}`,
    );
  });
  runtime.session.activeEditorId = editorId;
  runtime.session.activeUriObj = uriObj;
  runtime.session.activeTab = tabActive;
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
  const authority = String(input.authority ?? runtime.authority);
  const generation = coerceOptionalGeneration(input.generation);

  const guard = openGuard(runtime, path, generation);
  if (guard) return guard;

  const prevVersion = runtime.session.docVersions.get(path) ?? 1;
  const nextVersion = prevVersion + 1;
  runtime.session.docVersions.set(path, nextVersion);

  const uriObj = runtime.uriForPath(path, authority);
  const prevLines = runtime.session.docLineCount.get(path) ?? 1;
  const prevLastLineLen = runtime.session.docLastLineLength.get(path) ?? 10000;
  const newLines = text.split("\n");
  runtime.session.docLineCount.set(path, newLines.length);
  runtime.session.docLastLineLength.set(path, lastLineLength(newLines));

  const event = {
    changes: [{
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: prevLines, endColumn: prevLastLineLen + 1 },
      rangeOffset: 0,
      rangeLength: runtime.session.docCharCount.get(path) ?? 0,
      text,
    }],
    eol: "\n",
    versionId: nextVersion,
    isUndoing: false,
    isRedoing: false,
    isFlush: true,
    isEolChange: false,
  };

  const waitForAck = opts.waitForAck === true;
  const ack = waitForAck
    ? runtime.sendExtAwaitTerminalReply(
        runtime.extRpcIds.ExtHostDocuments,
        "$acceptModelChanged",
        [uriObj, event, true],
        false,
        Number(opts.timeoutMs ?? 3000),
      )
    : null;
  if (!ack) {
    runtime.sendExt(runtime.extRpcIds.ExtHostDocuments, "$acceptModelChanged", [uriObj, event, true], false);
  }
  runtime.session.docCharCount.set(path, text.length);
  if (runtime.state.activePath === path) {
    runtime.state.activeLanguageId = languageId;
  }
  void runtime.activateLanguage(languageId).catch((error) => {
    runtime.warn(
      `[didChange] language activation failed languageId=${languageId}: ${String((error as Error)?.message ?? error)}`,
    );
  });
  runtime.log(`[didChange] ts=${Date.now()} path=${path} ver=${nextVersion} bytes=${text.length} prevLines=${prevLines} prevLastLineLen=${prevLastLineLen} newLines=${newLines.length}`);
  if (ack) {
    return ack.promise.then((reply) => ({
      ok: true,
      versionId: nextVersion,
      ackReq: ack.req,
      ackType: isRecord(reply) ? reply.type : undefined,
    }));
  }
  return { ok: true, versionId: nextVersion };
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
        [{ removedDocuments: [runtime.session.activeUriObj], removedEditors: [runtime.session.activeEditorId].filter(Boolean), newActiveEditor: null }],
        false,
      );
      runtime.log("[switchWorkspace] closed active document before workspace switch");
    } catch (error) {
      runtime.log(`[switchWorkspace] warn: failed to close active doc: ${String((error as Error)?.message ?? error)}`);
    }
    runtime.session.activeUriObj = null;
    runtime.session.activeEditorId = null;
    runtime.session.activeTab = null;
  }
  runtime.session.docVersions.clear();
  runtime.session.docLineCount.clear();
  runtime.session.docCharCount.clear();
  runtime.session.docLastLineLength.clear();
  runtime.session.docOpenGeneration.clear();

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
