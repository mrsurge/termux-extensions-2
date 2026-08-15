import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { te2ConfigHome } from "./te2-paths";

const CLIENT_ID_PATTERN = /^client_[a-z0-9]{20,64}$/;

export type ElectronClientIdentity = {
  version: 1;
  clientInstanceId: string;
};

export function desktopClientIdentityPath(environment = process.env): string {
  return join(te2ConfigHome(environment), "desktop-client-identity.json");
}

function createIdentity(): ElectronClientIdentity {
  return {
    version: 1,
    clientInstanceId: `client_${randomUUID().replaceAll("-", "").toLowerCase()}`,
  };
}

function validateIdentity(value: unknown): ElectronClientIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Desktop client identity must be an object");
  }
  const record = value as Record<string, unknown>;
  const clientInstanceId =
    typeof record.clientInstanceId === "string"
      ? record.clientInstanceId.trim().toLowerCase()
      : "";
  if (record.version !== 1 || !CLIENT_ID_PATTERN.test(clientInstanceId)) {
    throw new Error("Desktop client identity is invalid");
  }
  return { version: 1, clientInstanceId };
}

async function writeIdentity(
  identity: ElectronClientIdentity,
  environment = process.env,
): Promise<ElectronClientIdentity> {
  const filePath = desktopClientIdentityPath(environment);
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, `${JSON.stringify(identity, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
  return identity;
}

export async function readDesktopClientIdentity(
  environment = process.env,
): Promise<ElectronClientIdentity> {
  try {
    return validateIdentity(
      JSON.parse(
        await readFile(desktopClientIdentityPath(environment), "utf8"),
      ),
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code !== "ENOENT"
    ) {
      throw error;
    }
    return await writeIdentity(createIdentity(), environment);
  }
}

export async function resetDesktopClientIdentity(
  environment = process.env,
): Promise<ElectronClientIdentity> {
  return await writeIdentity(createIdentity(), environment);
}
