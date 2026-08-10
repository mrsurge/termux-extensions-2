import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const MAX_MEMENTO_BYTES = 8 * 1024 * 1024;

type JsonObject = Record<string, unknown>;

export interface ExtensionMementoStoreOptions {
  rootPath: string;
  workspacePath: () => string | null;
}

function isRecord(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function extensionKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("extension storage id must be a string");
  }
  const key = value.trim().toLowerCase();
  if (!key || key.length > 512) {
    throw new TypeError("extension storage id must be 1..512 characters");
  }
  return key;
}

function digest(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function serializedValue(value: unknown): string {
  if (!isRecord(value)) {
    throw new TypeError("extension storage value must be a JSON object");
  }
  const raw = JSON.stringify(value);
  if (raw === undefined) {
    throw new TypeError("extension storage value is not JSON serializable");
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_MEMENTO_BYTES) {
    throw new RangeError(
      `extension storage value exceeds ${MAX_MEMENTO_BYTES} bytes`,
    );
  }
  return raw;
}

function validatedRawValue(raw: string, filePath: string): string {
  if (Buffer.byteLength(raw, "utf8") > MAX_MEMENTO_BYTES) {
    throw new RangeError(
      `extension storage file exceeds ${MAX_MEMENTO_BYTES} bytes: ${filePath}`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `extension storage file is invalid JSON: ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!isRecord(value)) {
    throw new TypeError(
      `extension storage file must contain a JSON object: ${filePath}`,
    );
  }
  return JSON.stringify(value);
}

async function atomicWrite(filePath: string, raw: string): Promise<void> {
  const parent = path.dirname(filePath);
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(
    parent,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporaryPath, raw, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export class ExtensionMementoStore {
  readonly rootPath: string;
  readonly workspacePath: () => string | null;
  private writeQueue: Promise<void>;

  constructor(options: ExtensionMementoStoreOptions) {
    const rootPath = String(options.rootPath ?? "").trim();
    if (!rootPath) {
      throw new Error("TE2 extension storage path is required");
    }
    this.rootPath = path.resolve(rootPath);
    this.workspacePath = options.workspacePath;
    this.writeQueue = Promise.resolve();
  }

  private filePath(shared: boolean, extensionId: string): string {
    const extensionHash = digest(extensionKey(extensionId));
    if (shared) {
      return path.join(this.rootPath, "global", `${extensionHash}.json`);
    }
    const workspacePath = this.workspacePath();
    const workspaceIdentity = workspacePath
      ? path.resolve(workspacePath)
      : "empty-window";
    return path.join(
      this.rootPath,
      "workspaces",
      digest(workspaceIdentity),
      `${extensionHash}.json`,
    );
  }

  async initialize(
    shared: boolean,
    extensionId: string,
  ): Promise<string | undefined> {
    await this.writeQueue;
    const filePath = this.filePath(shared, extensionId);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return validatedRawValue(raw, filePath);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }
  }

  setValue(
    shared: boolean,
    extensionId: string,
    value: unknown,
  ): Promise<void> {
    const filePath = this.filePath(shared, extensionId);
    const raw = serializedValue(value);
    const operation = this.writeQueue.then(() => atomicWrite(filePath, raw));
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }
}
