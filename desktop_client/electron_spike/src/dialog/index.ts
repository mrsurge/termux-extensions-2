import type {
  DialogHostOpenMessage,
  DialogRequest,
  DialogResult,
  DialogSize,
} from "../shared/dialog-contracts";

// This is the canonical browser/Android renderer. esbuild includes it in the
// trusted local dialog bundle so Electron does not carry a visual fork.
// @ts-expect-error The framework module is JavaScript and intentionally shared verbatim.
import { createInlineDialogPresenter } from "../../../../app/static/js/te_dialog.mjs";

type ActiveDialog = {
  request: DialogRequest;
  observer: ResizeObserver | null;
  lastSize: DialogSize | null;
};

const presenter = createInlineDialogPresenter(window) as {
  open(request: DialogRequest): Promise<DialogResult>;
  closeAll(status?: string): void;
  readonly size: number;
};
const active = new Map<string, ActiveDialog>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cardFor(request: DialogRequest): HTMLElement | null {
  return document.getElementById(`${request.requestId}-title`)?.closest<HTMLElement>(
    ".te-dialog-card",
  ) || null;
}

function desiredSize(request: DialogRequest, card: HTMLElement): DialogSize {
  const desiredWidth = request.width === "large" ? 980 : request.width === "medium" ? 740 : 500;
  return {
    width: desiredWidth,
    height: Math.max(180, Math.ceil(card.scrollHeight + 40)),
  };
}

function sameSize(left: DialogSize | null, right: DialogSize): boolean {
  return Boolean(left && left.width === right.width && left.height === right.height);
}

function reportSize(sessionId: string, initial = false): void {
  const entry = active.get(sessionId);
  if (!entry) return;
  const card = cardFor(entry.request);
  if (!card) {
    if (initial) window.te2DialogHost.failed(sessionId, "Dialog renderer did not create a card");
    return;
  }
  const size = desiredSize(entry.request, card);
  if (!initial && sameSize(entry.lastSize, size)) return;
  entry.lastSize = size;
  if (initial) window.te2DialogHost.presented(sessionId, size);
  else window.te2DialogHost.resized(sessionId, size);
}

function reportTopSize(): void {
  const sessionId = [...active.keys()].at(-1);
  if (sessionId) reportSize(sessionId);
}

function openDialog(message: DialogHostOpenMessage): void {
  const { sessionId, request } = message;
  if (active.has(sessionId)) {
    window.te2DialogHost.failed(sessionId, "Duplicate dialog session");
    return;
  }

  try {
    const result = presenter.open(request);
    const card = cardFor(request);
    if (!card) throw new Error("Dialog renderer did not create a card");
    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => reportSize(sessionId))
      : null;
    active.set(sessionId, { request, observer, lastSize: null });
    observer?.observe(card);
    requestAnimationFrame(() => reportSize(sessionId, true));

    void result.then((value) => {
      window.te2DialogHost.resolved(sessionId, value);
    }).catch((error: unknown) => {
      window.te2DialogHost.failed(sessionId, errorMessage(error));
    }).finally(() => {
      active.get(sessionId)?.observer?.disconnect();
      active.delete(sessionId);
      requestAnimationFrame(reportTopSize);
    });
  } catch (error) {
    active.get(sessionId)?.observer?.disconnect();
    active.delete(sessionId);
    window.te2DialogHost.failed(sessionId, errorMessage(error));
  }
}

window.te2DialogHost.onOpen(openDialog);
window.te2DialogHost.onCloseAll(({ status }) => presenter.closeAll(status));
window.te2DialogHost.ready();
