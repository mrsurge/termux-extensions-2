# Client Runtime Polish After 0.2.351

## Scope

Investigation-first maintenance work covering color-picker latency, persistent
Sidebar presentation, and Cefrium zoom suppression. Keep the existing working
branch for now; no release, version bump, or implementation is authorized by
this documentation pass. Track execution in TRACKER.md alongside this file.

## 1. Color picker latency

Compare normal hover with color decoration discovery, picker opening, and color
presentation updates on the same document and client. Measure cold activation
separately from warm interactions, locally and over a remote connection.

Trace Monaco scheduling and provider registration through the direct WBA lane,
document synchronization, selector matching, extension-host dispatch, and reply
application. Identify redundant round trips, full-document transfers, provider
waits, and serial work before selecting a fix. Preserve all matching providers,
cancellation, document revisions, and client identity; no CSS-only bypass.

Initial source leads, not a confirmed runtime diagnosis:

- WBA `extensions/intelligence/document-colors.ts` has a provider-discovery wait
  capped at five seconds and a document-sync cache.
- `provideColorPresentations` passes `languageId` to `documentColorHandles`,
  whose declared input is `ProviderDocument`. Trace caller-supplied handles and
  runtime matching to determine the actual effect.
- Compare against `extensions/intelligence/hover.ts` and the editor color-provider
  registration/transport path; do not infer latency from timeout limits alone.

Acceptance: warm picker opens without avoidable registration/synchronization
delays; color changes and format choices remain correct after edits, file
switches, reconnects, and multiple clients opening the same document.

## 2. Stable client identity and durable Sidebar preferences

### Intended contract

Assign one stable primary identity per native installation or browser profile.
Each device/client has its own identity; devices do not share one global ID.
Normal reload, worker/framework restart, reconnect, and native relay-port changes
must never rotate it. Explicit reset may rotate it. Secondary editors retain
their separate stable identities. Keep transient window/console/session identity
out of durable preference keys.

Prefer a compact cryptographically random opaque ID for new identities. Audit
current validators and native stores before choosing its final length. Preserve
existing valid identities instead of shortening them in place and orphaning
preferences. Browser IDs use localStorage; native IDs use app-private storage.

Store per-client Sidebar ordering and hidden/embedded/detached preferences in a
dedicated on-disk configuration file under canonical TE2 config storage, scoped
by project and the stable identity. This is the proposed backend projection;
investigate migration from existing native/browser stores and select one clear
authority rather than leaving competing persistence writers. Authenticate writes
through the existing client lane; an ID alone is not authorization.

Audit why Hide extension view is lost after Code TE2 exits: compare the saved
record, client identity, upstream/project key, slot/extension identity, restart
snapshot, and activation replay. Hidden preferences must survive regenerated
runtime handles, non-authoritative empty snapshots, and delayed WBA activation.

### Startup and storage

Load the small client preference projection once through an existing authenticated
boot/preference exchange where practical. Measure before adding another request.
Sidebar initialization runs asynchronously from editor/document/page readiness.
Apply stored visibility before materializing extension views; extension activation
and resource loading must not hold either editor or Sidebar shell readiness.
Preserve exact-client routing, shared membership, and deliberate user reopen.

Track last access for retained preference records, with coalesced writes rather
than a disk write per interaction. Records unused for 14 days become eligible
for cleanup after Sidebar initialization, off the critical path. Cleanup must
protect active/reconnected clients and concurrent writes, never delete shared
documents or extension state, and never rotate the client's installation ID.
Returning after eviction retains that ID but starts with default presentation.
Do not introduce recurring polling for housekeeping.

Source starting points: frontend `client-identity.ts`, Sidebar
`presentation-state.ts`/`runtime.ts`, Electron `desktop-state-store.ts`, Android
`AndroidNativePageIdentity.kt`/`AndroidSidebarPresentationStore.kt`, backend
`client_presentation.py`, and the existing PreferencesStore/Sidebar ledger.

Acceptance: hide and reorder, then reload the page, restart the app worker,
restart the framework, and restart the native app. Repeat on Electron, GeckoView,
Cefrium, and browser with two independent clients, two projects, changed relay
ports, delayed WBA, and unavailable extension providers. Verify no visible flash
of hidden views and no editor startup dependency on Sidebar restoration. Cover
14-day eviction and concurrent access with a controlled clock.

## 3. Cefrium pinch-to-zoom suppression

Source currently calls `setPinchToZoomEnabled(false)` on several browser creation
paths. `Te2CefriumBrowserAccess.disablePageZoom` also disables Chromium multi-touch
and double-tap support and resets zoom. Determine whether the reported zoom is
page pinch, double-tap, input autozoom, or an editor-specific gesture.

Inspect the pinned Cefrium API and lifecycle before blaming an upstream change.
Trace suppression on primary/secondary browsers, navigation, renderer recreation,
and resume. Compare Pixel and Motorola and retain the existing Monaco input font
floor used against focus autozoom. Apply the smallest evidenced correction.

Acceptance: pinch and double-tap do not zoom primary/secondary editor or app
surfaces after cold launch, resume, navigation, or renderer recreation; scrolling,
selection, and keyboard behavior remain usable. Android implementation/build work
is a subsequent scope, not part of this documentation pass.

## Execution and publication

Investigate in the order above, recording findings before implementation. Treat
Sidebar persistence as a lifecycle/state change despite its small visible UI.
Run focused tests and required frontend/type/build checks for each actual change.
For native live tests, explicitly OTA the freshly built frontend or bundle it
into the APK and verify its asset version; reload alone cannot update assets.
Synchronize versions and bundle assets when client/backend contracts require it.
Do not publish a release or merge as part of this maintenance planning pass.
