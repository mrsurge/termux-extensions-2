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

const bridge = window.te2DetachedSurface;
if (!bridge) throw new Error("Detached Sidebar surface bridge is unavailable");

const root = document.getElementById("surface-root");
if (!root) throw new Error("Detached Sidebar surface root is unavailable");

const owner = createComponentOwner();
let renderOwner: ReturnType<typeof createComponentOwner> | null = null;

function act(action: ElectronSidebarSurfaceAction): void {
  bridge.action(action);
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
        <button className="surface-button" type="button" onClick={() => act("attach")}>
          Attach
        </button>
        <button className="surface-button" type="button" onClick={() => act("refresh")}>
          Refresh
        </button>
        <button className="surface-button" type="button" onClick={() => act("console")}>
          Console
        </button>
        <button className="surface-button" type="button" onClick={() => act("devtools")}>
          DevTools
        </button>
        {descriptor.profileId
          ? (
            <button className="surface-button danger" type="button" onClick={() => act("stop")}>
              Stop
            </button>
          )
          : null}
        <button
          className="surface-button close"
          type="button"
          aria-label="Attach and close detached window"
          onClick={() => act("attach")}
        >
          ✕
        </button>
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
