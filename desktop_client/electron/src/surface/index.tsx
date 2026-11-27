import {
  createComponentOwner,
  createComponentStateController,
  jsx,
  renderWithOwner,
} from "../../../../app/apps/code_te2/main_page/frontend/ui/component-runtime/index.ts";
import type {
  ElectronSidebarSurfaceAction,
  ElectronSidebarSurfaceDescriptor,
} from "../shared/app-view-contracts";

import { trackHeaderPointer } from "../shared/header-pointer";

trackHeaderPointer();

const bridge = window.te2DetachedSurface;
if (!bridge) throw new Error("Detached Sidebar surface bridge is unavailable");

const root = document.getElementById("surface-root");
if (!root) throw new Error("Detached Sidebar surface root is unavailable");

const owner = createComponentOwner();
let renderOwner: ReturnType<typeof createComponentOwner> | null = null;

function act(action: ElectronSidebarSurfaceAction): void {
  bridge.action(action);
}

const actionPaths = {
  refresh: "M20 5v6h-6 M20 11a8 8 0 1 0-2 7",
  devtools: "M3 4h18v16H3z M6 9l3 3-3 3 M12 15h5",
  stop: "M6 6h12v12H6z",
};

function actionButton(action: keyof typeof actionPaths, label: string): Node {
  const ns = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(ns, "svg");
  icon.setAttribute("class", "action-icon");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", actionPaths[action]);
  icon.append(path);
  return (
    <button className={action === "stop" ? "surface-button danger" : "surface-button"}
      type="button" title={label} aria-label={label} onClick={() => act(action)}>
      <span className="action-label">{label}</span>{icon}
    </button>
  );
}

function SurfaceHeader(props: { descriptor: ElectronSidebarSurfaceDescriptor }): Node {
  const { descriptor } = props;
  const detail = [descriptor.profileId, descriptor.projectPath]
    .filter(Boolean)
    .join(" · ");
  return (
    <header className="surface-header">
      <div className="surface-identity">
        <span className="surface-title" title={descriptor.label}>
          {descriptor.label}
        </span>
        <span className="surface-detail" title={detail}>{detail}</span>
      </div>
      <nav className="surface-actions" aria-label="Detached surface tools">
        {actionButton("refresh", "Refresh")}
        {actionButton("devtools", "DevTools")}
        {descriptor.profileId ? actionButton("stop", "Stop") : null}
        <button
          className="surface-button"
          type="button"
          title="Minimize window"
          aria-label="Minimize detached window"
          onClick={() => act("minimize")}
        >
          −
        </button>
        <button
          className="surface-button"
          type="button"
          aria-label="Maximize or restore detached window"
          title="Maximize or restore window"
          onClick={() => act("toggle_maximize")}
        >□</button>
        <button
          className="surface-button close"
          type="button"
          title="Close window and reattach to sidebar"
          aria-label="Close window and reattach to sidebar"
          onClick={() => act("attach")}
        >×</button>
      </nav>
    </header>
  );
}

const controller = createComponentStateController<
  ElectronSidebarSurfaceDescriptor | null
>(null, (descriptor) => {
  renderOwner?.dispose();
  renderOwner = null;
  root.replaceChildren();
  if (!descriptor) return;
  renderOwner = owner.child();
  root.appendChild(
    renderWithOwner(document, renderOwner, () => (
      <SurfaceHeader descriptor={descriptor} />
    )),
  );
  document.title = descriptor.label;
}, owner);

owner.own(bridge.onState((descriptor) => controller.setState(descriptor)));
owner.onDispose(() => renderOwner?.dispose());
owner.listen(window, "beforeunload", () => owner.dispose(), { once: true });
bridge.ready();
