// TE2 consumer adapter, not generic Electromux core. gatewayRequest is injected
// by the native consumer and returns the existing Android gateway's body.data.
// This module creates no socket, HTTP client, relay, or backend process.
export function createRemoteElectromuxPlatform({gatewayRequest, getBrowserOrigin, navigate, on, nativeRequest}) {
  if ([gatewayRequest, getBrowserOrigin, navigate].some(value => typeof value !== "function"))
    throw new Error("Remote Electromux platform requires gateway, origin and navigation adapters");
  let settings = null;
  let localState = null;
  let disposed = false;
  let reconciliation = null;
  const stateListeners = new Set();
  const stateMethods = new Set(['get_local_framework_state', 'refresh_local_framework',
    'start_local_framework', 'stop_local_framework', 'use_local_framework',
    'install_local_framework', 'cancel_local_framework_install']);
  function acceptState(state) {
    if (disposed) return localState || state;
    if (localState && state?.stateSessionId === localState.stateSessionId &&
        Number.isSafeInteger(state?.stateRevision) && Number.isSafeInteger(localState.stateRevision) &&
        state.stateRevision < localState.stateRevision) return localState;
    localState = state;
    for (const listener of stateListeners) listener(state);
    return state;
  }
  const unsubscribeState = typeof nativeRequest === 'function' && typeof on === 'function'
    ? on('local-framework-state', acceptState) : null;
  const unsupported = method => {
    const error = new Error(`${method} is unavailable in the remote-only Electromux slice`);
    error.code = "UNSUPPORTED_CAPABILITY";
    throw error;
  };
  const gateway = (path, method = "GET", body) => gatewayRequest(`/android-api${path}`, {method, body});
  async function request(method, params = {}) {
    if (typeof nativeRequest === "function" && ["get_settings", "save_settings", "get_android_settings", "save_android_settings",
      "open_power_settings", "open_notification_settings", "get_local_framework_state", "get_local_framework_config",
      "save_local_framework_config", "refresh_local_framework", "start_local_framework",
      "stop_local_framework", "use_local_framework", "install_local_framework", "cancel_local_framework_install"].includes(method)) {
      const result = await nativeRequest(method, params);
      if (method === 'get_settings') settings = result;
      if (method === 'save_settings') settings = result.settings;
      return stateMethods.has(method) ? acceptState(result) : result;
    }
    switch (method) {
      case "get_settings":
        settings = await gateway("/settings");
        return settings;
      case "save_settings": {
        // Android's current store has no desktop startup values. Never silently
        // claim they persisted while this is still a remote-only consumer.
        if (params.startLocalFrameworkOnLaunch || params.autostart || params.preferredAppId)
          return unsupported("automatic startup");
        const previous = settings;
        settings = await gateway("/settings", "PUT", {
          frameworkHost: params.frameworkHost, frameworkPort: params.frameworkPort,
        });
        return {settings, browserFrameworkOrigin: getBrowserOrigin(), connectionChanged:
          !previous || previous.frameworkHost !== settings.frameworkHost || previous.frameworkPort !== settings.frameworkPort};
      }
      case "get_browser_framework_origin": return {origin: getBrowserOrigin()};
      case "get_framework_bookmarks": return gateway("/framework-bookmarks");
      case "upsert_framework_bookmark": return gateway("/framework-bookmarks", "POST", params);
      case "delete_framework_bookmark": return gateway("/framework-bookmarks", "DELETE", params);
      case "get_framework_status": return gateway("/framework/status");
      case "get_fws_status": {
        const state = await gateway("/fws/status");
        return {...state, url: new URL('/fws', getBrowserOrigin()).href};
      }
      case "get_asset_status": {
        const status = await gateway("/assets/status");
        return {...status, interceptorAvailable: status.assetRootExists === true,
          assetRoot: "Android app-private editor_static"};
      }
      case "get_local_framework_state": return {supported: false, phase: "unavailable", ownership: "none"};
      case "get_local_framework_config": return {version: 1, command: "", venvPath: "", port: 8089,
        broadcast: [], env: {}, persisted: false, commandDetected: false,
        error: "Local execution is not enabled in this remote-only slice"};
      case "framework_request": {
        const verb = params.method || "GET";
        if (params.path === "/api/apps/catalog" && verb === "GET") {
          const catalog = await gateway("/apps");
          if (!catalog.online || !Array.isArray(catalog.apps))
            throw new Error(catalog.error || "Framework unavailable");
          return catalog.apps.filter(app => app.id !== "settings");
        }
        if (params.path === "/api/apps/reload" && verb === "POST") return gateway("/apps/reload", "POST");
        const match = /^\/api\/apps\/([A-Za-z0-9._-]+)\/(open|quit)$/.exec(params.path);
        if (match && verb === "POST") return gateway(`/apps/${match[1]}/${match[2]}`, "POST");
        return unsupported("framework route");
      }
      default: return unsupported(method);
    }
  }
  const navigateLocal = raw => {
    const origin = new URL(getBrowserOrigin()).origin;
    const target = new URL(raw, `${origin}/`);
    if (!/^https?:$/.test(target.protocol) || target.origin !== origin)
      return unsupported("external navigation");
    return navigate(target.href);
  };
  function subscribe(name, callback) {
    if (typeof nativeRequest !== 'function') return typeof on === 'function' ? on(name, callback) : () => {};
    if (disposed || name !== 'local-framework-state') throw new Error('Unsupported state subscription');
    stateListeners.add(callback);
    if (localState) callback(localState);
    return () => stateListeners.delete(callback);
  }
  function reconcileLocalState() {
    if (disposed || typeof nativeRequest !== 'function') return Promise.resolve(null);
    if (!reconciliation) reconciliation = request('get_local_framework_state')
      .finally(() => {reconciliation = null;});
    return reconciliation;
  }
  function dispose() {disposed = true; unsubscribeState?.(); stateListeners.clear();}
  return Object.freeze({request, navigate: navigateLocal, on: subscribe, reconcileLocalState, dispose,
    capabilities: Object.freeze({localFramework: typeof nativeRequest === "function", automaticStartup: typeof nativeRequest === "function", assetUpdates: false})});
}
