import {
  androidNativeRenderer,
  isAndroidNativePage,
  requestCefriumNative,
} from "./native-client-bridge.ts";

const CLIENT_STORAGE_KEY = "te2.codeTe2.clientInstanceId.v1";
const WINDOW_STORAGE_KEY = "te2.codeTe2.windowId.v1";
const GECKO_IDENTITY_REQUEST = "te2.clientIdentity.request";
const GECKO_IDENTITY_RESPONSE = "te2.clientIdentity.response";
const ID_PATTERN = /^client_[a-z0-9]{12,64}$/;

interface ElectronIdentityBridge {
  readClientIdentity?: () => Promise<{ clientInstanceId: string }>;
  resetClientIdentity?: () => Promise<{ clientInstanceId: string }>;
}

interface NativeIdentityWindow extends Window {
  te2Electron?: ElectronIdentityBridge;
}

export interface CodeTe2ClientIdentity {
  clientInstanceId: string;
  windowId: string;
  consoleWorkerId: string;
  provider: "browser" | "electron" | "gecko" | "cefrium";
  label: string;
}

function randomIdentity(prefix: "client" | "window"): string {
  const raw = globalThis.crypto.randomUUID().replaceAll("-", "").toLowerCase();
  return `${prefix}_${raw}`;
}

function validatedClientInstanceId(value: unknown): string {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!ID_PATTERN.test(normalized)) {
    throw new Error("Native client identity is invalid");
  }
  return normalized;
}

function browserClientInstanceId(reset: boolean): string {
  if (reset) window.localStorage.removeItem(CLIENT_STORAGE_KEY);
  const existing = window.localStorage.getItem(CLIENT_STORAGE_KEY);
  if (existing && ID_PATTERN.test(existing)) return existing;
  const generated = randomIdentity("client");
  window.localStorage.setItem(CLIENT_STORAGE_KEY, generated);
  return generated;
}

function windowIdentity(): string {
  const existing = window.sessionStorage.getItem(WINDOW_STORAGE_KEY);
  if (existing && /^window_[a-z0-9]{20,64}$/.test(existing)) return existing;
  const generated = randomIdentity("window");
  window.sessionStorage.setItem(WINDOW_STORAGE_KEY, generated);
  return generated;
}

function requestGeckoClientIdentity(reset: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const requestId = globalThis.crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Gecko native client identity bridge timed out"));
    }, 10_000);
    function onMessage(event: MessageEvent): void {
      if (event.source !== window || event.origin !== window.location.origin)
        return;
      const data = event.data;
      if (
        !data ||
        data.channel !== GECKO_IDENTITY_RESPONSE ||
        data.requestId !== requestId
      )
        return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      if (data.result?.ok !== true) {
        reject(
          new Error(
            String(data.result?.error || "Gecko client identity failed"),
          ),
        );
        return;
      }
      try {
        resolve(validatedClientInstanceId(data.result.clientInstanceId));
      } catch (error) {
        reject(error);
      }
    }
    window.addEventListener("message", onMessage);
    window.postMessage(
      { channel: GECKO_IDENTITY_REQUEST, requestId, reset },
      window.location.origin,
    );
  });
}

async function nativeClientInstanceId(reset: boolean): Promise<{
  clientInstanceId: string;
  provider: CodeTe2ClientIdentity["provider"];
  label: string;
}> {
  const electron = (window as NativeIdentityWindow).te2Electron;
  if (typeof electron?.readClientIdentity === "function") {
    const result =
      reset && typeof electron.resetClientIdentity === "function"
        ? await electron.resetClientIdentity()
        : await electron.readClientIdentity();
    return {
      clientInstanceId: validatedClientInstanceId(result.clientInstanceId),
      provider: "electron",
      label: "Electron desktop installation",
    };
  }
  const renderer = androidNativeRenderer();
  if (renderer === "cefrium") {
    const result = await requestCefriumNative(
      reset ? "te2.clientIdentity.reset" : "te2.clientIdentity.read",
    );
    return {
      clientInstanceId: validatedClientInstanceId(result.clientInstanceId),
      provider: "cefrium",
      label: "Cefrium Android installation",
    };
  }
  if (renderer === "gecko") {
    return {
      clientInstanceId: await requestGeckoClientIdentity(reset),
      provider: "gecko",
      label: "GeckoView Android installation",
    };
  }
  if (isAndroidNativePage()) {
    throw new Error("Android native renderer identity is missing or unsupported");
  }
  return {
    clientInstanceId: browserClientInstanceId(reset),
    provider: "browser",
    label: "Browser profile",
  };
}

export async function resolveCodeTe2ClientIdentity(
  options: { reset?: boolean } = {},
): Promise<CodeTe2ClientIdentity> {
  const resolved = await nativeClientInstanceId(options.reset === true);
  const windowId = windowIdentity();
  return Object.freeze({
    ...resolved,
    windowId,
    consoleWorkerId: `main_page:${resolved.clientInstanceId}:${windowId}`,
  });
}
