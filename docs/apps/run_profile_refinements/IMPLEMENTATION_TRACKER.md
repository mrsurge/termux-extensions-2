# Run Profile Refinements Implementation Tracker

## Status

- Phase: Slices A-C and native dev-runtime instrumentation unit/build validated; live native acceptance pending
- Implementation approval: granted through native dev-runtime instrumentation
- Baseline checkpoint: `0aef632a`
- Target branch: `main`

## Scope Ledger

| Area | Status | Evidence / Decision |
|---|---|---|
| Existing profile schema and form ownership | Investigated | `RunProfile` and generated modal contract own schema/form behavior; current contract is singular-port. |
| Auxiliary port contract | Implemented | Atomic owner/shell route set, one opaque ticket per port, maximum eight auxiliaries. |
| Express plus Vite reproduction | Live validated by user | Primary page, auxiliary routing, and Vite HMR work remotely. Middleware runtimes may require every reported auxiliary port, including 5173 or 24678. |
| Multiple profile include ownership | Implemented | The backend projects every owner with running state; overlap is a selection action rather than a launch error. |
| Profile selector modal | Implemented | Shared `teUI.dialog` select field; no native browser dialog. |
| Long press / context-menu Play action | Implemented | Touch timer, movement cancellation, and post-long-press click suppression are isolated on Play. |
| Run-current-file override | Implemented | Ordinary no-owner click stays fast; forced selector can explicitly bypass profiles. |
| Run Profile surface ownership | Implemented | Python owns one project/profile `RunProfileSurface`; the Sidebar iframe is a reconstructable presentation rather than lifecycle authority. |
| Surface eligibility | Implemented | Only profiles with a resolved URL receive a surface/slot/readiness transaction. URL-less profiles retain process state only. |
| Sidebar iframe ownership | Implemented | Project-scoped host ids retain owner/shell metadata; Stop, terminal lifecycle, and stale-shell reconciliation remove the exact slot. |
| `devRuntime` save refresh | Implemented | Canonical and bulk save paths publish typed post-commit `FileSaved`; matching custom/node/python surfaces advance refresh revision off the save path. |
| Page Preview ownership | Implemented | Page Preview participates with backend-generated surface/routing behavior rather than user-configured runtime ports. |
| Page Preview active ports | Implemented | Express owns primary port 3000; Vite 7 middleware HMR owns 24678. Port 5173 is not bound or reserved. |
| Initial URL readiness | Implemented | One bounded, cancellable launch-time HTTP retry prevents transient 404 navigation; it is not periodic lifecycle polling. |
| Page Preview form visibility | Implemented | Canonical `visibleWhen.field` rules hide generic process, URL, route, running-behavior, and explicit dev-runtime controls; live runner changes update visibility immediately. |
| Page Preview stale raw keys | Implemented | Hidden keys remain round-trippable, but Page Preview normalizes backend-owned runtime values before parsing or validating incompatible keys. |
| Stable Play control | Implemented | Running state no longer mutates Play into Stop; a separate adjacent Stop control represents all running profiles in the active project. |
| Run/Stop selector separation | Implemented | Run selectors omit running profiles; the Stop selector contains running profiles only and appears only when more than one is running. |
| Dock Stop action | Implemented | Every owned Run Profile URL surface adds exact backend Stop to its existing right-click/touch-long-press dock menu. |
| Profile route cache policy | Implemented | Raw TCP stays transport-only; Gecko `webRequest` and Electron `session.webRequest` apply exact-origin no-cache/no-store policy while excluding WebSocket upgrades. |
| `devRuntime` console bridge | Implemented | The existing option injects the explicit-framework-origin bridge into marked Gecko frames at document start and exact Electron subframes after load. No second schema flag exists. |
| Electron detached presentation | Planned | Common `devTools` metadata reaches Electron, but no Electron consumer/injection/display exists. A client-local surface registry will support reconstruction, detach/reattach, and built-in DevTools. |
| Contract/docs/repo memory | Complete | Plan/tracker, Code TE2 contract, and KB-backed repo memory describe Slice C and the native `devRuntime` boundary. |

## Invariants Checklist

- [x] No periodic lifecycle or running-state polling in the design.
- [x] Bounded launch-time HTTP readiness retries are explicitly permitted.
- [x] Python remains profile orchestration authority.
- [x] Framework-Shells remains running-state authority.
- [x] Rust routes remain exact-owner, exact-shell, declared-port only.
- [x] Native listeners are grouped by profile route set and cleaned on replacement, retarget, and native teardown.
- [x] Exact profile-stop listener and Sidebar-slot cleanup is implemented.
- [x] Standalone/browser behavior does not depend on native instrumentation.
- [x] Existing Run Profile JSON remains backward compatible.
- [x] Page Preview uses backend-generated active ports and implicit Vite/HMR
  behavior; manual port and `devRuntime` fields remain inapplicable.
- [x] Draft-save confirmation and stale-selection protections are preserved.
- [x] Modal/long-press cancellation cannot duplicate run requests.
- [x] Backend surface identity is separate from iframe, frame, webContents, and window identity.
- [x] Embedded/hidden/detached presentation state remains client-local.
- [x] Play and Stop are separate intents and never share one selector action.
- [x] Dock Stop routes through Python orchestration rather than killing a shell
  from the frontend.

## Investigation Log

| Item | Status | Finding |
|---|---|---|
| Test profile and Vite reference | Complete | Express serves transformed Vite middleware output on 8000; Vite HMR still targets unrelayed 5173. |
| Schema parser and UI form | Complete | Parser, generated form contract, and modal serialization have only scalar `port`; a repeatable object control is needed. |
| Run candidate resolution | Complete | Candidate enumeration is canonical; exact profile ids can intentionally select a non-owner, while ordinary Run retains owner matching. |
| Rust route registry | Complete | Registry deliberately replaces the prior route for one owner; raw tunnel maps one ticket to one port. |
| Electron relay grouping | Complete | Manager can hold multiple listeners but resolves descriptors independently; no profile group or partial rollback exists. |
| GeckoView relay grouping | Complete | Kotlin relay also holds multiple entries but resolves one descriptor at a time; no route-set lifecycle exists. |
| Sidebar slot lifecycle | Complete | Exact host-id close exists and frontend ledger removal tears down the iframe; Run stop/terminal events do not call it. |
| URL surface eligibility | Complete | Non-preview launch opens a slot only for non-empty `sidebarUrl`; Page Preview always synthesizes its URL. |
| Page Preview Vite ports | Complete | Current middleware implementation binds primary HTTP on 3000 and a separate HMR WebSocket server on 24678; it does not bind 5173. |
| Shell versus URL readiness | Complete | Both shellspecs use output markers. Page Preview emits its marker from the Express listen callback, which proves listening but not a non-404 document route. |
| Declarative field visibility | Complete | Frontend form runtime supports `visibleWhen`; the Python-generated Run Profile contract now emits Page Preview-specific visibility rules. |
| Toolbar Run/Stop behavior | Complete | Play remains stable and the adjacent Stop control represents the project-wide `runningProfiles` projection. |
| Selector behavior | Complete | Run and Stop use separate intent-filtered candidate sets and shared-modal flows. |
| Dock context menu | Complete | Dock icons already expose right-click and touch-long-press menus; owned surface metadata can add an exact backend Stop action. |
| Global running projection | Complete | `runningProfiles` includes every configured running profile independently of the active-file candidates. |
| Save completion event | Complete | Active save and `save_reviews` both publish typed post-commit `FileSaved` without extending their response path. |
| Cache-control mutation boundary | Complete | The relay remains raw TCP; native browser request APIs mutate headers only for exact owned origins and skip WebSockets. |
| Console bridge injection boundary | Complete | Gecko WebExtension and Electron `WebFrameMain` support native exact-frame injection; ordinary browsers remain uninjected. |
| Electron DevTools boundary | Complete | The shared iframe marker is present in Electron, but current Electron source has no marker consumer, Chobitsu injection, target registry, or DevTools display call. |

## Implementation Slices

### Slice A: Auxiliary Ports

- [x] Add `additionalPorts` parser, validation, form controls, and tests.
- [x] Add atomic Rust route-set registration and grouped release.
- [x] Project primary and auxiliary route descriptors through Sidebar metadata.
- [x] Add Electron grouped resolution and rollback.
- [x] Add GeckoView grouped resolution and rollback.
- [x] Prove Vite HMR through declared auxiliary ports.

### Slice B: Profile Selection

- [x] Project all owning candidates and their running state.
- [x] Add explicit profile id to run/stop intent.
- [x] Add shared-file selector modal.
- [x] Add Play long press/context-menu selector.
- [x] Add forced no-owner `Run current file` path.
- [x] Revalidate project/file/profile before draft saves and launch.

### Slice C: Owned Sidebar Lifecycle And Dev Runtime

- [x] Create a surface only for a profile with a resolved URL.
- [x] Define and project the bounded `RunProfileSurface` contract.
- [x] Keep stable `surfaceId` separate from shell generation and client presentation ids.
- [x] Make Run Profile host ids project-scoped and persist owner metadata.
- [x] Close the exact slot on Stop and terminal shell lifecycle.
- [x] Include Page Preview in owned surface creation and exact teardown.
- [x] Generate Page Preview routes internally for primary 3000 and HMR 24678.
- [x] Hide Page Preview-inapplicable form fields with `visibleWhen`.
- [x] Add one bounded, cancellable initial HTTP-readiness retry for every URL surface.
- [x] Retry connection failures/404 only and create the slot after readiness succeeds.
- [x] Add all-project `runningProfiles` to the event-driven state projection.
- [x] Keep Play stable and add an adjacent Stop control while `runningProfiles` is non-empty.
- [x] Stop the sole running profile directly; select from running-only choices when multiple run.
- [x] Filter running profiles out of ambiguous/forced Run selectors.
- [x] Add exact backend Stop to owned surface dock context menus.
- [x] Make dock Stop use project/profile/shell surface identity rather than the active file.
- [x] Add `devRuntime` schema/form support.
- [x] Publish typed `FileSaved` from active and bulk save paths.
- [x] Match successful saves against running profile include sets off the save path.
- [x] Reload each matching slot with an incremented refresh revision.
- [x] Keep Page Preview save refresh Vite/HMR-owned rather than duplicating hard reloads.
- [x] Preserve relay and Inspector identities without leaks.

### Slice D: Native Dev Runtime Instrumentation

- [x] Keep console instrumentation under the existing `devRuntime` schema/form option.
- [x] Package explicit-origin bridge bootstrap for foreign pages.
- [x] Add profile-aware unique worker labels.
- [x] Inject marked GeckoView frames at document start.
- [x] Inject exact marked Electron subframes after load.
- [x] Apply exact-origin request/response cache policy without touching WebSockets.
- [x] Release native runtime policy with surface removal and framework retarget.
- [ ] Live-validate registration, reconnect, background, and teardown.

### Slice E: Electron Surface Presentation And Native DevTools

- [ ] Add an Electron-main registry keyed by stable `surfaceId`.
- [ ] Reconstruct an owned surface in a dedicated native window/view.
- [ ] Implement client-local detach and reattach without changing backend lifecycle.
- [ ] Reuse the resolved Run Target route set in either presentation.
- [ ] Expose Electron built-in DevTools for the dedicated surface `webContents`.
- [ ] Close all presentations on backend surface removal, shell exit, or project teardown.
- [ ] Validate that detached-window close reattaches instead of stopping the profile.

## Validation Ledger

| Validation | Status | Result |
|---|---|---|
| Baseline Python run-profile tests | Passed before planning | 25 passed. |
| Baseline Python settings tests | Passed before planning | 4 passed. |
| Baseline frontend run-file tests | Passed before planning | 5 passed. |
| Baseline Rust run-target tests | Passed before planning | 3 passed. |
| Slice A Python unit tests | Passed | 29 Run Profile tests passed. |
| Slice A frontend tests | Passed | 10 Run Profile frontend tests passed. |
| Slice A TypeScript typecheck/build | Passed | Code TE2 typecheck and `node build.mjs` passed. |
| Slice A Rust tests | Passed | 6 focused Run Target tests passed; Cargo formatting check passed. |
| Slice A Android tests | Passed | Focused Gecko `RunTargetRelayTest` passed. APK build and asset bundling were explicitly excluded. |
| Slice A Electron tests | Passed | Typecheck, compile, and all 41 tests passed. |
| Live Express plus Vite remote test | Passed | User confirmed the primary page and HMR work through declared auxiliary routes. |
| Slice B Python unit tests | Passed | 34 Run Profile tests passed. |
| Slice B frontend tests | Passed | 17 Run Profile frontend tests passed, including selection, exact Stop, and touch/context-menu behavior. |
| Slice B TypeScript typecheck/build | Passed | Code TE2 typecheck and `node build.mjs` passed. |
| Slice B live overlap selection | Passed | User confirmed shared-owner selection, exact-profile execution, and the resulting modal flow work live. |
| Slice C corrected plan review | Approved | URL-only surfaces, Page Preview ownership, backend-declared active ports, runner-dependent fields, and bounded initial HTTP readiness were approved. |
| Slice C Run/Stop interaction review | Approved | Stable Play, aggregate Stop, intent-filtered selectors, and exact dock-menu Stop were approved. |
| Slice C Python unit tests | Passed | 39 Run Profile tests passed, including URL readiness, Page Preview routing/key normalization, global running state, save refresh, and exact lifecycle cleanup. |
| Slice C frontend tests | Passed | 19 Run Profile frontend tests passed, including live Page Preview field visibility, stable Play, aggregate Stop, running-choice filtering, and exact shell identity. |
| Slice C TypeScript typecheck/build | Passed | Code TE2 typecheck and `node build.mjs` passed; `static/dist/host.js` was rebuilt. |
| Slice C live acceptance | Pending | Unit/build validation is complete; live Stop/surface/readiness/dev-runtime behavior still requires user validation. |
| Native dev-runtime frontend tests | Passed | 21 Run Profile tests passed, including runtime-only marker metadata and left-aligned booleans; Code TE2 typecheck/build passed. |
| Native dev-runtime Electron tests | Passed | All 43 desktop tests, typecheck, and compile passed; focused coverage proves exact-origin cache policy/release and exact-frame console injection. |
| Native dev-runtime Gecko checks | Passed | WebExtension scripts passed `node --check`; Gecko unit tests passed 4/4; `:app:assembleGeckoDebug` rebuilt an APK containing the new runtime loader. |
| Native dev-runtime live acceptance | Pending | Console worker registration, reconnect/background behavior, header behavior, and exact teardown still require live native-client validation. |

## Explicit Deferrals

- A shared L7 proxy; native clients already apply exact-origin headers through
  browser request APIs.
- Dynamic auxiliary client-port remapping.
- Console injection into arbitrary ordinary-browser cross-origin pages.
- Periodic URL health polling after initial surface readiness.
- Reserving Page Preview port 5173 while its middleware backend does not bind it.
- Electron surface detachment or native DevTools before the owned surface projection exists.
