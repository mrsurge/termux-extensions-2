import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join } from "node:path";

import {
  LOCAL_FRAMEWORK_CONFIG_VERSION,
  type LocalFrameworkCommandSource,
  type LocalFrameworkConfig,
  type LocalFrameworkConfigView,
} from "../shared/contracts";
import { te2ConfigHome } from "./te2-paths";
import { validateFrameworkPort } from "./target";

export const LOCAL_FRAMEWORK_EXECUTABLE_ENV = "TE2_DESKTOP_TE2_EXECUTABLE";
export const LOCAL_FRAMEWORK_CONFIG_FILENAME = "desktop-local-framework.json";
export const MAX_LOCAL_FRAMEWORK_BROADCAST_SELECTORS = 16;
export const MAX_LOCAL_FRAMEWORK_ENVIRONMENT_ENTRIES = 64;
const MAX_BROADCAST_SELECTOR_LENGTH = 256;
const MAX_ENVIRONMENT_KEY_LENGTH = 128;
const MAX_ENVIRONMENT_VALUE_LENGTH = 16 * 1024;
const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalAbsolutePath(value: unknown, label: string): string {
  const path = String(value ?? "").trim();
  if (!path) return "";
  if (!isAbsolute(path)) throw new Error(`${label} must be an absolute path`);
  if (/\p{Cc}/u.test(path)) throw new Error(`${label} cannot contain control characters`);
  return path;
}

function normalizeBroadcast(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("Broadcast selectors must be an array");
  if (value.length > MAX_LOCAL_FRAMEWORK_BROADCAST_SELECTORS) {
    throw new Error(
      `Only ${MAX_LOCAL_FRAMEWORK_BROADCAST_SELECTORS} broadcast selectors are allowed`,
    );
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const selector = String(item ?? "").trim();
    if (!selector) throw new Error("Broadcast selectors cannot be empty");
    if (selector.length > MAX_BROADCAST_SELECTOR_LENGTH) {
      throw new Error(
        `Broadcast selectors cannot exceed ${MAX_BROADCAST_SELECTOR_LENGTH} characters`,
      );
    }
    if (/\p{Cc}/u.test(selector)) {
      throw new Error("Broadcast selectors cannot contain control characters");
    }
    if (!seen.has(selector)) {
      seen.add(selector);
      result.push(selector);
    }
  }
  if (result.includes("all") && result.length !== 1) {
    throw new Error('The "all" broadcast selector cannot be combined with other selectors');
  }
  return result;
}

function normalizeEnvironment(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error("Environment overrides must be an object");
  const entries = Object.entries(value);
  if (entries.length > MAX_LOCAL_FRAMEWORK_ENVIRONMENT_ENTRIES) {
    throw new Error(
      `Only ${MAX_LOCAL_FRAMEWORK_ENVIRONMENT_ENTRIES} environment overrides are allowed`,
    );
  }
  const result: Record<string, string> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim();
    if (!key || key.length > MAX_ENVIRONMENT_KEY_LENGTH || !ENVIRONMENT_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid environment variable name: ${JSON.stringify(rawKey)}`);
    }
    if (typeof rawValue !== "string") {
      throw new Error(`Environment variable ${key} must have a string value`);
    }
    if (rawValue.length > MAX_ENVIRONMENT_VALUE_LENGTH) {
      throw new Error(
        `Environment variable ${key} cannot exceed ${MAX_ENVIRONMENT_VALUE_LENGTH} characters`,
      );
    }
    if (rawValue.includes("\0")) {
      throw new Error(`Environment variable ${key} cannot contain NUL bytes`);
    }
    result[key] = rawValue;
  }
  return result;
}

export function normalizeLocalFrameworkConfig(value: unknown): LocalFrameworkConfig {
  if (!isRecord(value)) throw new Error("Local framework configuration must be an object");
  if (
    value.version !== undefined &&
    Number(value.version) !== LOCAL_FRAMEWORK_CONFIG_VERSION
  ) {
    throw new Error(`Unsupported local framework configuration version: ${String(value.version)}`);
  }
  return {
    version: LOCAL_FRAMEWORK_CONFIG_VERSION,
    command: optionalAbsolutePath(value.command, "TE2 command"),
    venvPath: optionalAbsolutePath(value.venvPath, "Virtual environment path"),
    broadcast: normalizeBroadcast(value.broadcast),
    port: validateFrameworkPort(value.port ?? 8089),
    env: normalizeEnvironment(value.env),
  };
}

export function defaultLocalFrameworkConfig(): LocalFrameworkConfig {
  return {
    version: LOCAL_FRAMEWORK_CONFIG_VERSION,
    command: "",
    venvPath: "",
    broadcast: [],
    port: 8089,
    env: {},
  };
}

export function localFrameworkConfigPath(environment = process.env): string {
  return join(te2ConfigHome(environment), LOCAL_FRAMEWORK_CONFIG_FILENAME);
}

async function runnableFile(path: string): Promise<boolean> {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) return false;
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function detectTe2Executable(
  environment = process.env,
): Promise<string | null> {
  const pathValue = String(environment.PATH || "");
  for (const directory of pathValue.split(delimiter)) {
    if (!directory || !isAbsolute(directory)) continue;
    const candidate = join(directory, "te2");
    if (await runnableFile(candidate)) return candidate;
  }
  return null;
}

async function validateVenv(path: string): Promise<string | null> {
  if (!path) return null;
  try {
    const metadata = await stat(path);
    if (!metadata.isDirectory()) return `Virtual environment is not a directory: ${path}`;
  } catch {
    return `Virtual environment does not exist: ${path}`;
  }
  if (!(await runnableFile(join(path, "bin", "python")))) {
    return `Virtual environment Python is not runnable: ${join(path, "bin", "python")}`;
  }
  return null;
}

async function resolveCommand(
  config: LocalFrameworkConfig,
  environment: NodeJS.ProcessEnv,
): Promise<{
  command: string;
  commandSource: LocalFrameworkCommandSource;
  commandDetected: boolean;
  error: string | null;
}> {
  const override = String(environment[LOCAL_FRAMEWORK_EXECUTABLE_ENV] || "").trim();
  let command = "";
  let commandSource: LocalFrameworkCommandSource = "none";
  if (override) {
    if (!isAbsolute(override)) {
      return {
        command: "",
        commandSource: "override",
        commandDetected: false,
        error: `${LOCAL_FRAMEWORK_EXECUTABLE_ENV} must be an absolute path`,
      };
    }
    command = override;
    commandSource = "override";
  } else if (config.command) {
    command = config.command;
    commandSource = "configured";
  } else {
    command = (await detectTe2Executable(environment)) || "";
    commandSource = command ? "detected" : "none";
  }
  if (!command) {
    return {
      command,
      commandSource,
      commandDetected: false,
      error: null,
    };
  }
  if (!(await runnableFile(command))) {
    return {
      command,
      commandSource,
      commandDetected: false,
      error: `TE2 executable is not runnable: ${command}`,
    };
  }
  return {
    command,
    commandSource,
    commandDetected: true,
    error: null,
  };
}

export async function resolveLocalFrameworkConfig(
  config: LocalFrameworkConfig,
  options: {
    environment?: NodeJS.ProcessEnv;
    persisted?: boolean;
    path?: string;
    readError?: string | null;
  } = {},
): Promise<LocalFrameworkConfigView> {
  const environment = options.environment || process.env;
  const command = await resolveCommand(config, environment);
  const venvError = await validateVenv(config.venvPath);
  return {
    ...config,
    command: config.command || command.command,
    persisted: Boolean(options.persisted),
    path: options.path || localFrameworkConfigPath(environment),
    resolvedCommand: command.command,
    commandSource: command.commandSource,
    commandDetected: command.commandDetected,
    venv: Boolean(config.venvPath) && !venvError,
    error: options.readError || command.error || venvError,
  };
}

export async function readLocalFrameworkConfig(
  environment = process.env,
): Promise<LocalFrameworkConfigView> {
  const path = localFrameworkConfigPath(environment);
  let decoded: unknown;
  try {
    decoded = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return resolveLocalFrameworkConfig(defaultLocalFrameworkConfig(), {
        environment,
        persisted: false,
        path,
      });
    }
    return resolveLocalFrameworkConfig(defaultLocalFrameworkConfig(), {
      environment,
      persisted: true,
      path,
      readError: error instanceof Error
        ? `Local framework configuration is invalid: ${error.message}`
        : "Local framework configuration is invalid",
    });
  }
  try {
    return resolveLocalFrameworkConfig(normalizeLocalFrameworkConfig(decoded), {
      environment,
      persisted: true,
      path,
    });
  } catch (error) {
    return resolveLocalFrameworkConfig(defaultLocalFrameworkConfig(), {
      environment,
      persisted: true,
      path,
      readError: error instanceof Error
        ? `Local framework configuration is invalid: ${error.message}`
        : "Local framework configuration is invalid",
    });
  }
}

export async function writeLocalFrameworkConfig(
  value: unknown,
  environment = process.env,
): Promise<LocalFrameworkConfigView> {
  const normalized = normalizeLocalFrameworkConfig(value);
  if (normalized.command && !(await runnableFile(normalized.command))) {
    throw new Error(`TE2 executable is not runnable: ${normalized.command}`);
  }
  const resolved = await resolveLocalFrameworkConfig(normalized, {
    environment,
    persisted: true,
  });
  if (resolved.error) throw new Error(resolved.error);

  const path = localFrameworkConfigPath(environment);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { ...resolved, path };
}

export function localFrameworkChildEnvironment(
  config: LocalFrameworkConfigView,
  environment = process.env,
): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    ...config.env,
  };
  if (config.venv && config.venvPath) {
    childEnvironment.VIRTUAL_ENV = config.venvPath;
    delete childEnvironment.PYTHONHOME;
    const pathValue = String(childEnvironment.PATH || "");
    childEnvironment.PATH = pathValue
      ? `${join(config.venvPath, "bin")}${delimiter}${pathValue}`
      : join(config.venvPath, "bin");
  }
  return childEnvironment;
}
