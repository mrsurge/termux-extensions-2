const SURFACE_WINDOW_NAME = "te2-modal-surface";
const SURFACE_WINDOW_FEATURES = "popup,width=1000,height=760";
const REPARENT_EVENT = "te2:modal-surface-reparented";

function copyElementState(source, target) {
  target.className = source.className;
  target.style.cssText = source.style.cssText;
  for (const attribute of [...source.attributes]) {
    if (attribute.name === "class" || attribute.name === "style") continue;
    target.setAttribute(attribute.name, attribute.value);
  }
}

function mirrorDocumentStyles(sourceDocument, targetDocument) {
  for (const prior of targetDocument.head.querySelectorAll(
    "[data-te-modal-surface-mirror]",
  )) {
    prior.remove();
  }
  for (const source of sourceDocument.querySelectorAll('style, link[rel="stylesheet"]')) {
    const copy = source.cloneNode(true);
    copy.dataset.teModalSurfaceMirror = "true";
    if (copy.tagName === "LINK") {
      copy.href = source.href;
    }
    targetDocument.head.appendChild(copy);
  }

  const portalStyle = targetDocument.createElement("style");
  portalStyle.dataset.teModalSurfaceMirror = "true";
  portalStyle.dataset.teModalSurfacePortal = "true";
  portalStyle.textContent = `
    *, *::before, *::after {
      box-sizing: border-box;
    }
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: var(--background, var(--card, #0b0f1a));
      color: var(--foreground, #e5e7eb);
    }
    body > .te-modal-surface-window-root {
      position: fixed;
      inset: 0;
      display: block;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
    .te-modal-surface-window-root > [data-te-dialog-surface] {
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      min-width: 0 !important;
      min-height: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      background: transparent !important;
    }
    .te-modal-surface-window-root > [data-te-dialog-surface].show,
    .te-modal-surface-window-root > [data-te-dialog-surface][aria-hidden="false"] {
      display: flex !important;
    }
    .te-modal-surface-window-root .fe-modal-card,
    .te-modal-surface-window-root .app-modal-content,
    .te-modal-surface-window-root .te-fp-dialog,
    .te-modal-surface-window-root .fx-modal-dialog,
    .te-modal-surface-window-root .am-modal-dialog,
    .te-modal-surface-window-root .aria-modal {
      width: 100% !important;
      height: 100% !important;
      max-width: none !important;
      max-height: none !important;
      min-width: 0;
      min-height: 0;
      border-radius: 2px !important;
      box-shadow: none !important;
    }
    .te-modal-surface-window-root .fe-modal-body,
    .te-modal-surface-window-root .app-modal-body,
    .te-modal-surface-window-root .aria-modal-body {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      overscroll-behavior: contain;
    }
    .te-modal-surface-window-root .te-fp-dialog {
      overflow: hidden;
    }
    .te-modal-surface-window-root .te-fp-body {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
    .te-modal-surface-window-root .te-fp-scroll {
      flex: 1 1 auto;
      min-height: 0;
      max-height: none;
      overflow: auto;
      overscroll-behavior: contain;
    }
    .te-modal-surface-window-root .fx-modal-dialog,
    .te-modal-surface-window-root .am-modal-dialog {
      overflow-y: auto;
      overflow-x: hidden;
      overscroll-behavior: contain;
    }
    .te-modal-surface-window-root .fe-modal-header,
    .te-modal-surface-window-root .app-modal-header,
    .te-modal-surface-window-root .te-fp-header,
    .te-modal-surface-window-root .fx-modal-header,
    .te-modal-surface-window-root .am-modal-header,
    .te-modal-surface-window-root .aria-modal > header {
      -webkit-app-region: drag;
      user-select: none;
    }
    .te-modal-surface-window-root button,
    .te-modal-surface-window-root input,
    .te-modal-surface-window-root textarea,
    .te-modal-surface-window-root select,
    .te-modal-surface-window-root a,
    .te-modal-surface-window-root [contenteditable="true"],
    .te-modal-surface-window-root .cm-editor,
    .te-modal-surface-window-root .fe-modal-body,
    .te-modal-surface-window-root .app-modal-body,
    .te-modal-surface-window-root .te-fp-body,
    .te-modal-surface-window-root .te-fp-scroll,
    .te-modal-surface-window-root .fx-modal-dialog,
    .te-modal-surface-window-root .am-modal-dialog,
    .te-modal-surface-window-root .aria-modal-body {
      -webkit-app-region: no-drag;
    }
  `;
  targetDocument.head.appendChild(portalStyle);

  copyElementState(sourceDocument.documentElement, targetDocument.documentElement);
  copyElementState(sourceDocument.body, targetDocument.body);
}

export function createSurfacePortalPresenter(
  targetWindow,
  options = {},
) {
  const sourceDocument = targetWindow?.document;
  const createInlinePresenter = options.createInlinePresenter;
  const records = new Map();
  let popup = null;
  let portalRoot = null;
  let dialogPresenter = null;
  let popupObserver = null;
  let closingProgrammatically = false;

  function enabled() {
    return Boolean(
      sourceDocument &&
      targetWindow?.te2DesktopSurfaceWindows?.enabled === true &&
      typeof targetWindow.open === "function",
    );
  }

  function updatePopupTitle() {
    if (!popup || popup.closed) return;
    const top = [...records.values()].at(-1);
    popup.document.title = top?.label || "TE2";
  }

  function notifyReparent(element) {
    try {
      targetWindow.dispatchEvent(new targetWindow.CustomEvent(REPARENT_EVENT, {
        detail: {
          element,
          document: element.ownerDocument,
        },
      }));
    } catch (error) {
      targetWindow.console?.warn?.(
        "[teUI.dialog] failed to publish modal reparent event",
        error,
      );
    }
  }

  function restore(record) {
    if (!record || record.restored) return;
    record.restored = true;
    const parent = record.placeholder.parentNode;
    if (!record.element.isConnected) {
      record.placeholder.remove();
      record.onDetached?.();
      return;
    }
    if (parent) parent.replaceChild(record.element, record.placeholder);
    else sourceDocument.body.appendChild(record.element);
    record.element.inert = false;
    notifyReparent(record.element);
  }

  function restoreAll(requestClose = false) {
    const active = [...records.values()].reverse();
    if (requestClose) {
      for (const record of active) {
        try {
          record.requestClose?.();
        } catch (error) {
          targetWindow.console?.warn?.(
            `[teUI.dialog] failed to close ${record.id} from modal window`,
            error,
          );
        }
      }
    }
    dialogPresenter?.closeAll?.("closed");
    for (const record of active) {
      records.delete(record.element);
      restore(record);
    }
  }

  function resetPopup(requestClose = false) {
    restoreAll(requestClose);
    popupObserver?.disconnect?.();
    popupObserver = null;
    popup = null;
    portalRoot = null;
    dialogPresenter = null;
  }

  function handlePopupUnload() {
    if (closingProgrammatically) return;
    resetPopup(true);
  }

  function preparePopup(candidate) {
    popup = candidate;
    const popupDocument = candidate.document;
    popupDocument.title = "TE2";
    mirrorDocumentStyles(sourceDocument, popupDocument);
    popupDocument.body.replaceChildren();
    portalRoot = popupDocument.createElement("main");
    portalRoot.className = "te-modal-surface-window-root";
    popupDocument.body.appendChild(portalRoot);
    dialogPresenter = typeof createInlinePresenter === "function"
      ? createInlinePresenter(candidate)
      : null;
    const Observer = candidate.MutationObserver;
    if (Observer) {
      popupObserver = new Observer(() => {
        for (const record of [...records.values()]) {
          if (portalRoot?.contains(record.element)) continue;
          records.delete(record.element);
          record.restored = true;
          record.placeholder.remove();
          record.onDetached?.();
        }
        if (records.size) updatePopupTitle();
        if (!records.size && popup && !popup.closed) {
          dialogPresenter?.closeAll?.("closed");
          popupObserver?.disconnect?.();
          popupObserver = null;
          closingProgrammatically = true;
          try {
            popup.close();
          } finally {
            closingProgrammatically = false;
            popup = null;
            portalRoot = null;
            dialogPresenter = null;
          }
        }
      });
      popupObserver.observe(portalRoot, { childList: true });
    }
    candidate.addEventListener("beforeunload", handlePopupUnload);
    candidate.addEventListener("pagehide", handlePopupUnload);
  }

  function ensurePopup() {
    if (popup && !popup.closed && portalRoot?.isConnected) return popup;
    resetPopup(false);
    const candidate = targetWindow.open(
      "",
      SURFACE_WINDOW_NAME,
      SURFACE_WINDOW_FEATURES,
    );
    if (!candidate) return null;
    try {
      preparePopup(candidate);
      return candidate;
    } catch (error) {
      targetWindow.console?.warn?.(
        "[teUI.dialog] unable to prepare desktop modal window",
        error,
      );
      try {
        candidate.close();
      } catch (_) {}
      resetPopup(false);
      return null;
    }
  }

  function open(entry) {
    if (!enabled() || records.has(entry.element)) return false;
    const modalWindow = ensurePopup();
    if (!modalWindow || !portalRoot) return false;

    const placeholder = sourceDocument.createComment(`te-modal:${entry.id}`);
    entry.element.parentNode?.insertBefore(placeholder, entry.element);
    const record = {
      id: entry.id,
      element: entry.element,
      placeholder,
      requestClose: entry.requestClose,
      onDetached: entry.onDetached,
      label: entry.options?.label || entry.id,
      restored: false,
    };
    records.set(entry.element, record);
    mirrorDocumentStyles(sourceDocument, modalWindow.document);
    portalRoot.appendChild(entry.element);
    notifyReparent(entry.element);
    updatePopupTitle();
    modalWindow.focus?.();
    return true;
  }

  function close(entry) {
    const record = records.get(entry.element);
    if (!record) return;
    records.delete(entry.element);
    restore(record);
    if (records.size) {
      updatePopupTitle();
      return;
    }
    if (!popup || popup.closed) {
      popupObserver?.disconnect?.();
      popupObserver = null;
      popup = null;
      portalRoot = null;
      dialogPresenter = null;
      return;
    }
    dialogPresenter?.closeAll?.("closed");
    popupObserver?.disconnect?.();
    popupObserver = null;
    closingProgrammatically = true;
    try {
      popup.close();
    } finally {
      closingProgrammatically = false;
      popup = null;
      portalRoot = null;
      dialogPresenter = null;
    }
  }

  function closeAll() {
    restoreAll(true);
    popupObserver?.disconnect?.();
    popupObserver = null;
    if (popup && !popup.closed) {
      closingProgrammatically = true;
      try {
        popup.close();
      } finally {
        closingProgrammatically = false;
      }
    }
    popup = null;
    portalRoot = null;
    dialogPresenter = null;
  }

  return {
    enabled,
    open,
    close,
    closeAll,
    get dialogPresenter() {
      return records.size ? dialogPresenter : null;
    },
    get size() {
      return records.size;
    },
  };
}

export const surfaceWindowName = SURFACE_WINDOW_NAME;
export const surfaceReparentEvent = REPARENT_EVENT;
