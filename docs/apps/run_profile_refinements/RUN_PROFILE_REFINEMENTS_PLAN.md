# Run Profile Refinements Plan

## Objective

Extend Run Profiles so remote native clients can relay auxiliary development
ports, overlapping file ownership is explicit, running profile Sidebar surfaces
have deterministic lifecycles, and opt-in development runtimes refresh after
relevant saves.

The implementation is divided into independent slices so auxiliary Vite/HMR
routing can be proven before selection, refresh, or instrumentation work is
introduced.

## Delivery Status

- Slice A is implemented, covered by Python, frontend, Rust, Electron, and
  GeckoView unit/type/build checks, and live remote Vite/HMR has been validated.
- Slices B through E remain deferred. In particular, exact profile-stop Sidebar
  slot closure and native listener teardown are Slice C lifecycle work, not an
  implied part of Slice A.

## Confirmed Current Architecture

- Python owns profile parsing, active project/file state, draft-save policy,
  run selection, and Sidebar state projection.
- Framework-Shells shell identity and lifecycle events own running/stopped
  state. The current projection is event-driven and must remain free of polling.
- Rust exposes one ticketed raw-TCP tunnel per registered port. The registry
  currently replaces the previous route for an owner, so repeated registration
  cannot implement auxiliary ports safely.
- Electron and GeckoView can already hold multiple loopback listeners, but they
  resolve one route descriptor at a time and do not group listeners by profile.
- Run Profile Sidebar slots are named only by profile id. They are not
  project-scoped, carry insufficient owner metadata, and are not closed when a
  run stops.
- The active-file save path uses the canonical save service. Background draft
  saves performed before Run use `save_reviews` and only emit a coarse draft
  state change. There is no typed post-commit file-save event shared by both
  paths.
- The relay is a byte tunnel, not an HTTP reverse proxy. HTTP response-header
  rewriting there would duplicate a complete HTTP parser across Rust, Electron,
  and Kotlin and would endanger WebSocket upgrades.
- GeckoView can inject packaged code at document start through its WebExtension.
  Electron can target a loaded subframe through `did-frame-finish-load`,
  `WebFrameMain.fromId`, and `WebFrameMain.executeJavaScript`.

## Required Invariants

- No polling.
- Python remains the Run Profile orchestration authority.
- Framework-Shells remains running-state authority.
- Rust registers only declared ports for the exact profile owner and running
  shell. There is no arbitrary TCP-proxy endpoint.
- Native clients own their loopback listeners. Slice A closes groups on
  framework retarget, app teardown, or route-set replacement; Slice C adds the
  exact profile-stop lifecycle signal and Sidebar-slot closure.
- The primary route determines same-device behavior before auxiliary listeners
  are bound.
- Page Preview remains outside auxiliary-port and dev-runtime behavior.
- Browser-only clients keep using original URLs. Native-only instrumentation is
  optional and must not become a standalone application dependency.
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
  "devRuntime": true,
  "consoleBridge": true
}
```

Rules:

- `additionalPorts` defaults to an empty array and is not accepted for Page
  Preview.
- Each entry has an integer `port` in `1..65535` and a trimmed, non-empty
  `label`.
- Ports are unique within a profile and cannot duplicate the primary `port`.
- A profile may declare at most eight auxiliary ports. This bounds native
  listeners, tickets, and UI size without constraining normal dev-server use.
- The Run Profiles modal uses a repeatable `port` plus `label` control. Its help
  text identifies Vite/HMR as the use case, with `5173` as placeholder text only.
- `devRuntime` defaults to `false`.
- `consoleBridge` defaults to `false` and is independent of native Inspector
  `devTools`.

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

The current singular state projection must become candidate-aware:

- each profile candidate carries its current running state;
- one relevant running profile can retain the direct Stop affordance;
- multiple relevant running profiles open the selector so the user chooses what
  to stop;
- the forced selector shows running state for every configured profile.

This prevents overlapping include sets from making the event-driven Run button
state undefined.

## Slice C: Sidebar Ownership And Development Refresh

### Owned Surface Projection

Define the lifecycle object before changing how any client renders it. The
backend-owned object is a Run Profile surface projection; an iframe is only the
current browser presentation of that object.

The proposed bounded projection is:

```ts
interface RunProfileSurfaceProjection {
  dto: "RunProfileSurface";
  version: 1;
  surfaceId: string;       // Stable project/profile identity.
  projectId: string;
  profileId: string;
  shellId: string;         // Current process generation.
  hostId: string;          // Exact Sidebar ledger slot.
  originalUrl: string;
  runTargetRouteSet?: RunTargetRouteSet;
  refreshRevision: number;
  devRuntime: boolean;
  devTools: boolean;
  consoleBridge: boolean;
}
```

The projection defines runtime identity, navigation input, routing,
instrumentation flags, and refresh generation. It does not attempt to serialize
the document heap, browsing history, scroll position, or arbitrary iframe DOM
state. A client can destroy and reconstruct a presentation from this object
without becoming Run Profile lifecycle authority.

Python and the Sidebar ledger own projection creation, replacement, and
removal. Each client owns only presentation state such as embedded, hidden, or
detached. Presentation state is client-local and must not be mirrored across
other browser, GeckoView, or Electron clients. `surfaceId` remains stable across
presentation changes; `shellId` and route tickets change when the process is
relaunched.

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

### Post-Commit Save Event

Introduce a typed `FileSaved` worker event after a successful disk commit. Both
the canonical active-file save service and `save_reviews` background draft
saves publish it with project/path/source metadata.

- Publication happens after the write and draft metadata update.
- Refresh fanout is scheduled outside the save response path.
- `DraftStateChanged` remains decoration state and is not overloaded as a save
  signal.

### Dev Runtime Refresh

For each saved path, Python finds every running `devRuntime` profile whose
include rules own that path and advances the exact surface projection's refresh
revision.

- Overlapping running profiles refresh independently.
- A loaded iframe navigates with an incremented cache-busting revision.
- A hidden/unloaded slot stores the new revision and loads fresh on activation.
- Relay groups and Inspector target identity remain associated with the same
  slot and are reconciled rather than leaked.
- Page Preview is excluded.

## Slice D: Console Instrumentation

`consoleBridge: true` opts a native Run Profile iframe into the TE2 console
bridge independently of native Inspector `devTools`.

The injection target is resolved from the owned surface projection. The current
iframe is not treated as durable identity.

### Worker Identity

Use a stable label such as:

```text
run-profile:<project-hash>:<profile-id>
```

and initialize the bridge with `uniquePerWindow: true` so each client/window
gets a distinct suffix.

### GeckoView

Generalize the existing Run Profile document-start marker. The WebExtension
injects the packaged Socket.IO client and console bridge into the marked top
frame and provides the configured framework console origin explicitly.

### Electron

Listen for marked subframe completion, resolve the exact `WebFrameMain` from the
event's process/routing ids, verify the frame URL and marker, then inject the
same packaged bridge with `executeJavaScript`.

### Browser Boundary

Ordinary browser pages cannot receive this injection across origins without app
cooperation or an HTTP-aware proxy. They continue to run normally without the
bridge. This is instrumentation, not a product runtime dependency.

## Slice E: Electron Surface Presentation And Native DevTools

Electron consumes the same backend-owned surface projection as the browser
Sidebar. It maintains a client-local registry from stable `surfaceId` to the
current Electron presentation and transient native identifiers.

```text
surfaceId
    -> embedded iframe or native view
    -> detached BrowserWindow/WebContentsView
    -> current webContents/frame identifiers
```

The first implementation may reconstruct the URL in a dedicated window. A
later native-view implementation may use `WebContentsView` from creation so the
same browsing context can be reparented without reload. Neither mechanism moves
a DOM iframe between renderer processes, and neither changes backend ownership.

- Detach/reattach changes only the requesting Electron client's presentation.
- Closing a detached window returns the surface to its embedded presentation;
  it does not stop the profile.
- Profile Stop, shell exit, project teardown, or backend surface removal closes
  every Electron presentation for that `surfaceId`.
- Route-set resolution remains Electron-main-owned and is reused by either
  presentation.
- A dedicated `webContents` can use Electron's built-in DevTools directly.
  The current common `devTools` marker is projected into Electron, but Electron
  does not presently inject Chobitsu, register a target, or display DevTools.
- Console instrumentation and native DevTools address the current presentation
  through the surface registry rather than retaining stale iframe/frame ids.

## Cache Policy

The initial implementation does not rewrite HTTP headers. The Rust and native
relays remain transport-only.

- New profile launches and explicit dev-runtime refreshes append a profile-owned
  revision nonce to the iframe document URL.
- This reliably refreshes document navigation without parsing HTTP streams or
  interfering with WebSocket upgrades.
- Subresources still follow the target server's cache headers.
- A true `Cache-Control: no-store` policy requires a future shared HTTP-aware L7
  proxy and is explicitly deferred.

## Validation

### Python

- Profile parsing, defaulting, invalid/duplicate/excess ports, and raw JSON
  round trips.
- Candidate enumeration, explicit selection, stale selection rejection, and
  multiple running candidates.
- Project-scoped slot identity, terminal cleanup, typed save events, overlap
  fanout, and hidden-slot refresh revisions.

### Rust

- Atomic route-set registration, singular compatibility, owner/shell isolation,
  replacement, release, duplicate rejection, ticket validation, and no partial
  registration.

### Electron And GeckoView

- Primary-first same-device fallback.
- Complete remote group binding and rollback on auxiliary collision.
- Group teardown on profile stop, retarget, and app shutdown.
- Marked-frame console injection, unique worker registration, reconnect, and
  teardown.
- Electron surface reconstruction, detach/reattach, built-in DevTools targeting,
  and backend-removal cleanup without changing another client's presentation.

### Frontend

- Repeatable auxiliary-port form controls.
- Profile selector fast/ambiguous/forced/no-owner paths.
- Long-press/context-menu click suppression.
- Candidate-aware Run/Stop state.
- Exact slot cleanup and dev-runtime reload without duplicate requests.

### Live Acceptance

The Express plus Vite profile has proven primary HTTP, auxiliary HTTP/WebSocket
routing, and HMR through a remote native client. Subsequent slices must prove:

1. Stop closes the shell, relay group, and owned Sidebar surface.
2. A saved included file refreshes a running `devRuntime` surface.
3. Overlapping profiles require explicit selection and refresh independently.
4. Opt-in console workers appear with profile-aware unique identities.
5. Electron can reconstruct, detach, reattach, inspect, and remove an owned
   surface without altering another client's presentation.

## Delivery Order

1. Slice A: auxiliary route sets and Vite/HMR proof.
2. Slice B: profile selection and candidate-aware state.
3. Slice C: owned Sidebar lifecycle and dev-runtime refresh.
4. Slice D: native console instrumentation.
5. Slice E: Electron surface presentation and built-in DevTools.
6. Update the main Code TE2 contract and repo memory after each validated
   architectural slice.
