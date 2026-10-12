const MAX_WAIT_MS = 30000;
const POLL_INTERVAL_MS = 1000;

function _resolveAppIdFromPath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const appIndex = parts.indexOf("app");
  if (appIndex >= 0 && parts[appIndex + 1]) {
    return decodeURIComponent(parts[appIndex + 1]);
  }
  throw new Error(
    `Unable to resolve app id from path '${window.location.pathname}'`,
  );
}

function _startUrlWithLaunchQuery(startUrl) {
  if (!window.location.search) {
    return startUrl;
  }
  const target = new URL(startUrl, window.location.origin);
  const launchParams = new URLSearchParams(window.location.search);
  for (const [key, value] of launchParams.entries()) {
    if (!target.searchParams.has(key)) {
      target.searchParams.append(key, value);
    }
  }
  return `${target.pathname}${target.search}${target.hash}`;
}

export default async function initProxyShellApp(rootEl, _api, host) {
  const frame = rootEl.querySelector("#ps-frame");
  const loading = rootEl.querySelector("#ps-loading");
  if (!frame) {
    throw new Error("Missing iframe element");
  }

  const appId = _resolveAppIdFromPath();
  const metaUrl = `/api/apps/${encodeURIComponent(appId)}/proxy_shell`;
  const metaResponse = await fetch(metaUrl, {
    method: "GET",
    cache: "no-store",
  });
  if (!metaResponse.ok) {
    throw new Error(
      `Failed to load proxy shell config for ${appId} (${metaResponse.status})`,
    );
  }
  const metaPayload = await metaResponse.json();
  const data = metaPayload && metaPayload.data;
  if (
    !data ||
    typeof data.start_url !== "string" ||
    typeof data.health_url !== "string"
  ) {
    throw new Error("Invalid proxy shell config response");
  }

  if (host && typeof host.setTitle === "function") {
    host.setTitle(appId);
  }

  const startedAt = Date.now();
  let ready = false;
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    try {
      const healthResponse = await fetch(data.health_url, {
        method: "GET",
        cache: "no-store",
      });
      if (healthResponse.ok) {
        ready = true;
        break;
      }
    } catch (_) {
      // Worker not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  if (!ready) {
    throw new Error(`Proxy shell app '${appId}' did not become ready in time`);
  }

  frame.src = _startUrlWithLaunchQuery(data.start_url);
  if (loading) {
    loading.style.display = "none";
  }
}
