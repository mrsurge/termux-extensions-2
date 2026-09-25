import type { DesktopShellSettings } from "../shared/contracts";

export type PreferredAppFrameworkRequest = (request: {
  path: string;
  method?: string;
  body?: unknown;
}) => Promise<unknown>;

export type PreferredAppStartupOptions = {
  settings: Pick<DesktopShellSettings, "autostart" | "preferredAppId">;
  environment?: NodeJS.ProcessEnv;
  configuredFrameworkOrigin: string;
  browserFrameworkOrigin: string;
  request: PreferredAppFrameworkRequest;
};

export type DesktopStartupSequenceOptions = {
  startLocalFrameworkOnLaunch: boolean;
  startLocalFramework: () => Promise<unknown>;
  preparePreferredApp: () => Promise<string | null>;
  navigatePreferredApp: (target: string) => Promise<void>;
  onLocalFrameworkError: (error: unknown) => void;
};

export async function runDesktopStartupSequence({
  startLocalFrameworkOnLaunch,
  startLocalFramework,
  preparePreferredApp,
  navigatePreferredApp,
  onLocalFrameworkError,
}: DesktopStartupSequenceOptions): Promise<void> {
  if (startLocalFrameworkOnLaunch) {
    try {
      await startLocalFramework();
    } catch (error) {
      onLocalFrameworkError(error);
      return;
    }
  }
  const target = await preparePreferredApp();
  if (!target) return;
  await navigatePreferredApp(target);
}

function projectConfiguredUrlToBrowserOrigin(
  value: string,
  configuredFrameworkOrigin: string,
  browserFrameworkOrigin: string,
): string {
  const source = new URL(value, `${configuredFrameworkOrigin}/`);
  return source.origin === configuredFrameworkOrigin
    ? new URL(
        `${source.pathname}${source.search}${source.hash}`,
        browserFrameworkOrigin,
      ).href
    : source.href;
}

export async function resolvePreferredAppStartupUrl({
  settings,
  environment = process.env,
  configuredFrameworkOrigin,
  browserFrameworkOrigin,
  request,
}: PreferredAppStartupOptions): Promise<string | null> {
  const environmentOverride = environment.TE2_DESKTOP_AUTO_OPEN === "1";
  if (!environmentOverride && !settings.autostart) return null;

  const appId = environment.TE2_DESKTOP_APP_ID?.trim()
    || settings.preferredAppId.trim()
    || (environmentOverride ? "code_te2" : "");
  if (!appId) return null;

  const direct = environment.TE2_DESKTOP_URL?.trim();
  if (environmentOverride && direct) {
    return projectConfiguredUrlToBrowserOrigin(
      direct,
      configuredFrameworkOrigin,
      browserFrameworkOrigin,
    );
  }

  const result = await request({
    path: `/api/apps/${encodeURIComponent(appId)}/open`,
    method: "POST",
    body: { params: {} },
  });
  const rawUrl = result && typeof result === "object"
    ? String((result as { url?: unknown }).url || "")
    : "";
  return projectConfiguredUrlToBrowserOrigin(
    rawUrl || `/app/${appId}`,
    configuredFrameworkOrigin,
    browserFrameworkOrigin,
  );
}
