import * as nodePath from "node:path";

import { semanticTextFingerprint } from "../extensions/intelligence/semantic-token-projections.mjs";

export type WorkbenchDocumentRole =
  | "active"
  | "background"
  | "provisional-background";

export interface WorkbenchDocumentEntry {
  path: string;
  uri: Record<string, unknown>;
  uriKey: string;
  role: WorkbenchDocumentRole;
  versionId: number;
  lineCount: number;
  charCount: number;
  lastLineLength: number;
  openGeneration: number | string | null;
  languageId: string;
  textFingerprint: string;
  contentIdentity: string | null;
  baseSha256: string | null;
  openStateRevision: number;
  projectGeneration: number | null;
  dirty: boolean;
  activeEpoch: number;
}

export interface DocumentRegistryRpcIds {
  ExtHostDocumentsAndEditors: number;
  ExtHostDocuments: number;
  ExtHostEditorTabs: number;
}

export interface DocumentRegistryRuntime {
  extRpcIds: DocumentRegistryRpcIds;
  uriToString: (uri: unknown) => string;
  sendExt: (
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable?: boolean,
  ) => unknown;
  sendExtAwaitTerminalReply: (
    rpcId: number,
    method: string,
    args: unknown[],
    cancellable?: boolean,
    timeoutMs?: number,
  ) => { req: number; promise: Promise<unknown> };
  uriForPath: (path: string) => Record<string, unknown>;
  workspacePath: () => string | null;
  resolveLanguageId: (
    path: string,
    text: string,
    requestedLanguageId?: unknown,
  ) => string;
  activateLanguage: (languageId: string) => Promise<unknown>;
  log: (...args: unknown[]) => void;
}

export interface RetainDocumentInput {
  path: string;
  uri: Record<string, unknown>;
  text: string;
  languageId: string;
  role?: WorkbenchDocumentRole;
  openGeneration?: number | string | null;
  contentIdentity?: string | null;
  baseSha256?: string | null;
  openStateRevision?: number;
  projectGeneration?: number | null;
  dirty?: boolean;
  encoding?: string;
}

export interface DocumentMutationGuard {
  expectedActiveEpoch?: number;
  expectedOpenStateRevision?: number;
  expectedProjectGeneration?: number | null;
  expectedContentIdentity?: string | null;
}

export interface ReplaceDocumentInput extends DocumentMutationGuard {
  path: string;
  text: string;
  languageId?: string;
  openGeneration?: number | string | null;
  contentIdentity?: string | null;
  baseSha256?: string | null;
  openStateRevision?: number;
  projectGeneration?: number | null;
  dirty?: boolean;
}

export interface ReplaceDocumentOptions {
  waitForAck?: boolean;
  timeoutMs?: number;
  isDirtyEvent?: boolean;
}

export interface DocumentReplaceSuccess {
  ok: true;
  entry: WorkbenchDocumentEntry;
  contentChanged: boolean;
  versionId: number;
  previousVersionId: number;
  previousLineCount: number;
  previousCharCount: number;
  previousLastLineLength: number;
  ack: { req: number; promise: Promise<unknown> } | null;
}

export interface DocumentReplaceRejected {
  ok: false;
  error:
    | "document_not_open"
    | "stale_active_epoch"
    | "stale_open_state_revision"
    | "stale_project_generation"
    | "stale_content_identity";
  entry?: WorkbenchDocumentEntry;
}

export type DocumentReplaceResult =
  | DocumentReplaceSuccess
  | DocumentReplaceRejected;

interface AddedDocumentDto {
  uri: Record<string, unknown>;
  versionId: number;
  lines: string[] | null;
  EOL: string;
  languageId: string;
  isDirty: boolean;
  encoding: string;
}

interface LogicalDocumentDescriptor {
  path: string;
  languageId: string;
  contentIdentity: string;
  baseSha256: string | null;
  dirty: boolean;
}

interface LogicalDocumentSnapshot {
  projectPath: string;
  projectGeneration: number;
  openStateRevision: number;
  activePath: string | null;
  activeEpoch: number;
  background: Map<string, LogicalDocumentDescriptor>;
}

interface LogicalHydrationRequest extends LogicalDocumentDescriptor {
  reason: "missing" | "content_identity_mismatch";
  expectedActiveEpoch: number;
}

interface LogicalDocumentRejected {
  index?: number;
  path?: string;
  error: string;
}

interface ParsedLogicalHydration {
  projectPath: string;
  projectGeneration: number;
  openStateRevision: number;
  expectedActiveEpoch: number;
  path: string;
  text: string;
  languageId: string;
  contentIdentity: string;
  baseSha256: string | null;
  dirty: boolean;
}

function lastLineLength(lines: string[]): number {
  return (lines[lines.length - 1] ?? "").length;
}

function hasOwn(object: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function requiredInteger(value: unknown): number | null {
  if (typeof value !== "number") return null;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeAbsolutePath(value: unknown): string | null {
  const raw = requiredString(value);
  if (!raw || !nodePath.isAbsolute(raw)) return null;
  return nodePath.resolve(raw);
}

function isPathWithin(path: string, projectPath: string): boolean {
  return path === projectPath || path.startsWith(`${projectPath}${nodePath.sep}`);
}

/**
 * Owns extension-host document identity independently from the one synthetic
 * editor facade used for the active browser model.
 */
export class WorkbenchDocumentRegistry {
  private readonly _byPath = new Map<string, WorkbenchDocumentEntry>();
  private readonly _byUri = new Map<string, WorkbenchDocumentEntry>();
  private _activeEpoch = 0;
  private _logicalSnapshot: LogicalDocumentSnapshot | null = null;

  constructor(private readonly runtime: DocumentRegistryRuntime) {}

  get size(): number {
    return this._byPath.size;
  }

  get activeEpoch(): number {
    return this._activeEpoch;
  }

  values(): WorkbenchDocumentEntry[] {
    return [...this._byPath.values()];
  }

  getByPath(path: string): WorkbenchDocumentEntry | null {
    return this._byPath.get(String(path)) ?? null;
  }

  getByUri(uri: unknown): WorkbenchDocumentEntry | null {
    return this._byUri.get(this.runtime.uriToString(uri)) ?? null;
  }

  getVersion(path: string): number | null {
    return this.getByPath(path)?.versionId ?? null;
  }

  getOpenGeneration(
    path: string,
  ): number | string | null | undefined {
    const entry = this.getByPath(path);
    return entry ? entry.openGeneration : undefined;
  }

  countBackground(): number {
    let count = 0;
    for (const entry of this._byPath.values()) {
      if (entry.role !== "active") count += 1;
    }
    return count;
  }

  retain(input: RetainDocumentInput): {
    entry: WorkbenchDocumentEntry;
    added: boolean;
  } {
    const path = String(input.path);
    const uriKey = this.runtime.uriToString(input.uri);
    const existing =
      this._byPath.get(path) ?? this._byUri.get(uriKey) ?? null;
    if (existing) {
      return { entry: existing, added: false };
    }

    const lines = input.text.split("\n");
    const entry: WorkbenchDocumentEntry = {
      path,
      uri: input.uri,
      uriKey,
      role: input.role ?? "background",
      versionId: 1,
      lineCount: lines.length,
      charCount: input.text.length,
      lastLineLength: lastLineLength(lines),
      openGeneration: input.openGeneration ?? null,
      languageId: input.languageId || "plaintext",
      textFingerprint: semanticTextFingerprint(input.text),
      contentIdentity: input.contentIdentity ?? null,
      baseSha256: input.baseSha256 ?? null,
      openStateRevision: input.openStateRevision ?? 0,
      projectGeneration: input.projectGeneration ?? null,
      dirty: input.dirty === true,
      activeEpoch: 0,
    };
    const addedDocument: AddedDocumentDto = {
      uri: entry.uri,
      versionId: entry.versionId,
      lines,
      EOL: "\n",
      languageId: entry.languageId,
      isDirty: entry.dirty,
      encoding: input.encoding || "utf8",
    };
    this.runtime.sendExt(
      this.runtime.extRpcIds.ExtHostDocumentsAndEditors,
      "$acceptDocumentsAndEditorsDelta",
      [{ addedDocuments: [addedDocument] }],
      false,
    );
    this._byPath.set(path, entry);
    this._byUri.set(uriKey, entry);
    addedDocument.lines = null;
    this._syncTabModel();
    this.runtime.log(
      `[document_registry] retained path=${path} role=${entry.role} version=1`,
    );
    return { entry, added: true };
  }

  promote(path: string, openGeneration?: number | string | null): {
    entry: WorkbenchDocumentEntry;
    demoted: WorkbenchDocumentEntry | null;
  } {
    const entry = this._require(path);
    let demoted: WorkbenchDocumentEntry | null = null;
    for (const candidate of this._byPath.values()) {
      if (candidate !== entry && candidate.role === "active") {
        candidate.role = "provisional-background";
        demoted = candidate;
      }
    }
    this._activeEpoch += 1;
    entry.role = "active";
    entry.activeEpoch = this._activeEpoch;
    if (openGeneration !== undefined) {
      entry.openGeneration = openGeneration;
    }
    this._syncTabModel();
    return { entry, demoted };
  }

  demote(
    path: string,
    role: Exclude<WorkbenchDocumentRole, "active"> =
      "provisional-background",
  ): WorkbenchDocumentEntry | null {
    const entry = this.getByPath(path);
    if (!entry) return null;
    entry.role = role;
    this._syncTabModel();
    return entry;
  }

  replaceFullText(
    input: ReplaceDocumentInput,
    options: ReplaceDocumentOptions = {},
  ): DocumentReplaceResult {
    const entry = this.getByPath(input.path);
    if (!entry) return { ok: false, error: "document_not_open" };
    const guardError = this._guard(entry, input);
    if (guardError) return { ok: false, error: guardError, entry };

    const previousVersionId = entry.versionId;
    const previousLineCount = entry.lineCount;
    const previousCharCount = entry.charCount;
    const previousLastLineLength = entry.lastLineLength;
    const textFingerprint = semanticTextFingerprint(input.text);
    const contentChanged =
      previousCharCount !== input.text.length ||
      entry.textFingerprint !== textFingerprint;
    const lines = contentChanged ? input.text.split("\n") : null;
    const versionId = contentChanged
      ? previousVersionId + 1
      : previousVersionId;

    entry.versionId = versionId;
    if (lines) {
      entry.lineCount = lines.length;
      entry.charCount = input.text.length;
      entry.lastLineLength = lastLineLength(lines);
    }
    entry.textFingerprint = textFingerprint;
    const previousLanguageId = entry.languageId;
    const previousDirty = entry.dirty;
    if (input.languageId) entry.languageId = input.languageId;
    if (hasOwn(input, "openGeneration")) {
      entry.openGeneration = input.openGeneration ?? null;
    }
    if (hasOwn(input, "contentIdentity")) {
      entry.contentIdentity = input.contentIdentity ?? null;
    }
    if (hasOwn(input, "baseSha256")) {
      entry.baseSha256 = input.baseSha256 ?? null;
    }
    if (hasOwn(input, "openStateRevision")) {
      entry.openStateRevision = input.openStateRevision ?? 0;
    }
    if (hasOwn(input, "projectGeneration")) {
      entry.projectGeneration = input.projectGeneration ?? null;
    }
    if (hasOwn(input, "dirty")) entry.dirty = input.dirty === true;

    const event = contentChanged
      ? {
          changes: [{
            range: {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: previousLineCount,
              endColumn: previousLastLineLength + 1,
            },
            rangeOffset: 0,
            rangeLength: previousCharCount,
            text: input.text,
          }],
          eol: "\n",
          versionId,
          isUndoing: false,
          isRedoing: false,
          isFlush: true,
          isEolChange: false,
        }
      : null;
    const args = event
      ? [
          entry.uri,
          event,
          options.isDirtyEvent ?? entry.dirty,
        ]
      : null;
    const ack = args && options.waitForAck === true
      ? this.runtime.sendExtAwaitTerminalReply(
          this.runtime.extRpcIds.ExtHostDocuments,
          "$acceptModelChanged",
          args,
          false,
          Number(options.timeoutMs ?? 3000),
        )
      : null;
    if (args && !ack) {
      this.runtime.sendExt(
        this.runtime.extRpcIds.ExtHostDocuments,
        "$acceptModelChanged",
        args,
        false,
      );
    }
    if (entry.languageId !== previousLanguageId) {
      this.runtime.sendExt(
        this.runtime.extRpcIds.ExtHostDocuments,
        "$acceptModelLanguageChanged",
        [entry.uri, entry.languageId],
        false,
      );
    }
    if (entry.dirty !== previousDirty) {
      this.runtime.sendExt(
        this.runtime.extRpcIds.ExtHostDocuments,
        "$acceptDirtyStateChanged",
        [entry.uri, entry.dirty],
        false,
      );
      this._syncTabModel();
    }
    return {
      ok: true,
      entry,
      contentChanged,
      versionId,
      previousVersionId,
      previousLineCount,
      previousCharCount,
      previousLastLineLength,
      ack,
    };
  }

  reconcileLogicalDocuments(
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    // Membership is authoritative, but content crosses the pipe only when the
    // accepted descriptor no longer matches the retained semantic buffer.
    const projectPath = normalizeAbsolutePath(params.projectPath);
    const projectGeneration = requiredInteger(params.projectGeneration);
    const openStateRevision = requiredInteger(params.openStateRevision);
    const rawActivePath = params.activePath;
    const activePath =
      rawActivePath == null ? null : normalizeAbsolutePath(rawActivePath);
    if (!projectPath) {
      return { ok: false, error: "invalid_project_path" };
    }
    if (projectGeneration === null) {
      return { ok: false, error: "invalid_project_generation" };
    }
    if (openStateRevision === null) {
      return { ok: false, error: "invalid_open_state_revision" };
    }
    if (rawActivePath != null && !activePath) {
      return { ok: false, error: "invalid_active_path" };
    }
    if (!Array.isArray(params.background)) {
      return { ok: false, error: "invalid_background_list" };
    }
    if (activePath && !isPathWithin(activePath, projectPath)) {
      return { ok: false, error: "active_path_outside_project" };
    }
    const workspacePath = normalizeAbsolutePath(this.runtime.workspacePath());
    if (workspacePath && workspacePath !== projectPath) {
      return { ok: false, error: "workspace_mismatch" };
    }

    const previous = this._logicalSnapshot;
    if (previous) {
      if (projectGeneration < previous.projectGeneration) {
        return { ok: false, error: "stale_project_generation" };
      }
      if (
        projectGeneration === previous.projectGeneration &&
        projectPath !== previous.projectPath
      ) {
        return { ok: false, error: "project_generation_conflict" };
      }
      if (
        projectGeneration === previous.projectGeneration &&
        openStateRevision < previous.openStateRevision
      ) {
        return { ok: false, error: "stale_open_state_revision" };
      }
    }

    const rejected: LogicalDocumentRejected[] = [];
    const desired = new Map<string, LogicalDocumentDescriptor>();
    const protectedPaths = new Set<string>();
    const rawBackground = params.background;
    for (let index = 0; index < rawBackground.length; index += 1) {
      const raw = rawBackground[index];
      const item = isRecord(raw) ? raw : null;
      const candidatePath = item ? normalizeAbsolutePath(item.path) : null;
      if (!item || !candidatePath) {
        rejected.push({ index, error: "invalid_background_descriptor" });
        continue;
      }
      protectedPaths.add(candidatePath);
      if (!isPathWithin(candidatePath, projectPath)) {
        rejected.push({
          index,
          path: candidatePath,
          error: "path_outside_project",
        });
        continue;
      }
      if (candidatePath === activePath) {
        rejected.push({
          index,
          path: candidatePath,
          error: "active_path_in_background",
        });
        continue;
      }
      if (desired.has(candidatePath)) {
        rejected.push({
          index,
          path: candidatePath,
          error: "duplicate_background_path",
        });
        continue;
      }
      if (desired.size >= 12) {
        rejected.push({
          index,
          path: candidatePath,
          error: "background_limit_exceeded",
        });
        continue;
      }
      const languageId = requiredString(
        this.runtime.resolveLanguageId(candidatePath, "", item.languageId),
      );
      const contentIdentity = requiredString(item.contentIdentity);
      const baseSha256 = nullableString(item.baseSha256);
      if (
        !languageId ||
        !contentIdentity ||
        baseSha256 === undefined ||
        typeof item.dirty !== "boolean"
      ) {
        rejected.push({
          index,
          path: candidatePath,
          error: "invalid_background_descriptor",
        });
        continue;
      }
      desired.set(candidatePath, {
        path: candidatePath,
        languageId,
        contentIdentity,
        baseSha256,
        dirty: item.dirty,
      });
    }

    const activeEntry = this.values().find((entry) => entry.role === "active");
    if (activeEntry) {
      activeEntry.openStateRevision = openStateRevision;
      activeEntry.projectGeneration = projectGeneration;
      protectedPaths.add(activeEntry.path);
    }
    if (activePath) protectedPaths.add(activePath);

    const hydration: LogicalHydrationRequest[] = [];
    for (const descriptor of desired.values()) {
      const entry = this.getByPath(descriptor.path);
      if (!entry) {
        hydration.push({
          ...descriptor,
          reason: "missing",
          expectedActiveEpoch: this._activeEpoch,
        });
        continue;
      }
      if (entry.role === "active") {
        rejected.push({
          path: descriptor.path,
          error: "active_document_protected",
        });
        continue;
      }

      entry.role = "background";
      entry.openStateRevision = openStateRevision;
      entry.projectGeneration = projectGeneration;
      if (entry.contentIdentity !== descriptor.contentIdentity) {
        hydration.push({
          ...descriptor,
          reason: "content_identity_mismatch",
          expectedActiveEpoch: this._activeEpoch,
        });
      } else {
        this._updateMetadata(entry, descriptor);
      }
    }

    const released: string[] = [];
    for (const entry of this.values()) {
      if (
        desired.has(entry.path) ||
        protectedPaths.has(entry.path) ||
        entry.role === "active"
      ) {
        continue;
      }
      if (
        entry.role === "provisional-background" &&
        entry.openStateRevision >= openStateRevision
      ) {
        continue;
      }
      if (this.release(entry.path)) released.push(entry.path);
    }

    this._logicalSnapshot = {
      projectPath,
      projectGeneration,
      openStateRevision,
      activePath,
      activeEpoch: this._activeEpoch,
      background: desired,
    };
    return {
      ok: true,
      projectPath,
      projectGeneration,
      openStateRevision,
      activePath,
      activeEpoch: this._activeEpoch,
      hydration,
      released,
      rejected,
    };
  }

  async hydrateLogicalDocument(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    // Missing documents must exist before language activation so a newly
    // started language client can discover the complete logical open set.
    const parsed = this._parseLogicalHydration(params);
    if (!parsed.ok) return parsed;

    const initial = parsed.value;
    const languageId = initial.languageId;
    const initialExisting = this.getByPath(initial.path);
    const provisional = initialExisting
      ? null
      : this.retain({
          path: initial.path,
          uri: this.runtime.uriForPath(initial.path),
          text: initial.text,
          languageId,
          role: "background",
          contentIdentity: initial.contentIdentity,
          baseSha256: initial.baseSha256,
          openStateRevision: initial.openStateRevision,
          projectGeneration: initial.projectGeneration,
          dirty: initial.dirty,
        }).entry;
    try {
      await this.runtime.activateLanguage(languageId);
    } catch (error) {
      if (provisional) this._rollbackLogicalHydration(provisional, initial);
      return {
        ok: false,
        error: "language_activation_failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }

    const revalidated = this._parseLogicalHydration({
      ...params,
      languageId,
    });
    if (!revalidated.ok) {
      if (provisional) this._rollbackLogicalHydration(provisional, initial);
      return revalidated;
    }
    const input = revalidated.value;
    const existing = this.getByPath(input.path);
    if (provisional) {
      if (existing !== provisional) {
        return { ok: false, error: "hydration_superseded", path: input.path };
      }
      return {
        ok: true,
        action: "retained",
        path: input.path,
        versionId: provisional.versionId,
        activeEpoch: this._activeEpoch,
      };
    }
    if (!existing) {
      return { ok: false, error: "hydration_superseded", path: input.path };
    }

    const replaced = this.replaceFullText(
      {
        path: input.path,
        text: input.text,
        languageId,
        contentIdentity: input.contentIdentity,
        baseSha256: input.baseSha256,
        openStateRevision: input.openStateRevision,
        projectGeneration: input.projectGeneration,
        dirty: input.dirty,
      },
      {
        waitForAck: true,
        timeoutMs: 5000,
        isDirtyEvent: input.dirty,
      },
    );
    if (!replaced.ok) {
      return { ok: false, error: replaced.error, path: input.path };
    }
    if (replaced.ack) await replaced.ack.promise;
    existing.role = "background";
    return {
      ok: true,
      action: "replaced",
      path: input.path,
      versionId: replaced.versionId,
      activeEpoch: this._activeEpoch,
    };
  }

  release(path: string): boolean {
    const entry = this.getByPath(path);
    if (!entry) return false;
    this._delete(entry);
    this._syncTabModel();
    this.runtime.sendExt(
      this.runtime.extRpcIds.ExtHostDocumentsAndEditors,
      "$acceptDocumentsAndEditorsDelta",
      [{ removedDocuments: [entry.uri] }],
      false,
    );
    this.runtime.log(`[document_registry] released path=${entry.path}`);
    return true;
  }

  releaseAll(): number {
    const entries = this.values();
    if (entries.length === 0) return 0;
    try {
      this._byPath.clear();
      this._byUri.clear();
      this._syncTabModel();
      this.runtime.sendExt(
        this.runtime.extRpcIds.ExtHostDocumentsAndEditors,
        "$acceptDocumentsAndEditorsDelta",
        [{ removedDocuments: entries.map((entry) => entry.uri) }],
        false,
      );
    } finally {
      this.clearLocal();
    }
    this.runtime.log(
      `[document_registry] released_all count=${entries.length}`,
    );
    return entries.length;
  }

  clearLocal(): number {
    const count = this._byPath.size;
    this._byPath.clear();
    this._byUri.clear();
    this._activeEpoch = 0;
    this._logicalSnapshot = null;
    return count;
  }

  private _updateMetadata(
    entry: WorkbenchDocumentEntry,
    descriptor: LogicalDocumentDescriptor,
  ): void {
    const previousLanguageId = entry.languageId;
    const previousDirty = entry.dirty;
    entry.languageId = descriptor.languageId;
    entry.baseSha256 = descriptor.baseSha256;
    entry.dirty = descriptor.dirty;
    if (entry.languageId !== previousLanguageId) {
      this.runtime.sendExt(
        this.runtime.extRpcIds.ExtHostDocuments,
        "$acceptModelLanguageChanged",
        [entry.uri, entry.languageId],
        false,
      );
    }
    if (entry.dirty !== previousDirty) {
      this.runtime.sendExt(
        this.runtime.extRpcIds.ExtHostDocuments,
        "$acceptDirtyStateChanged",
        [entry.uri, entry.dirty],
        false,
      );
      this._syncTabModel();
    }
  }

  private _syncTabModel(): void {
    const tabs = this.values().map((entry) => ({
      id: `0~default-workbench.editors.files.fileEditorInput-${this.runtime.uriToString(entry.uri)} `,
      label: nodePath.basename(entry.path) || entry.path,
      editorId: "default",
      input: { kind: 1, uri: entry.uri },
      isPinned: false,
      isPreview: true,
      isActive: entry.role === "active",
      isDirty: entry.dirty,
    }));
    this.runtime.sendExt(
      this.runtime.extRpcIds.ExtHostEditorTabs,
      "$acceptEditorTabModel",
      [[{
        groupId: 0,
        isActive: true,
        viewColumn: 0,
        tabs,
      }]],
      false,
    );
  }

  private _parseLogicalHydration(
    params: Record<string, unknown>,
  ):
    | { ok: true; value: ParsedLogicalHydration }
    | { ok: false; error: string } {
    const snapshot = this._logicalSnapshot;
    if (!snapshot) return { ok: false, error: "logical_snapshot_missing" };
    const projectPath = normalizeAbsolutePath(params.projectPath);
    const projectGeneration = requiredInteger(params.projectGeneration);
    const openStateRevision = requiredInteger(params.openStateRevision);
    const expectedActiveEpoch = requiredInteger(params.expectedActiveEpoch);
    const path = normalizeAbsolutePath(params.path);
    const text = typeof params.text === "string" ? params.text : null;
    const languageId = requiredString(params.languageId);
    const contentIdentity = requiredString(params.contentIdentity);
    const baseSha256 = nullableString(params.baseSha256);
    if (
      !projectPath ||
      projectGeneration === null ||
      openStateRevision === null ||
      expectedActiveEpoch === null ||
      !path ||
      text === null ||
      !languageId ||
      !contentIdentity ||
      baseSha256 === undefined ||
      typeof params.dirty !== "boolean"
    ) {
      return { ok: false, error: "invalid_hydration_params" };
    }
    if (
      projectPath !== snapshot.projectPath ||
      projectGeneration !== snapshot.projectGeneration
    ) {
      return { ok: false, error: "stale_project_generation" };
    }
    if (openStateRevision !== snapshot.openStateRevision) {
      return { ok: false, error: "stale_open_state_revision" };
    }
    if (
      expectedActiveEpoch !== snapshot.activeEpoch ||
      expectedActiveEpoch !== this._activeEpoch
    ) {
      return { ok: false, error: "stale_active_epoch" };
    }
    if (
      path === snapshot.activePath ||
      this.getByPath(path)?.role === "active"
    ) {
      return { ok: false, error: "active_document_protected" };
    }
    const descriptor = snapshot.background.get(path);
    if (!descriptor) {
      return { ok: false, error: "path_not_in_logical_snapshot" };
    }
    if (
      descriptor.languageId !== languageId ||
      descriptor.contentIdentity !== contentIdentity ||
      descriptor.baseSha256 !== baseSha256 ||
      descriptor.dirty !== params.dirty
    ) {
      return { ok: false, error: "hydration_descriptor_mismatch" };
    }
    return {
      ok: true,
      value: {
        projectPath,
        projectGeneration,
        openStateRevision,
        expectedActiveEpoch,
        path,
        text,
        languageId,
        contentIdentity,
        baseSha256,
        dirty: params.dirty,
      },
    };
  }

  private _rollbackLogicalHydration(
    entry: WorkbenchDocumentEntry,
    input: ParsedLogicalHydration,
  ): void {
    const current = this.getByPath(input.path);
    if (
      current !== entry ||
      current.role === "active" ||
      current.contentIdentity !== input.contentIdentity ||
      current.openStateRevision !== input.openStateRevision ||
      current.projectGeneration !== input.projectGeneration
    ) {
      return;
    }
    this.release(input.path);
  }

  private _require(path: string): WorkbenchDocumentEntry {
    const entry = this.getByPath(path);
    if (!entry) throw new Error(`document_not_open: ${path}`);
    return entry;
  }

  private _delete(entry: WorkbenchDocumentEntry): void {
    this._byPath.delete(entry.path);
    this._byUri.delete(entry.uriKey);
  }

  private _guard(
    entry: WorkbenchDocumentEntry,
    guard: DocumentMutationGuard,
  ): DocumentReplaceRejected["error"] | null {
    if (
      guard.expectedActiveEpoch !== undefined &&
      guard.expectedActiveEpoch !== entry.activeEpoch
    ) {
      return "stale_active_epoch";
    }
    if (
      guard.expectedOpenStateRevision !== undefined &&
      guard.expectedOpenStateRevision !== entry.openStateRevision
    ) {
      return "stale_open_state_revision";
    }
    if (
      guard.expectedProjectGeneration !== undefined &&
      guard.expectedProjectGeneration !== entry.projectGeneration
    ) {
      return "stale_project_generation";
    }
    if (
      guard.expectedContentIdentity !== undefined &&
      guard.expectedContentIdentity !== entry.contentIdentity
    ) {
      return "stale_content_identity";
    }
    return null;
  }
}
