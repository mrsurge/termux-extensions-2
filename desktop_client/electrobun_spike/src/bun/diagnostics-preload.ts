export const diagnosticsPreload = String.raw`
(() => {
  if (window !== window.top || window.__te2ElectrobunSpikeInstalled) return;
  window.__te2ElectrobunSpikeInstalled = true;

  const startedAt = performance.now();
  const state = {
    rafFrames: 0,
    rafGapsOver50Ms: 0,
    rafGapsOver100Ms: 0,
    longestRafGapMs: 0,
    resizeEvents: 0,
    resizeRafFrames: 0,
    resizeRafGapsOver50Ms: 0,
    resizeRafGapsOver100Ms: 0,
    longestResizeRafGapMs: 0,
    longTasks: 0,
    longestLongTaskMs: 0,
    socketsCreated: 0,
    socketsOpened: 0,
    socketsActive: 0,
    socketErrors: 0,
    socketUrls: [],
    workersCreated: 0,
    moduleWorkersCreated: 0,
    workerErrors: 0,
    moduleWorkerProbe: "pending",
    resourceErrors: [],
    runtimeErrors: [],
  };
  window.__te2ElectrobunSpike = state;

  const boundedPush = (target, value, limit) => {
    target.push(value);
    if (target.length > limit) target.splice(0, target.length - limit);
  };

  const safeUrl = (value) => {
    try {
      const url = new URL(String(value), location.href);
      return url.origin + url.pathname;
    } catch {
      return String(value).slice(0, 240);
    }
  };

  const emit = (phase, data = {}) => {
    try {
      const bridge = window.__electrobunEventBridge || window.__electrobunInternalBridge;
      if (!bridge) return;
      const detail = JSON.stringify({
        source: "te2-electrobun-spike",
        phase,
        elapsedMs: Math.round(performance.now() - startedAt),
        ...data,
      });
      bridge.postMessage(JSON.stringify({
        id: "webviewEvent",
        type: "message",
        payload: {
          id: window.__electrobunWebviewId,
          eventName: "host-message",
          detail,
        },
      }));
    } catch {
      // Diagnostics must never become an application dependency.
    }
  };

  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class TrackedWebSocket extends NativeWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      state.socketsCreated += 1;
      boundedPush(state.socketUrls, safeUrl(url), 20);
      this.addEventListener("open", () => {
        state.socketsOpened += 1;
        state.socketsActive += 1;
      });
      this.addEventListener("close", () => {
        state.socketsActive = Math.max(0, state.socketsActive - 1);
      });
      this.addEventListener("error", () => {
        state.socketErrors += 1;
      });
    }
  };

  const NativeWorker = window.Worker;
  window.Worker = class TrackedWorker extends NativeWorker {
    constructor(url, options) {
      super(url, options);
      state.workersCreated += 1;
      if (options && options.type === "module") state.moduleWorkersCreated += 1;
      this.addEventListener("error", () => {
        state.workerErrors += 1;
      });
    }
  };

  let previousFrameAt = performance.now();
  let resizingUntil = 0;
  window.addEventListener("resize", () => {
    state.resizeEvents += 1;
    resizingUntil = performance.now() + 250;
  });
  const frameSample = (now) => {
    const gap = now - previousFrameAt;
    previousFrameAt = now;
    state.rafFrames += 1;
    state.longestRafGapMs = Math.max(state.longestRafGapMs, gap);
    if (gap > 50) state.rafGapsOver50Ms += 1;
    if (gap > 100) state.rafGapsOver100Ms += 1;
    if (now <= resizingUntil) {
      state.resizeRafFrames += 1;
      state.longestResizeRafGapMs = Math.max(state.longestResizeRafGapMs, gap);
      if (gap > 50) state.resizeRafGapsOver50Ms += 1;
      if (gap > 100) state.resizeRafGapsOver100Ms += 1;
    }
    requestAnimationFrame(frameSample);
  };
  requestAnimationFrame(frameSample);

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.longTasks += 1;
        state.longestLongTaskMs = Math.max(state.longestLongTaskMs, entry.duration);
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    // Long Task API availability is diagnostic information, not a requirement.
  }

  window.addEventListener("error", (event) => {
    const target = event.target;
    const resource = target && (target.src || target.href);
    if (resource) {
      boundedPush(state.resourceErrors, safeUrl(resource), 20);
      return;
    }
    boundedPush(
      state.runtimeErrors,
      String(event.message || event.error || "window error").slice(0, 400),
      20,
    );
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    boundedPush(
      state.runtimeErrors,
      String(event.reason || "unhandled rejection").slice(0, 400),
      20,
    );
  });

  const gpuInfo = () => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return { available: false };
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      available: true,
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      version: gl.getParameter(gl.VERSION),
      attributes: gl.getContextAttributes(),
    };
  };
  let cachedGpuInfo = null;

  const scanDocuments = () => {
    const documents = [];
    const seen = new Set();
    const visit = (doc) => {
      if (!doc || seen.has(doc)) return;
      seen.add(doc);
      documents.push(doc);
      for (const frame of doc.querySelectorAll("iframe")) {
        try {
          visit(frame.contentDocument);
        } catch {
          // Cross-origin frames still count as frames, but their DOM is opaque.
        }
      }
    };
    visit(document);

    let iframeCount = 0;
    let loadedIframeCount = 0;
    let monacoEditors = 0;
    let terminals = 0;
    let explorerRows = 0;
    let expandedExplorerRows = 0;
    for (const doc of documents) {
      const frames = Array.from(doc.querySelectorAll("iframe"));
      iframeCount += frames.length;
      loadedIframeCount += frames.filter((frame) => {
        try {
          return Boolean(frame.contentDocument && frame.contentDocument.readyState === "complete");
        } catch {
          return false;
        }
      }).length;
      monacoEditors += doc.querySelectorAll(".monaco-editor").length;
      terminals += doc.querySelectorAll(".xterm").length;
      explorerRows += doc.querySelectorAll("#fe-file-tree li, .fe-tree li").length;
      expandedExplorerRows += doc.querySelectorAll(
        "#fe-file-tree li[aria-expanded='true'], .fe-tree li[aria-expanded='true'], details[open]",
      ).length;
    }
    return {
      documentCount: documents.length,
      iframeCount,
      loadedIframeCount,
      monacoEditors,
      terminals,
      explorerRows,
      expandedExplorerRows,
    };
  };

  const probeModuleWorker = () => {
    try {
      const source = "postMessage({ok: true, url: import.meta.url});";
      const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      const worker = new NativeWorker(url, { type: "module", name: "te2-cef-module-probe" });
      const timeout = setTimeout(() => {
        state.moduleWorkerProbe = "timeout";
        worker.terminate();
        URL.revokeObjectURL(url);
      }, 5000);
      worker.addEventListener("message", () => {
        clearTimeout(timeout);
        state.moduleWorkerProbe = "ok";
        worker.terminate();
        URL.revokeObjectURL(url);
      }, { once: true });
      worker.addEventListener("error", (event) => {
        clearTimeout(timeout);
        state.moduleWorkerProbe = "error: " + String(event.message || "unknown");
        worker.terminate();
        URL.revokeObjectURL(url);
      }, { once: true });
    } catch (error) {
      state.moduleWorkerProbe = "error: " + String(error);
    }
  };

  const report = () => {
    emit("snapshot", {
      url: safeUrl(location.href),
      title: document.title,
      readyState: document.readyState,
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      devicePixelRatio: window.devicePixelRatio,
      webgpuAvailable: Boolean(navigator.gpu),
      offscreenCanvasAvailable: typeof OffscreenCanvas !== "undefined",
      crossOriginIsolated: window.crossOriginIsolated,
      gpu: cachedGpuInfo || (cachedGpuInfo = gpuInfo()),
      dom: scanDocuments(),
      performance: {
        rafFrames: state.rafFrames,
        rafGapsOver50Ms: state.rafGapsOver50Ms,
        rafGapsOver100Ms: state.rafGapsOver100Ms,
        longestRafGapMs: Math.round(state.longestRafGapMs * 10) / 10,
        longTasks: state.longTasks,
        longestLongTaskMs: Math.round(state.longestLongTaskMs * 10) / 10,
        resizeEvents: state.resizeEvents,
        resizeRafFrames: state.resizeRafFrames,
        resizeRafGapsOver50Ms: state.resizeRafGapsOver50Ms,
        resizeRafGapsOver100Ms: state.resizeRafGapsOver100Ms,
        longestResizeRafGapMs: Math.round(state.longestResizeRafGapMs * 10) / 10,
      },
      transport: {
        socketsCreated: state.socketsCreated,
        socketsOpened: state.socketsOpened,
        socketsActive: state.socketsActive,
        socketErrors: state.socketErrors,
        socketUrls: state.socketUrls,
      },
      workers: {
        created: state.workersCreated,
        moduleCreated: state.moduleWorkersCreated,
        errors: state.workerErrors,
        moduleProbe: state.moduleWorkerProbe,
      },
      failures: {
        resources: state.resourceErrors,
        runtime: state.runtimeErrors,
      },
    });
  };

  emit("preload", { url: safeUrl(location.href) });
  probeModuleWorker();
  window.addEventListener("load", () => {
    report();
    setTimeout(report, 1000);
  }, { once: true });
  setInterval(report, 3000);
})();
`;
