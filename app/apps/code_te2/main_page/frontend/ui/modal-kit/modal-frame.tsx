import {
  createComponentOwner,
  jsx,
  renderWithOwner,
} from "./jsx-runtime.ts";

export interface ModalFrameOptions {
  id: string;
  surfaceId?: string;
  title: string;
  width?: string;
  maxHeight?: string;
  onClose: () => void;
}

export interface ModalFrameElements {
  root: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  dispose: () => void;
}

interface ModalFrameComponentProps extends ModalFrameOptions {
  rootRef: (element: HTMLElement) => void;
  bodyRef: (element: HTMLElement) => void;
  footerRef: (element: HTMLElement) => void;
}

function ModalFrame(props: ModalFrameComponentProps): Node {
  return (
    <div
      id={props.id}
      className="fe-modal declarative-modal"
      data-te-dialog-surface={props.surfaceId}
      aria-hidden="true"
      ref={props.rootRef}
      onClick={(event: MouseEvent) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        className="fe-modal-card declarative-modal-card"
        style={{
          width: props.width || "",
          maxHeight: props.maxHeight || "",
        }}
      >
        <div className="fe-modal-header declarative-modal-header">
          <strong>{props.title}</strong>
          <span style={{ flex: "1" }} />
          <button
            className="fe-btn"
            type="button"
            aria-label="Close"
            onClick={props.onClose}
          >
            ✕
          </button>
        </div>
        <div
          className="fe-modal-body declarative-modal-body"
          ref={props.bodyRef}
        />
        <div className="declarative-modal-footer" ref={props.footerRef} />
      </div>
    </div>
  );
}

export function createModalFrame(
  document: Document,
  options: ModalFrameOptions,
): ModalFrameElements {
  const owner = createComponentOwner();
  let root: HTMLElement | null = null;
  let body: HTMLElement | null = null;
  let footer: HTMLElement | null = null;
  const rendered = renderWithOwner(document, owner, () =>
    <ModalFrame
      {...options}
      rootRef={(element: HTMLElement) => { root = element; }}
      bodyRef={(element: HTMLElement) => { body = element; }}
      footerRef={(element: HTMLElement) => { footer = element; }}
    />
  );
  if (!root || !body || !footer || rendered !== root) {
    owner.dispose();
    throw new Error("Declarative modal frame did not produce its required elements");
  }
  return { root, body, footer, dispose: () => owner.dispose() };
}
