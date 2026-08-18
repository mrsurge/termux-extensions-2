export type AndroidNativeRenderer = "gecko" | "cefrium";

interface CefriumQueryRequest {
  request: string;
  onSuccess: (response: string) => void;
  onFailure: (errorCode: number, errorMessage: string) => void;
}

interface CefriumNativeWindow extends Window {
  cefriumQuery?: (request: CefriumQueryRequest) => void;
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
