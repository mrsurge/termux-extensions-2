import type {
  RunProfileRuntimeMetadata,
  RunTargetDescriptor,
  RunTargetRouteSetDescriptor,
} from './types.ts';
import {
  androidNativeRenderer,
  requestCefriumNative,
} from '../native-client-bridge.ts';

interface NativeRunTargetWindow extends Window {
  te2Electron?: {
    registerRunTargetSurface?: (
      runtime: RunProfileRuntimeMetadata,
      url: string,
      route?: RunTargetDescriptor,
    ) => Promise<{ ok: true }>;
    releaseRunTargetSurface?: (surfaceId: string) => Promise<{ ok: true }>;
  };
}

const REGISTER_CHANNEL = 'te2.runTarget.register.request';
const REGISTER_RESPONSE_CHANNEL = 'te2.runTarget.register.response';
const RELEASE_CHANNEL = 'te2.runTarget.release.request';
const NATIVE_TIMEOUT_MS = 5000;
let requestSequence = 0;
const runtimeRegistrations = new Map<string, Promise<void>>();

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

function registerThroughGecko(
  runtime: RunProfileRuntimeMetadata,
  url: string,
  route?: RunTargetDescriptor,
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
      { channel: REGISTER_CHANNEL, requestId, runtime, url, route },
      window.location.origin,
    );
  });
}

function registerRuntimeInstrumentation(
  runtime: RunProfileRuntimeMetadata,
  url: string,
  route?: RunTargetDescriptor,
): Promise<void> {
  const surfaceId = String(runtime.surfaceId || '').trim();
  const renderer = androidNativeRenderer();
  const shouldRegister = renderer === 'cefrium'
    ? runtime.devRuntime === true || runtime.devTools === true
    : runtime.devRuntime === true;
  if (!surfaceId || !shouldRegister) return Promise.resolve();
  const current = runtimeRegistrations.get(surfaceId);
  if (current) return current;
  const nativeWindow = window as NativeRunTargetWindow;
  const registration = typeof nativeWindow.te2Electron?.registerRunTargetSurface === 'function'
    ? nativeWindow.te2Electron.registerRunTargetSurface(runtime, url, route).then(() => {})
    : renderer === 'cefrium'
      ? requestCefriumNative('te2.runTarget.register', {
          runtime,
          url,
          route: route || null,
        }).then(() => {})
    : nativeBridgeAvailable()
      ? registerThroughGecko(runtime, url, route)
      : Promise.resolve();
  const retained = registration.catch((error: unknown) => {
    runtimeRegistrations.delete(surfaceId);
    console.warn('[run-profile-runtime] registration failed', error);
  });
  runtimeRegistrations.set(surfaceId, retained);
  return retained;
}

export async function prepareRunTargetUrl(
  route: RunTargetDescriptor | null | undefined,
  fallbackUrl: string,
  runtime: RunProfileRuntimeMetadata | null = null,
): Promise<string> {
  const resolvedUrl = route ? originalRouteUrl(route) || fallbackUrl : fallbackUrl;
  if (runtime) {
    await registerRuntimeInstrumentation(runtime, resolvedUrl, route || undefined);
  }
  return resolvedUrl;
}

export async function releaseRunTargetSurface(surfaceId: string): Promise<void> {
  const normalized = String(surfaceId || '').trim();
  if (!normalized) return;
  runtimeRegistrations.delete(normalized);
  const nativeWindow = window as NativeRunTargetWindow;
  if (typeof nativeWindow.te2Electron?.releaseRunTargetSurface === 'function') {
    await nativeWindow.te2Electron.releaseRunTargetSurface(normalized);
    return;
  }
  if (androidNativeRenderer() === 'cefrium') {
    await requestCefriumNative('te2.runTarget.release', { surfaceId: normalized });
    return;
  }
  if (nativeBridgeAvailable()) {
    window.postMessage(
      { channel: RELEASE_CHANNEL, surfaceId: normalized },
      window.location.origin,
    );
  }
}
