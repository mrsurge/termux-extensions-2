# Run Profile Refinements Plan

## Objective

Extend Run Profiles so remote native clients can relay auxiliary development
ports, overlapping file ownership is explicit, URL-backed running profiles have
deterministic Sidebar lifecycles, and development runtimes refresh after
relevant saves. Page Preview participates as a TE2-owned URL runtime whose
ports and refresh behavior are supplied by the backend rather than user JSON.

Complete the presentation boundary around those owned surfaces: the server
retains logical Sidebar membership and lifecycle authority, while each browser
client owns ordering, foreground selection, last-active agent routing, and
embedded/hidden/detached presentation. GeckoView remains a first-class inline
client of that shared contract. Electron additionally reconstructs owned
surfaces in detachable native windows with surface-aware tools and DevTools.

The implementation is divided into independent slices so auxiliary Vite/HMR
routing can be proven before selection, refresh, or instrumentation work is
introduced.

## Delivery Status

- Slice A is implemented, covered by Python, frontend, Rust, Electron, and
  GeckoView unit/type/build checks, and live remote Vite/HMR has been validated.
- Slice B is implemented, covered by Python and frontend tests, and live overlap
  selection has been validated.
- Slice C is implemented and covered by Python/frontend unit tests plus the
  Code TE2 TypeScript check and production bundle build. A lifecycle audit
  reopened startup stale-shell reconciliation and exact native relay release;
  live validation of URL readiness, Stop/exit teardown, and save-driven refresh
  remains pending.
- Slice D is implemented and covered by focused frontend, Electron, Gecko
  syntax/unit/APK packaging, and build checks. Live native console registration,
  reconnect, and teardown validation is pending.
- Slice E is refined and pending. It now covers shared browser/Gecko/Electron
  presentation state and mention routing before the Electron-only detached
  window and native DevTools work.

## Confirmed Current Architecture

- Python owns profile parsing, active project/file state, draft-save policy,
  run selection, and the logical Sidebar slot projection. Current Sidebar
  preferences still persist global `active_host_id` and `order`; Slice E removes
  those values from server presentation authority.
- Framework-Shells shell identity and lifecycle events own running/stopped
  state. The current projection is event-driven and must remain free of
  periodic polling.
- Rust exposes one ticketed raw-TCP tunnel per registered port and atomically
  groups primary and auxiliary routes by exact owner and shell.
- Electron and GeckoView resolve each route set as one primary-first listener
  group with rollback on auxiliary failure.
- URL-backed Run Profiles are represented by project/profile-scoped
  `RunProfileSurface` slots. The slot retains exact project, profile, and shell
  identity. Stop and live terminal events remove it, but the startup dashboard
  snapshot currently accepts retained exited shell records and can preserve a
  stale slot until its running-status filter is corrected.
- A non-Page-Preview profile creates a Sidebar URL slot only when `sidebarUrl`
  is non-empty. A process without a URL has running state but no URL surface.
- Page Preview always resolves a backend-supplied URL on port 3000. Its Vite 7
  middleware server owns HMR port 24678; it does not bind the ordinary Vite
  development-server default port 5173.
- Page Preview Framework-Shell readiness is an output marker emitted when
  Express begins listening. It does not prove that the requested document URL
  has stopped returning a transient 404.
- The generated Run Profile field contract uses the declarative `visibleWhen`
  support to hide Page Preview-inapplicable process, URL, routing,
  running-behavior, and explicit dev-runtime fields.
- The canonical active-file save path and `save_reviews` background-draft path
  publish a typed post-commit `FileSaved` event. Matching `devRuntime`
  custom/node/python surfaces refresh asynchronously; Page Preview remains
  Vite/HMR-owned.
- The relay is a byte tunnel, not an HTTP reverse proxy. Exact-origin header
  mutation lives in Gecko WebExtension and Electron session request APIs above
  the tunnel; WebSocket upgrades are excluded.
- GeckoView can inject packaged code at document start through its WebExtension.
  Electron can target a loaded subframe through `did-frame-finish-load`,
  `WebFrameMain.fromId`, and `WebFrameMain.executeJavaScript`.
- Native surface release currently clears exact-origin runtime/cache policy but
  does not close the matching Electron or Gecko relay listener group. Both
  native managers retain whole-client teardown as a fallback.
- The host frontend already has in-memory client-active ids, but server ledger
  notifications can overwrite them. Mention delivery currently broadcasts to
  the complete Sidebar IPC room rather than an exact client presentation.
- The dependency-free `ui/modal-kit` JSX runtime creates real DOM nodes in an
  arbitrary document. It has no virtual DOM, lifecycle scopes, subscriptions,
  or disposal contract yet.

## Required Invariants

- No periodic lifecycle or running-state polling. A bounded, cancellable HTTP
  readiness retry during URL-surface launch is permitted and required.
- Python remains the Run Profile orchestration authority.
- Framework-Shells remains running-state authority.
- Rust registers only declared ports for the exact profile owner and running
  shell. There is no arbitrary TCP-proxy endpoint.
- Native clients own their loopback listeners. Groups close on framework
  retarget, app teardown, route-set replacement, exact profile Stop, or dead
  shell reconciliation.
- Exact native release is keyed by stable `surfaceId` and closes only that
  surface's relay group, runtime/cache policy, console injection state, and
  Inspector registration. Whole-client `stopAll()` remains a teardown fallback.
- The primary route determines same-device behavior before auxiliary listeners
  are bound.
- Page Preview participates in owned URL-surface lifecycle. Its active route
  set and Vite/HMR refresh behavior are backend-defined and are not exposed as
  user-configurable port or `devRuntime` fields.
- Browser-only clients keep using original URLs. Native-only instrumentation is
  optional and must not become a standalone application dependency.
- The server owns logical Sidebar slot membership, lifecycle, readiness, and
  immutable surface metadata. It does not own one cross-client dock order or
  foreground selection.
- Each browser client owns dock ordering, foreground selection, last-active
  agent target, and embedded/hidden/detached presentation. Server ledger updates
  are reconciled into that local state rather than replacing it.
- GeckoView consumes the same client presentation store and exact release
  contract as the ordinary browser host. It remains inline and must preserve
  its pre-navigation marker, WebExtension console injection, native Inspector,
  cache policy, and Run Target relay behavior.
- Mention intent carries the originating client's exact stable host id and
  transient presentation id. The backend validates the target and routes to its
  registered Sidebar peer; console worker ids remain diagnostic metadata.
- Electron detachment changes only Electron presentation. Closing a detached
  window reattaches it and never stops the backend profile.
- Existing profile JSON remains valid.
- Selection UI uses the shared TE2 modal system, not browser-native dialogs.
- Profile selection is revalidated before draft writes or process launch.

## Schema

```json
{
  "profileId": "express_server",
  "port": 3000,
  "additionalPorts": [
    {
      "port": 5173,
      "label": "Vite / HMR"
    }
  ],
  "devRuntime": true
}
```

Rules:

- `additionalPorts` defaults to an empty array and is not accepted as user
  configuration for Page Preview. Page Preview receives a backend-generated
  route set for its active primary and HMR ports.
- Each entry has an integer `port` in `1..65535` and a trimmed, non-empty
  `label`.
- Ports are unique within a profile and cannot duplicate the primary `port`.
- A profile may declare at most eight auxiliary ports. This bounds native
  listeners, tickets, and UI size without constraining normal dev-server use.
- The Run Profiles modal uses a repeatable `port` plus `label` control. Its help
  text identifies Vite/HMR as the use case, with `5173` as placeholder text only.
- `devRuntime` defaults to `false`. For a URL-backed profile it is one umbrella
  for save-triggered refresh, native-client console instrumentation, and an
  exact-origin no-cache/no-store HTTP policy.
- Native Inspector `devTools` remains independent. It opts GeckoView into the
  heavier Chobitsu target runtime and is not required for the console bridge.

## Slice A: Auxiliary Port Routing

### Profile Contract

Extend profile parsing, validation, form serialization, raw JSON preservation,
and typed projections with `additionalPorts`.

### Rust Route Set

Add an atomic route-set registration operation containing the primary port and
all auxiliary ports for one exact owner/shell pair.

- Each port receives its own opaque ticket and tunnel path because a tunnel must
  resolve to exactly one TCP destination.
- Tickets are grouped by owner and shell.
- Successful registration atomically replaces the owner's old group.
- Validation failure creates no partial group.
- Release by owner/shell removes every ticket in the group.
- The existing singular route operation remains compatible by delegating to a
  one-port route set.

The projected route set contains one `primary` descriptor and an `additional`
array. Auxiliary descriptors retain their profile label for UI and errors.

### Native Resolution

Native clients resolve a route set in this order:

1. Attempt to bind the primary preferred loopback port.
2. If the primary port is already occupied, treat the profile as same-device,
   bind no auxiliary listeners, and navigate to the original primary URL.
3. If the primary bind succeeds, treat the profile as remote and bind every
   auxiliary preferred port before navigation.
4. If any auxiliary bind fails, report its label and port and roll back every
   listener created for that route set. An auxiliary collision is not a
   same-device signal.
5. Resolve the profile iframe only after the complete remote route set is live.

This ordering avoids stealing port 5173 from a same-device Vite process. Two
simultaneous remote profiles requesting the same client port produce an explicit
conflict; dynamic port rewriting is outside this slice.

## Slice B: Profile Selection And File Ownership

### Candidate Resolution

Replace singular match-or-conflict handling with backend candidate projection:

- one owning profile: retain the current click fast path;
- multiple owning profiles: return candidates and require selection;
- no owning profile: ordinary click retains Run-current-file behavior;
- forced selector: list every configured profile plus `Run current file`.

The selected profile id is sent back to Python and resolved against the current
project, active file, and current profile configuration. A forced selection may
intentionally choose a profile whose include set does not own the active file.
The selected profile's configured save policy still controls background drafts,
while the active file keeps its existing explicit save behavior.

### Play Interaction

- Click uses the one-owner fast path and opens the selector only for ambiguity.
- Touch long press and pointer context-menu always open the selector.
- Reuse the existing touch long-press cancellation and click-suppression pattern.
- Reuse `teUI.dialog` selection fields.
- Modal cancellation sends no run request.

### Running-State Projection

Slice B makes the singular state projection candidate-aware:

- each profile candidate carries its current running state;
- exact profile ids remain available to backend Run and Stop transactions;
- forced projection can inspect every configured profile rather than only
  active-file owners.

This prevents overlapping include sets from making the event-driven state
undefined. Slice C uses that foundation to separate Play choices from the
project-wide `runningProfiles` Stop view; it does not retain the combined
Run-or-Stop selector presentation.

## Slice C: Sidebar Ownership And Development Refresh

### Surface Eligibility

Create an owned surface only after a launched profile resolves a non-empty URL.
Profiles without a URL retain their event-driven running-state projection but
receive no Sidebar host id, URL-readiness task, route surface, or iframe.

Page Preview is included because it always resolves a TE2-supplied URL. It uses
the same surface identity, Sidebar ledger, Stop/exit teardown, and native route
projection as any custom URL profile.

### Separate Run And Stop Controls

Running state must not mutate the Play control into Stop. Keep Play visible and
semantically stable, then render a separate Stop control beside it whenever at
least one profile is running in the active project.

The event-driven backend projection therefore carries two independent views:

- active-file candidates for Play and ownership selection;
- `runningProfiles`, containing every configured running profile in the active
  project regardless of whether it owns the active file.

The Stop control represents the complete `runningProfiles` set:

- one running profile stops that exact profile directly;
- more than one opens a shared-modal selector containing only running profiles;
- no running profiles hides the Stop control;
- stopping remains an exact backend transaction and never becomes a direct
  frontend Framework-Shells kill.

Play remains a Run transaction. A sole active-file owner may still execute its
configured `runningBehavior` when it is already running. When Play opens a
selector because ownership overlaps, because it was right-clicked or
long-pressed, or because forced selection was requested, omit every currently
running profile from the Run choices. The forced selector retains `Run current
file`; Stop choices never appear in a Run selector. If filtering leaves no
runnable profile and no current-file override, report that no additional
matching profile is available rather than silently stopping anything.

### Owned Surface Projection

Define the lifecycle object before changing how any client renders it. The
backend-owned object is a Run Profile surface projection; an iframe is only the
current browser presentation of that object.

The implemented bounded projection is:

```ts
interface RunProfileSurfaceProjection {
  dto: "RunProfileSurface";
  version: 1;
  surfaceId: string;       // Stable project/profile identity.
  projectPath: string;
  profileId: string;
  runner: string;
  shellId: string;         // Current process generation.
  shellLabel: string;
  url: string;
  refreshRevision: number;
  devRuntime: boolean;
}
```

The surface defines runtime identity, navigation input, and refresh generation.
The owning Sidebar slot retains its deterministic host id, route set, and
Inspector metadata beside the surface. It does not attempt to serialize the
document heap, browsing history, scroll position, or arbitrary iframe DOM state.
A client can destroy and reconstruct a presentation from this state without
becoming Run Profile lifecycle authority.

Python and the Sidebar ledger own projection creation, replacement, and
removal. Each client owns only presentation state such as embedded, hidden, or
detached. Presentation state is client-local and must not be mirrored across
other browser, GeckoView, or Electron clients. `surfaceId` remains stable across
presentation changes; `shellId` and route tickets change when the process is
relaunched.

### Page Preview Implied Runtime Contract

Page Preview does not serialize manual routing or generic process settings into
project JSON. The backend supplies its active route set from the implementation
it launches:

- primary Page Preview HTTP: `3000`;
- Vite middleware HMR: `24678`.

Port 5173 is not reserved because the current middleware server does not bind
it. If the backend later changes Vite modes, the backend-owned port declaration
changes with that implementation without exposing a migration burden to users.

Use the existing declarative `visibleWhen` contract to hide Page Preview fields
that its backend ignores: `exec`, `args`, `cwd`, `env`, `sidebarUrl`, `port`,
`additionalPorts`, `runningBehavior`, and explicit `devRuntime`. Keep profile
identity, `runner`, `entry`, `include`, draft-save policy/warning, and applicable
instrumentation controls visible. Preserve hidden keys in raw JSON so runner
changes remain reversible, but normalize Page Preview before parsing or
validating those keys so stale values cannot affect runtime behavior.

### Slot Ownership

Use a deterministic project-scoped Run Profile Sidebar slot id rather than
`runner-profile:<profileId>` alone. Store the surface projection on that exact
slot rather than scattering ownership fields across frontend-only maps.

- project identity;
- profile id;
- shell identity;
- route-set identity;
- original URL;
- `devRuntime` state;
- refresh revision.

Stop success and Framework-Shells terminal lifecycle events close the exact
owned slot through the existing Sidebar state ledger. Ledger removal tears down
the iframe on every client without a frontend-only ownership map.

Every owned Run Profile URL surface adds `Stop run profile` to its Sidebar dock
icon context menu, reached through desktop right-click or the existing mobile
long-press path. This applies to Page Preview and custom/node/python profiles
with a URL surface. The action sends the surface's project/profile/shell
identity through the host UI IPC backend Stop path; it does not infer ownership
from the currently active editor file and does not terminate Framework-Shells
directly. Successful Stop then removes the exact surface through the same
backend lifecycle transaction.

### Initial URL Readiness

After the shell reaches Framework-Shell readiness, but before the URL surface
is created or activated, Python runs one bounded asynchronous HTTP readiness
retry against the resolved URL.

- Connection failures and HTTP 404 retry with bounded backoff.
- Any non-404 HTTP response proves that the configured route is being served;
  the probe reads no response body.
- Stop, relaunch, project switch, or shell-generation replacement cancels the
  pending probe.
- Success or timeout permanently ends that launch's probe. No periodic health
  polling is introduced.
- A newly launched shell that never becomes URL-ready is stopped and its route
  set is released. A reused shell is left running but receives no new surface.

The same rule applies to Page Preview and custom/node/python URL profiles. A
profile without a URL bypasses this work entirely.

Startup stale-shell reconciliation must treat only running Framework-Shell
records as live. Retained exited records in `fws.dashboard.open` are historical
state and must close, not preserve, a matching Run Profile surface and route.

### Post-Commit Save Event

Introduce a typed `FileSaved` worker event after a successful disk commit. Both
the canonical active-file save service and `save_reviews` background draft
saves publish it with project/path/source metadata.

- Publication happens after the write and draft metadata update.
- Refresh fanout is scheduled outside the save response path.
- `DraftStateChanged` remains decoration state and is not overloaded as a save
  signal.

### Dev Runtime Refresh

For each saved path, Python finds every running custom/node/python
`devRuntime` profile whose include rules own that path and advances the exact
surface projection's refresh revision.

- Overlapping running profiles refresh independently.
- A loaded iframe navigates with an incremented cache-busting revision.
- A hidden/unloaded slot stores the new revision and loads fresh on activation.
- Relay groups and Inspector target identity remain associated with the same
  slot and are reconciled rather than leaked.
- Page Preview is an implicit development runtime, but Vite owns its save watch,
  cache invalidation, HMR, and full reload behavior through the backend-generated
  route set. Do not add a second hard-refresh transaction for each Page Preview
  save.

## Slice D: Native Dev Runtime Instrumentation

`devRuntime: true` opts a native Run Profile iframe into the TE2 console bridge
and an exact-origin no-cache/no-store HTTP policy. This is the native-client
part of the same option that owns save-triggered refresh; it is not a second
schema switch. Native Inspector `devTools` remains independent.

The injection target is resolved from the owned surface projection. The current
iframe is not treated as durable identity.

### Worker Identity

Keep the full surface-aware value as the stable worker label, but use a compact
selector id:

```text
rp-<profile4>-<injector4>-<owner4>
```

The profile segment is its first four normalized alphanumeric characters, with
`prof` as the fallback. Native injectors use `gkvw` and `elct`; the final four
characters are a base62 owner stored per page/window in session storage. This
keeps selectors concise without discarding the full label used for diagnostics.

### GeckoView

Generalize the existing Run Profile document-start marker. The WebExtension
injects the packaged Socket.IO client and console bridge into the marked top
frame and provides the configured framework console origin explicitly.

`run_target_release(surfaceId)` must cross the WebExtension native port into
Kotlin. Kotlin owns a `surfaceId -> relayGroupId` association and closes only
that group's listeners and streams. Framework retarget, return to the launcher,
Activity destruction, and native connection failure retain whole-client
`stopAll()` cleanup.

### Electron

Listen for marked subframe completion, resolve the exact `WebFrameMain` from the
event's process/routing ids, verify the frame URL and marker, then inject the
same packaged bridge with `executeJavaScript`.

Electron main owns the equivalent `surfaceId -> relayGroupId` association.
`release_run_target_surface` clears both `ElectronRunProfileRuntime` policy and
the exact listener group. App-view loss, framework retarget, and application
shutdown retain whole-client cleanup.

### Browser Boundary

Ordinary browser pages cannot receive this injection across origins without app
cooperation or an HTTP-aware proxy. They continue to run normally without the
bridge. This is instrumentation, not a product runtime dependency.

## Slice E: Shared Client Presentation, Gecko Parity, And Electron Detachment

### Shared Presentation Authority

The server ledger remains authoritative for the set of logical Sidebar slots.
It creates, replaces, and removes owned surfaces and projects readiness and
runtime metadata. Actual iframes and native windows are client presentations,
so literal iframe count is derived by the client rather than persisted by the
server.

Each host client maintains a versioned presentation store containing:

```ts
interface SidebarClientPresentationState {
  version: 1;
  order: string[];                 // Stable Sidebar host ids.
  foregroundHostId: string;
  lastAgentHostId: string;
  lastAgentPresentationId: string;
  presentations: Record<string, "embedded" | "hidden" | "detached">;
}
```

On every server ledger update the client:

1. removes local ids absent from the authoritative slot set;
2. preserves the local order of surviving ids;
3. appends newly created server slots deterministically;
4. preserves the local foreground surface when it still exists; and
5. selects a local neighboring/MRU fallback when that surface disappears.

The server no longer persists or broadcasts one authoritative `active_host_id`
or dock `order`. A client may publish bounded focus metadata when another
backend action requires it, but that notification does not become cross-client
presentation authority.

Browser and Gecko hosts persist this versioned state in origin-local storage.
Electron's framework relay binds a new random loopback port per process, so
framework-page `localStorage` is reliable only within that Electron session.
Cross-launch Electron state uses a small validated preload/main-backed store
under the existing desktop configuration boundary.

### Exact Mention Routing

Mention actions include the originating client's current `lastAgentHostId` and
`lastAgentPresentationId`. The backend validates that the stable host still
exists, that the presentation registered for the same client, and that the peer
has the required agent capability. It then routes to that exact Sidebar peer
instead of broadcasting to every `sidebar_ipc` connection.

The stable host id is lifecycle identity. Presentation and console worker ids
are transient instance/diagnostic identities and are refreshed when an iframe
is reconstructed or detached.

### Shared Component Runtime

Extract the generic TSX-to-DOM primitives from `ui/modal-kit` into a reusable
component core while keeping modal-kit compatibility. Add only the mechanisms
needed by long-lived Sidebar and detached-window chrome:

- an explicit owner/disposal scope;
- event/subscription cleanup;
- document/window-aware rendering;
- small controller-driven state updates; and
- refs for iframe and native-bridge integration.

Do not introduce a virtual DOM or make the component runtime lifecycle
authority. Backend surface projections and the client presentation controller
remain the state sources.

### GeckoView Compatibility

GeckoView remains an inline Sidebar renderer and does not expose Electron-style
detachment. It still consumes the shared ordering, foreground, reconciliation,
and mention-target store because that logic runs in the common Code TE2 host.

Iframe creation and reconstruction must continue to set the complete
pre-navigation `window.name` marker before assigning the final URL. Existing
WebExtension injection, compact console-worker identity, Inspector target
registration, exact-origin cache policy, route resolution, and auxiliary-port
behavior remain unchanged. Ledger removal additionally sends exact surface
release through the WebExtension/Kotlin bridge before discarding the iframe.

### Electron Detachment And Surface Tools

Electron consumes the same backend-owned surface projection and shared client
store. Electron main maintains a registry from stable `surfaceId` to the current
presentation and transient native identifiers.

```text
surfaceId
    -> embedded iframe or detached presentation
    -> BrowserWindow / WebContentsView / frame identifiers
    -> relay group, runtime policy, console worker, and DevTools target
```

The first implementation reconstructs the URL in a dedicated trusted window
shell. It applies the complete iframe marker and immutable surface metadata
before navigation, waits until the detached presentation is ready, then removes
the embedded presentation. A later implementation may create every surface as
a `WebContentsView` so the same browsing context can be reparented without a
reload. Neither mechanism changes backend ownership.

- Detach/reattach changes only the requesting Electron client's presentation.
- Closing a detached window returns the surface to its embedded presentation;
  it does not stop the profile.
- Profile Stop, shell exit, project teardown, backend removal, app-view loss,
  or framework retarget closes every Electron presentation for that surface.
- Route-set resolution remains Electron-main-owned and is reused by either
  presentation.
- The detached trusted shell renders TSX/HTML chrome containing surface label,
  profile/project identity, attach/close, refresh, exact backend Stop, console,
  and DevTools actions. These controls invoke existing backend/native ownership
  paths rather than terminating Framework-Shells directly.
- A dedicated `webContents` can use Electron's built-in DevTools directly.
- Console instrumentation and DevTools target the registry's current
  presentation rather than retaining stale iframe/frame ids.

## Cache Policy

The Rust and native run-target relays remain transport-only. Native browser
engines apply the HTTP policy above that byte tunnel for every exact origin in
the owned profile route set.

- GeckoView uses its Run Target WebExtension `webRequest` listeners.
- Electron uses the app partition's `session.webRequest` listeners.
- Matching requests receive `Cache-Control: no-cache` and `Pragma: no-cache`.
- Matching responses receive `Cache-Control: no-store, no-cache,
  must-revalidate`, `Pragma: no-cache`, and `Expires: 0`.
- WebSocket requests are excluded, so Vite/HMR upgrades remain untouched.
- Direct same-device URLs and unrouted dev-runtime surfaces register their exact
  origin through the native bridge before iframe navigation.
- Surface removal, framework retarget, and native teardown release the policy.
- Policy release and native relay release are separate obligations. Exact
  surface removal closes both; whole-client teardown closes every remaining
  listener and policy registration.
- Ordinary browsers retain profile-owned revision reloads but cannot receive
  cross-origin header mutation or bridge injection without app cooperation.
- Initial surface creation still waits for the bounded URL-readiness result so
  the first navigation does not race a transient 404.

## Validation

### Python

- Profile parsing, defaulting, invalid/duplicate/excess ports, and raw JSON
  round trips.
- Candidate enumeration, explicit selection, stale selection rejection, and
  multiple running candidates.
- Project-scoped slot identity, terminal cleanup, typed save events, overlap
  fanout, hidden-slot refresh revisions, URL-only surface eligibility, and
  bounded readiness cancellation.
- Startup dashboard reconciliation excludes retained exited shells and closes
  their stale surfaces/routes.
- Mention requests reject missing, stale, cross-client, or non-agent
  presentation targets and deliver valid requests to one exact registered peer.
- Page Preview backend-generated primary/HMR routes and rejection of manual
  Page Preview port fields.

### Rust

- Atomic route-set registration, singular compatibility, owner/shell isolation,
  replacement, release, duplicate rejection, ticket validation, and no partial
  registration.

### Electron And GeckoView

- Primary-first same-device fallback.
- Complete remote group binding and rollback on auxiliary collision.
- Exact surface-to-group teardown on profile Stop, backend surface removal, and
  dead-shell reconciliation without closing another profile's listeners.
- Whole-client group teardown on retarget, launcher/app-view return, renderer or
  Activity loss, and app shutdown.
- Marked-frame console injection, unique worker registration, reconnect, and
  teardown.
- Gecko iframe reconstruction preserves the pre-navigation marker, Inspector
  target, console worker, cache policy, and route behavior.
- Electron surface reconstruction, detach/reattach, surface-aware chrome,
  built-in DevTools targeting, and backend-removal cleanup without changing
  another client's presentation.

### Frontend

- Repeatable auxiliary-port form controls.
- Profile selector fast/ambiguous/forced/no-owner paths.
- Long-press/context-menu click suppression.
- Candidate-aware Run/Stop state.
- Stable Play plus a separate aggregate Stop control.
- Run selectors exclude running profiles; Stop selectors contain only running
  profiles.
- Owned Run Profile dock menus stop their exact backend profile on right-click
  or touch long press.
- Exact slot cleanup and dev-runtime reload without duplicate requests.
- Runner-dependent field visibility and no slot creation for URL-less profiles.
- Two clients can retain different dock orders and foreground surfaces while
  consuming the same authoritative server slot set.
- Ledger reconciliation removes missing ids, preserves surviving local order,
  appends new slots, and chooses a local fallback foreground surface.
- Mentions use the initiating client's last active agent presentation and never
  fan out to unrelated Sidebar peers.
- Browser and Gecko presentation state survives reload through versioned
  origin-local storage; Electron uses its stable client-state bridge when
  cross-launch persistence is required.

### Live Acceptance

The Express plus Vite profile has proven primary HTTP, auxiliary HTTP/WebSocket
routing, and HMR through a remote native client. Subsequent slices must prove:

1. Stop closes the shell, relay group, and owned Sidebar surface.
2. A saved included file refreshes a running `devRuntime` surface.
3. Overlapping profiles require explicit selection and refresh independently.
4. Page Preview automatically relays primary HTTP and middleware HMR, waits for
   URL readiness, and tears down its owned surface on Stop.
5. Play remains available while profiles run; the adjacent Stop control and
   dock-menu Stop action target only explicitly selected running profiles.
6. Opt-in console workers appear with profile-aware unique identities.
7. Gecko preserves inline frame, console, Inspector, cache, and relay behavior
   while client-local ordering and targeted mentions change.
8. Exact surface removal closes only the matching Electron or Gecko listener
   group, including after a Code TE2 worker restart observes an exited shell.
9. Electron can reconstruct, detach, reattach, inspect, and remove an owned
   surface without altering another client's presentation.

## Delivery Order

1. Slice A: auxiliary route sets and Vite/HMR proof.
2. Slice B: profile selection and candidate-aware state.
3. Slice C: owned Sidebar lifecycle and dev-runtime refresh. Implemented;
   live acceptance pending.
4. Slice D: native console instrumentation.
5. Slice E prerequisite: correct startup stale-shell reconciliation and exact
   Electron/Gecko surface-to-relay teardown.
6. Slice E shared client presentation: local ordering/foreground state, exact
   mention routing, ledger reconciliation, and the reusable TSX component core.
7. Slice E Gecko parity: preserve inline marker/instrumentation/Inspector/relay
   behavior under the shared presentation state.
8. Slice E Electron presentation: detachable surface windows, surface-aware
   tools, reattach behavior, and built-in DevTools.
9. Update the main Code TE2 contract and repo memory after each validated
   architectural slice.
