export type AndroidNativeRenderer = "gecko" | "cefrium";

interface CefriumQueryRequest {
  request: string;
  onSuccess: (response: string) => void;
  onFailure: (errorCode: number, errorMessage: string) => void;
}

interface CefriumNativeWindow extends Window {
  cefriumQuery?: (request: CefriumQueryRequest) => void;
}

const GECKO_NATIVE_PRESENTATION_REQUEST =
  "te2.sidebarPresentation.request";
const GECKO_NATIVE_PRESENTATION_RESPONSE =
  "te2.sidebarPresentation.response";

export interface AndroidSidebarPresentationReadResult {
  found: boolean;
  state?: unknown;
}

export function androidNativeRenderer(): AndroidNativeRenderer | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get("gv_native") !== "1") return null;
  const renderer = (params.get("te2_renderer") || "").trim().toLowerCase();
  // Gecko APKs predating explicit renderer identity still receive OTA frontend assets.
  if (!renderer) return "gecko";
  return renderer === "gecko" || renderer === "cefrium" ? renderer : null;
}

export function isAndroidNativePage(): boolean {
  return new URLSearchParams(window.location.search).get("gv_native") === "1";
}

export function requestCefriumNative(
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const bridge = (window as CefriumNativeWindow).cefriumQuery;
  if (typeof bridge !== "function") {
    return Promise.reject(new Error("Cefrium native bridge is unavailable"));
  }
  return new Promise((resolve, reject) => {
    bridge({
      request: JSON.stringify({ method, params }),
      onSuccess(response: string): void {
        try {
          const result: unknown = JSON.parse(response);
          if (!result || typeof result !== "object" || Array.isArray(result)) {
            throw new Error("Cefrium native bridge returned an invalid response");
          }
          const record = result as Record<string, unknown>;
          if (record.ok !== true) throw new Error("Cefrium native bridge request failed");
          resolve(record);
        } catch (error) {
          reject(error);
        }
      },
      onFailure(errorCode: number, errorMessage: string): void {
        reject(new Error(`Cefrium native bridge failed (${errorCode}): ${errorMessage}`));
      },
    });
  });
}

function requestGeckoSidebarPresentation(
  method: "read" | "write",
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const requestId = globalThis.crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Gecko Sidebar presentation bridge timed out"));
    }, 10_000);
    function onMessage(event: MessageEvent): void {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data;
      if (
        !data ||
        data.channel !== GECKO_NATIVE_PRESENTATION_RESPONSE ||
        data.requestId !== requestId
      ) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      const result = data.result;
      if (!result || typeof result !== "object" || result.ok !== true) {
        reject(
          new Error(
            String(result?.error || "Gecko Sidebar presentation request failed"),
          ),
        );
        return;
      }
      resolve(result as Record<string, unknown>);
    }
    window.addEventListener("message", onMessage);
    window.postMessage(
      {
        channel: GECKO_NATIVE_PRESENTATION_REQUEST,
        requestId,
        method,
        params,
      },
      window.location.origin,
    );
  });
}

async function requestAndroidSidebarPresentation(
  method: "read" | "write",
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const renderer = androidNativeRenderer();
  if (renderer === "cefrium") {
    return requestCefriumNative(`te2.sidebarPresentation.${method}`, params);
  }
  if (renderer === "gecko") {
    return requestGeckoSidebarPresentation(method, params);
  }
  throw new Error("Android Sidebar presentation bridge is unavailable");
}

export async function readAndroidSidebarPresentationState(
  projectPath: string,
  clientInstanceId: string,
): Promise<AndroidSidebarPresentationReadResult> {
  const result = await requestAndroidSidebarPresentation("read", {
    projectPath,
    clientInstanceId,
  });
  return {
    found: result.found === true,
    ...(result.found === true ? { state: result.state } : {}),
  };
}

export async function writeAndroidSidebarPresentationState(
  projectPath: string,
  clientInstanceId: string,
  state: unknown,
): Promise<void> {
  await requestAndroidSidebarPresentation("write", {
    projectPath,
    clientInstanceId,
    state,
  });
}
