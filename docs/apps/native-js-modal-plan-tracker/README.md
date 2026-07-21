# Native JavaScript Modal Refactor

This directory owns the plan and execution tracker for one portable modal
system across TE2's browser, Android, and Electron surfaces.

The work has two ordered passes:

1. Replace browser-native `alert`, `confirm`, and `prompt` calls and register
   existing custom overlays behind one asynchronous JavaScript dialog service.
2. Add an Electron presenter that renders portable dialog contracts in a
   styled modal child window while browser and Android continue to render them
   inline.

See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for the architecture and
[TRACKER.md](./TRACKER.md) for the source inventory and completion gates.

## Approved scope

The scope is every active built-in app and shared framework surface, not only
Code TE2. The corrected source baseline contained 52 blocking browser-dialog
calls across six built-in apps and two shared framework surfaces:

| Surface | Calls |
| --- | ---: |
| Code TE2 host and Explorer | 32 |
| File Explorer | 5 |
| Archive Manager | 5 |
| Terminal | 4 |
| File Editor | 2 |
| Aria Downloader | 1 |
| Shared file picker | 1 |
| Shared app shell | 2 |

Current custom overlays include the framework Recents view, the shared file
picker, Code TE2 settings and operational modals, File Explorer properties and
bookmark modals, Archive Manager bookmark modals, Aria Downloader's new-task
modal, and File Editor's unsaved-change modal.

There are no active `HTMLDialogElement`, `<dialog>`, or `showModal()` call sites
to intercept. Existing modals are `div`-based overlays, while the blocking
dialogs are direct browser functions. Moving DOM nodes or callbacks between
renderer processes is therefore explicitly out of scope.

## Terminology

- **Browser-native dialog:** synchronous `window.alert`, `window.confirm`, or
  `window.prompt`.
- **Inline modal:** app-owned HTML/CSS rendered in the current document.
- **Dialog contract:** structured-clone-safe request and result data with no DOM
  nodes, functions, or raw executable HTML.
- **Presenter:** the environment-specific renderer for a dialog contract.
- **Desktop modal host:** the Electron modal `BrowserWindow` that presents
  portable contracts.
- **Surface adapter:** an explicit model/action adapter for a stateful existing
  modal that cannot be represented as a simple alert, confirmation, or prompt.

## Invariants

- The public API is asynchronous. Native blocking-dialog semantics are not
  monkeypatched or emulated synchronously.
- Browser and Android retain inline HTML/CSS rendering and behavior.
- Electron presentation is optional. If its adapter is absent or fails before
  showing, the dialog falls back to the inline presenter.
- The dialog service owns stacking, focus capture/restoration, Escape handling,
  default actions, cancellation, and app-navigation teardown.
- Dialog requests contain text and declarative data, never arbitrary HTML or a
  module path supplied at runtime.
- Modal presentation does not move application authority. File operations,
  settings changes, Git actions, and other effects remain in their existing
  frontend controller and backend/RPC lane.
- Existing app-owned listboxes and dropdowns remain JavaScript controls. This
  project does not introduce platform-native select menus.
- Toasts, notification cards, menus, drawers, and non-blocking search overlays
  are not silently reclassified as modals.
- The shared inline presenter remains the failure fallback after desktop modal
  presentation exists. The audit removed an older unowned crash-modal markup
  block; it was not connected to any source controller.
- Android native source and bundled-asset publication are separate scopes and
  require their normal explicit approval. Phase 1 must nevertheless preserve
  Android browser-wrapper semantics.

## Source authority

The current implementation is authoritative. This tracker should be updated in
the same change that moves a call site or modal family. Generated bundles are
validation artifacts and are not inventory sources.
