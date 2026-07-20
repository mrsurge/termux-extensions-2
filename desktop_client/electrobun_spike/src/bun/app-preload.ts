import { diagnosticsPreload } from "./diagnostics-preload";

export const appPreload = `${diagnosticsPreload}\n${String.raw`
(() => {
  if (window !== window.top || window.__te2DesktopShellPreload) return;
  window.__te2DesktopShellPreload = true;

  const post = (payload) => {
    try {
      const bridge = window.__electrobunEventBridge || window.__electrobunInternalBridge;
      bridge?.postMessage(JSON.stringify({
        id: "webviewEvent",
        type: "message",
        payload: {
          id: window.__electrobunWebviewId,
          eventName: "host-message",
          detail: JSON.stringify({ source: "te2-desktop-shell", ...payload }),
        },
      }));
    } catch {}
  };

  const publishNavigation = () => post({
    phase: "navigation",
    url: location.href,
    title: document.title || "TE2 Desktop",
  });

  const installNativeStyle = () => {
    if (document.getElementById("te2-desktop-native-style")) return;
    const style = document.createElement("style");
    style.id = "te2-desktop-native-style";
    style.textContent = "html > body > .app-shell > .app-toolbar{display:none!important}";
    (document.head || document.documentElement).appendChild(style);
  };

  installNativeStyle();
  addEventListener("DOMContentLoaded", () => {
    installNativeStyle();
    publishNavigation();
    const title = document.querySelector("title");
    if (title) new MutationObserver(publishNavigation).observe(title, { childList: true, subtree: true });
  }, { once: true });
  addEventListener("load", publishNavigation, { once: true });
  addEventListener("popstate", publishNavigation);
  addEventListener("hashchange", publishNavigation);
})();
`}`;
