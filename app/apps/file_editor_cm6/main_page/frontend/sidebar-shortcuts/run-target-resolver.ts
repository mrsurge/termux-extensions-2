import type {
  RunProfileRuntimeMetadata,
  RunTargetDescriptor,
  RunTargetRouteSetDescriptor,
} from './types.ts';

interface RunTargetResolution {
  ok: boolean;
  mode?: 'direct' | 'tunnel';
  url?: string;
  error?: string;
}

interface NativeRunTargetWindow extends Window {
  te2Electron?: {
    resolveRunTarget?: (route: RunTargetDescriptor) => Promise<RunTargetResolution>;
    registerRunTargetSurface?: (
      runtime: RunProfileRuntimeMetadata,
      url: string,
    ) => Promise<{ ok: true }>;
    releaseRunTargetSurface?: (surfaceId: string) => Promise<{ ok: true }>;
  };
}

const REQUEST_CHANNEL = 'te2.runTarget.resolve.request';
const RESPONSE_CHANNEL = 'te2.runTarget.resolve.response';
const REGISTER_CHANNEL = 'te2.runTarget.register.request';
const REGISTER_RESPONSE_CHANNEL = 'te2.runTarget.register.response';
const RELEASE_CHANNEL = 'te2.runTarget.release.request';
const NATIVE_TIMEOUT_MS = 5000;
let requestSequence = 0;

function nativeBridgeAvailable(): boolean {
  return document.documentElement?.dataset.te2RunTargetBridge === '1';
}

function originalRouteUrl(route: RunTargetDescriptor): string {
  if (route.dto === 'RunTargetRouteSet') {
    const routeSet = route as RunTargetRouteSetDescriptor;
    return typeof routeSet.primary?.originalUrl === 'string'
      ? routeSet.primary.originalUrl
      : '';
  }
  return typeof route.originalUrl === 'string' ? route.originalUrl : '';
}

function resolveThroughGecko(
  route: RunTargetDescriptor,
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

function registerThroughGecko(
  runtime: RunProfileRuntimeMetadata,
  url: string,
): Promise<void> {
  const requestId = `run-target-register-${Date.now()}-${++requestSequence}`;
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Gecko run-target runtime registration timed out'));
    }, NATIVE_TIMEOUT_MS);
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data;
      if (
        !data ||
        typeof data !== 'object' ||
        data.channel !== REGISTER_RESPONSE_CHANNEL ||
        data.requestId !== requestId
      ) return;
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      if (data.result?.ok === true) resolve();
      else reject(new Error(data.result?.error || 'Gecko runtime registration failed'));
    };
    window.addEventListener('message', onMessage);
    window.postMessage(
      { channel: REGISTER_CHANNEL, requestId, runtime, url },
      window.location.origin,
    );
  });
}

export async function resolveRunTargetUrl(
  route: RunTargetDescriptor | null | undefined,
  fallbackUrl: string,
  runtime: RunProfileRuntimeMetadata | null = null,
): Promise<string> {
  if (!route) {
    if (runtime?.devRuntime === true) {
      const nativeWindow = window as NativeRunTargetWindow;
      if (typeof nativeWindow.te2Electron?.registerRunTargetSurface === 'function') {
        await nativeWindow.te2Electron.registerRunTargetSurface(runtime, fallbackUrl);
      } else if (nativeBridgeAvailable()) {
        await registerThroughGecko(runtime, fallbackUrl);
      }
    }
    return fallbackUrl;
  }
  const nativeRoute = runtime ? { ...route, te2Runtime: runtime } : route;
  const nativeWindow = window as NativeRunTargetWindow;
  let result: RunTargetResolution;
  if (typeof nativeWindow.te2Electron?.resolveRunTarget === 'function') {
    result = await nativeWindow.te2Electron.resolveRunTarget(nativeRoute);
  } else if (nativeBridgeAvailable()) {
    result = await resolveThroughGecko(nativeRoute);
  } else {
    return originalRouteUrl(route) || fallbackUrl;
  }
  if (!result?.ok || typeof result.url !== 'string' || !result.url) {
    throw new Error(result?.error || 'Native run-target relay failed');
  }
  return result.url;
}

export async function releaseRunTargetSurface(surfaceId: string): Promise<void> {
  const normalized = String(surfaceId || '').trim();
  if (!normalized) return;
  const nativeWindow = window as NativeRunTargetWindow;
  if (typeof nativeWindow.te2Electron?.releaseRunTargetSurface === 'function') {
    await nativeWindow.te2Electron.releaseRunTargetSurface(normalized);
    return;
  }
  if (nativeBridgeAvailable()) {
    window.postMessage(
      { channel: RELEASE_CHANNEL, surfaceId: normalized },
      window.location.origin,
    );
  }
}
