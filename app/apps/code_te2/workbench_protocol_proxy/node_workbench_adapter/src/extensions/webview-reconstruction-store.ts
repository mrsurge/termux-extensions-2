import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const MAX_RECORD_BYTES = 8 * 1024 * 1024;
const MAX_ID_LENGTH = 512;
const MAX_STORAGE_ENTRIES = 4096;
const MAX_STORAGE_KEY_LENGTH = 16 * 1024;
const MAX_STORAGE_VALUE_LENGTH = 1024 * 1024;

type JsonObject = Record<string, unknown>;
export type WebviewStorageEntries = [string, string][];

export interface WebviewReconstructionRecord {
  version: 1;
  clientInstanceId: string;
  surfaceId: string;
  revision: number;
  writerLease: string;
  vscodeState: unknown;
  localStorage: WebviewStorageEntries;
  updatedAt: string;
}

export interface WebviewReconstructionWrite {
  clientInstanceId: unknown;
  surfaceId: unknown;
  revision: unknown;
  writerLease: unknown;
  vscodeState: unknown;
  localStorage: unknown;
}

function isRecord(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function boundedId(value: unknown, label: string): string {
  if (typeof value !== "string")
    throw new TypeError(`${label} must be a string`);
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > MAX_ID_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new TypeError(
      `${label} must be 1..${MAX_ID_LENGTH} printable characters`,
    );
  }
  return normalized;
}

function revisionNumber(value: unknown): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError(
      "webview reconstruction revision must be a non-negative integer",
    );
  }
  return revision;
}

function storageEntries(value: unknown): WebviewStorageEntries {
  if (!Array.isArray(value))
    throw new TypeError("webview localStorage must be an entry array");
  if (value.length > MAX_STORAGE_ENTRIES) {
    throw new RangeError(
      `webview localStorage exceeds ${MAX_STORAGE_ENTRIES} entries`,
    );
  }
  const entries: WebviewStorageEntries = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2) {
      throw new TypeError("webview localStorage entries must be string pairs");
    }
    const key = item[0];
    const itemValue = item[1];
    if (typeof key !== "string" || typeof itemValue !== "string") {
      throw new TypeError("webview localStorage entries must be string pairs");
    }
    if (
      key.length > MAX_STORAGE_KEY_LENGTH ||
      itemValue.length > MAX_STORAGE_VALUE_LENGTH
    ) {
      throw new RangeError(
        "webview localStorage entry exceeds its bounded size",
      );
    }
    entries.push([key, itemValue]);
  }
  return entries;
}

function digest(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function serializedRecord(record: WebviewReconstructionRecord): string {
  const raw = JSON.stringify(record);
  if (Buffer.byteLength(raw, "utf8") > MAX_RECORD_BYTES) {
    throw new RangeError(
      `webview reconstruction state exceeds ${MAX_RECORD_BYTES} bytes`,
    );
  }
  return raw;
}

function normalizeRecord(
  value: unknown,
  filePath: string,
): WebviewReconstructionRecord {
  if (!isRecord(value) || value.version !== 1) {
    throw new TypeError(`invalid webview reconstruction record: ${filePath}`);
  }
  const record: WebviewReconstructionRecord = {
    version: 1,
    clientInstanceId: boundedId(value.clientInstanceId, "clientInstanceId"),
    surfaceId: boundedId(value.surfaceId, "surfaceId"),
    revision: revisionNumber(value.revision),
    writerLease: boundedId(value.writerLease, "writerLease"),
    vscodeState: value.vscodeState,
    localStorage: storageEntries(value.localStorage),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
  serializedRecord(record);
  return record;
}

async function atomicWrite(filePath: string, raw: string): Promise<void> {
  const parent = path.dirname(filePath);
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = path.join(
    parent,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporary, raw, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export class WebviewReconstructionStore {
  readonly rootPath: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(rootPath: string) {
    const normalized = String(rootPath ?? "").trim();
    if (!normalized)
      throw new Error("TE2 webview reconstruction storage path is required");
    this.rootPath = path.resolve(normalized);
  }

  private filePath(clientInstanceId: string, surfaceId: string): string {
    return path.join(
      this.rootPath,
      "clients",
      digest(clientInstanceId),
      `${digest(surfaceId)}.json`,
    );
  }

  private async readFile(
    clientInstanceId: string,
    surfaceId: string,
  ): Promise<WebviewReconstructionRecord | null> {
    const filePath = this.filePath(clientInstanceId, surfaceId);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      if (Buffer.byteLength(raw, "utf8") > MAX_RECORD_BYTES) {
        throw new RangeError(
          `webview reconstruction file exceeds ${MAX_RECORD_BYTES} bytes: ${filePath}`,
        );
      }
      const record = normalizeRecord(JSON.parse(raw), filePath);
      if (
        record.clientInstanceId !== clientInstanceId ||
        record.surfaceId !== surfaceId
      ) {
        throw new Error(
          `webview reconstruction identity mismatch: ${filePath}`,
        );
      }
      return record;
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async attach(
    clientValue: unknown,
    surfaceValue: unknown,
  ): Promise<WebviewReconstructionRecord> {
    const clientInstanceId = boundedId(clientValue, "clientInstanceId");
    const surfaceId = boundedId(surfaceValue, "surfaceId");
    let attached!: WebviewReconstructionRecord;
    const operation = this.queue.then(async () => {
      const existing = await this.readFile(clientInstanceId, surfaceId);
      attached = {
        version: 1,
        clientInstanceId,
        surfaceId,
        revision: existing?.revision ?? 0,
        writerLease: crypto.randomUUID(),
        vscodeState: existing?.vscodeState ?? null,
        localStorage: existing?.localStorage ?? [],
        updatedAt: new Date().toISOString(),
      };
      await atomicWrite(
        this.filePath(clientInstanceId, surfaceId),
        serializedRecord(attached),
      );
    });
    this.queue = operation.catch(() => undefined);
    await operation;
    return structuredClone(attached);
  }

  async write(
    value: WebviewReconstructionWrite,
  ): Promise<{ ok: true; accepted: boolean; revision: number }> {
    const clientInstanceId = boundedId(
      value.clientInstanceId,
      "clientInstanceId",
    );
    const surfaceId = boundedId(value.surfaceId, "surfaceId");
    const writerLease = boundedId(value.writerLease, "writerLease");
    const revision = revisionNumber(value.revision);
    const localStorage = storageEntries(value.localStorage);
    let result = { ok: true as const, accepted: false, revision };
    const operation = this.queue.then(async () => {
      const current = await this.readFile(clientInstanceId, surfaceId);
      if (
        !current ||
        current.writerLease !== writerLease ||
        revision <= current.revision
      ) {
        result = {
          ok: true,
          accepted: false,
          revision: current?.revision ?? 0,
        };
        return;
      }
      const next: WebviewReconstructionRecord = {
        version: 1,
        clientInstanceId,
        surfaceId,
        revision,
        writerLease,
        vscodeState: value.vscodeState,
        localStorage,
        updatedAt: new Date().toISOString(),
      };
      await atomicWrite(
        this.filePath(clientInstanceId, surfaceId),
        serializedRecord(next),
      );
      result = { ok: true, accepted: true, revision };
    });
    this.queue = operation.catch(() => undefined);
    await operation;
    return result;
  }

  async resetClient(
    clientValue: unknown,
  ): Promise<{ ok: true; clientInstanceId: string }> {
    const clientInstanceId = boundedId(clientValue, "clientInstanceId");
    const clientPath = path.join(
      this.rootPath,
      "clients",
      digest(clientInstanceId),
    );
    const operation = this.queue.then(() =>
      fs.rm(clientPath, { recursive: true, force: true }),
    );
    this.queue = operation.catch(() => undefined);
    await operation;
    return { ok: true, clientInstanceId };
  }
}
