import {
  legacyDesktopClientIdentityPath,
  readDesktopIdentities,
  resetDesktopIdentities,
} from "./desktop-state-store";

export type ElectronClientIdentity = {
  version: 1;
  clientInstanceId: string;
};

export function desktopClientIdentityPath(environment = process.env): string {
  return legacyDesktopClientIdentityPath(environment);
}

export async function readDesktopClientIdentity(
  environment = process.env,
): Promise<ElectronClientIdentity> {
  const identities = await readDesktopIdentities(environment);
  return {
    version: 1,
    clientInstanceId: identities.primaryClientInstanceId,
  };
}

export async function resetDesktopClientIdentity(
  environment = process.env,
): Promise<ElectronClientIdentity> {
  const identities = await resetDesktopIdentities(environment);
  return {
    version: 1,
    clientInstanceId: identities.primaryClientInstanceId,
  };
}
