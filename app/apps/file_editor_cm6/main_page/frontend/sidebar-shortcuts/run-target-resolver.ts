import type { RunTargetRouteDescriptor } from './types.ts';

interface RunTargetResolution {
  ok: boolean;
  mode?: 'direct' | 'tunnel';
  url?: string;
  error?: string;
}

interface NativeRunTargetWindow extends Window {
  te2Electron?: {
    resolveRunTarget?: (route: RunTargetRouteDescriptor) => Promise<RunTargetResolution>;
  };
}

const REQUEST_CHANNEL = 'te2.runTarget.resolve.request';
const RESPONSE_CHANNEL = 'te2.runTarget.resolve.response';
const NATIVE_TIMEOUT_MS = 5000;
let requestSequence = 0;

function nativeBridgeAvailable(): boolean {
  return document.documentElement?.dataset.te2RunTargetBridge === '1';
}

function resolveThroughGecko(
  route: RunTargetRouteDescriptor,
): Promise<RunTargetResolution> {
  const requestId = `run-target-${Date.now()}-${++requestSequence}`;
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Gecko run-target bridge timed out'));
    }, NATIVE_TIMEOUT_MS);
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data;
      if (
        !data ||
        typeof data !== 'object' ||
        data.channel !== RESPONSE_CHANNEL ||
        data.requestId !== requestId
      ) return;
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      resolve(data.result as RunTargetResolution);
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ channel: REQUEST_CHANNEL, requestId, route }, window.location.origin);
  });
}

export async function resolveRunTargetUrl(
  route: RunTargetRouteDescriptor | null | undefined,
  fallbackUrl: string,
): Promise<string> {
  if (!route) return fallbackUrl;
  const nativeWindow = window as NativeRunTargetWindow;
  let result: RunTargetResolution;
  if (typeof nativeWindow.te2Electron?.resolveRunTarget === 'function') {
    result = await nativeWindow.te2Electron.resolveRunTarget(route);
  } else if (nativeBridgeAvailable()) {
    result = await resolveThroughGecko(route);
  } else {
    return route.originalUrl || fallbackUrl;
  }
  if (!result?.ok || typeof result.url !== 'string' || !result.url) {
    throw new Error(result?.error || 'Native run-target relay failed');
  }
  return result.url;
}
