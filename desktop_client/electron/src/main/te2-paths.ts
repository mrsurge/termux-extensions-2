import { chmod, lstat, mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

export type Te2Paths = {
  cacheHome: string;
  dataHome: string;
  configHome: string;
  runtimeHome: string;
};

function nonempty(value: string | undefined): string {
  return String(value || "").trim();
}

function absolutePath(value: string, key: string): string {
  if (!isAbsolute(value)) throw new Error(`${key} must be an absolute path: ${JSON.stringify(value)}`);
  return value;
}

function userHome(environment: NodeJS.ProcessEnv, override?: string): string {
  return absolutePath(override || nonempty(environment.HOME) || homedir(), "HOME");
}

function persistentHome(
  environment: NodeJS.ProcessEnv,
  explicitKey: "TE2_CACHE_HOME" | "TE2_DATA_HOME" | "TE2_CONFIG_HOME",
  xdgKey: "XDG_CACHE_HOME" | "XDG_DATA_HOME" | "XDG_CONFIG_HOME",
  fallbackBase: () => string,
): string {
  const explicit = nonempty(environment[explicitKey]);
  if (explicit) return absolutePath(explicit, explicitKey);
  const xdg = nonempty(environment[xdgKey]);
  if (xdg) return join(absolutePath(xdg, xdgKey), "te2");
  return join(fallbackBase(), "te2");
}

export function te2CacheHome(environment = process.env, home?: string): string {
  return persistentHome(
    environment,
    "TE2_CACHE_HOME",
    "XDG_CACHE_HOME",
    () => join(userHome(environment, home), ".cache"),
  );
}

export function te2DataHome(environment = process.env, home?: string): string {
  return persistentHome(
    environment,
    "TE2_DATA_HOME",
    "XDG_DATA_HOME",
    () => join(userHome(environment, home), ".local", "share"),
  );
}

export function te2ConfigHome(environment = process.env, home?: string): string {
  return persistentHome(
    environment,
    "TE2_CONFIG_HOME",
    "XDG_CONFIG_HOME",
    () => join(userHome(environment, home), ".config"),
  );
}

export function te2RuntimeHome(
  environment = process.env,
  platformTemp = tmpdir(),
  uid = process.getuid?.() ?? 0,
): string {
  const explicit = nonempty(environment.TE2_RUNTIME_HOME);
  if (explicit) return absolutePath(explicit, "TE2_RUNTIME_HOME");
  const xdg = nonempty(environment.XDG_RUNTIME_DIR);
  if (xdg) return join(absolutePath(xdg, "XDG_RUNTIME_DIR"), "te2");

  const environmentTemp = nonempty(environment.TMPDIR);
  let temporaryRoot: string;
  if (environmentTemp) {
    temporaryRoot = absolutePath(environmentTemp, "TMPDIR");
  } else if (
    nonempty(environment.ANDROID_ROOT) ||
    nonempty(environment.ANDROID_DATA) ||
    nonempty(environment.PREFIX).includes("/com.termux/")
  ) {
    const prefix = nonempty(environment.PREFIX);
    temporaryRoot = prefix
      ? join(absolutePath(prefix, "PREFIX"), "tmp")
      : absolutePath(platformTemp, "platform temporary directory");
  } else {
    temporaryRoot = absolutePath(platformTemp, "platform temporary directory");
  }
  return join(temporaryRoot, `te2-${uid}`);
}

export function resolveTe2Paths(
  environment = process.env,
  options: { home?: string; platformTemp?: string; uid?: number } = {},
): Te2Paths {
  return {
    cacheHome: te2CacheHome(environment, options.home),
    dataHome: te2DataHome(environment, options.home),
    configHome: te2ConfigHome(environment, options.home),
    runtimeHome: te2RuntimeHome(environment, options.platformTemp, options.uid),
  };
}

export async function ensureRuntimeHome(path: string, uid = process.getuid?.() ?? 0): Promise<string> {
  absolutePath(path, "TE2 runtime root");
  await mkdir(path, { recursive: true, mode: 0o700 });
  let metadata = await lstat(path);
  if (metadata.isSymbolicLink()) throw new Error(`TE2 runtime root must not be a symbolic link: ${path}`);
  if (!metadata.isDirectory()) throw new Error(`TE2 runtime root is not a directory: ${path}`);
  if (typeof metadata.uid === "number" && metadata.uid !== uid) {
    throw new Error(`TE2 runtime root is owned by uid ${metadata.uid}, expected ${uid}: ${path}`);
  }
  if ((metadata.mode & 0o777) !== 0o700) {
    await chmod(path, 0o700);
    metadata = await lstat(path);
    if ((metadata.mode & 0o777) !== 0o700) throw new Error(`TE2 runtime root permissions are not 0700: ${path}`);
  }
  return path;
}
