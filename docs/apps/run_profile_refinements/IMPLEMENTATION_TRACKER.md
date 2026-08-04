# Run Profile Refinements Implementation Tracker

## Status

- Phase: Slices A and B implemented and live-validated
- Implementation approval: granted for Slices A and B
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
| Run Profile surface ownership | Planned | Define one backend-owned surface projection; the Sidebar iframe and future Electron window are client presentations of it. |
| Sidebar iframe ownership | Investigated | Existing ledger can close exact host ids, but Run slots are not project-scoped and stop events do not close them. |
| `devRuntime` save refresh | Planned | Typed post-commit `FileSaved` event from canonical and bulk save paths; non-blocking fanout. |
| Profile route cache policy | Decided | Raw TCP stays transport-only; use profile refresh revisions. L7 header rewriting deferred. |
| Console bridge injection | Planned | New opt-in flag; Gecko document-start injection and Electron exact-subframe injection. |
| Electron detached presentation | Planned | Common `devTools` metadata reaches Electron, but no Electron consumer/injection/display exists. A client-local surface registry will support reconstruction, detach/reattach, and built-in DevTools. |
| Contract/docs/repo memory | Complete | Plan/tracker, Code TE2 contract, and KB-backed repo memory describe the implemented Slice B boundary. |

## Invariants Checklist

- [x] No polling in the design.
- [x] Python remains profile orchestration authority.
- [x] Framework-Shells remains running-state authority.
- [x] Rust routes remain exact-owner, exact-shell, declared-port only.
- [x] Native listeners are grouped by profile route set and cleaned on replacement, retarget, and native teardown.
- [ ] Exact profile-stop listener and Sidebar-slot cleanup remains Slice C.
- [x] Standalone/browser behavior does not depend on native instrumentation.
- [x] Existing Run Profile JSON remains backward compatible.
- [x] Page Preview is excluded from auxiliary-port/dev-runtime behavior.
- [x] Draft-save confirmation and stale-selection protections are preserved.
- [x] Modal/long-press cancellation cannot duplicate run requests.
- [x] Backend surface identity is separate from iframe, frame, webContents, and window identity.
- [x] Embedded/hidden/detached presentation state remains client-local.

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
| Save completion event | Complete | Active save and `save_reviews` are separate commit paths and share no typed save-complete event. |
| Cache-control mutation boundary | Complete | Current relay is raw TCP; initial slice uses cache-busting document reload and defers L7 rewriting. |
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

- [ ] Define and project the bounded `RunProfileSurface` contract.
- [ ] Keep stable `surfaceId` separate from shell generation and client presentation ids.
- [ ] Make Run Profile host ids project-scoped and persist owner metadata.
- [ ] Close the exact slot on Stop and terminal shell lifecycle.
- [ ] Add `devRuntime` schema/form support.
- [ ] Publish typed `FileSaved` from active and bulk save paths.
- [ ] Match successful saves against running profile include sets off the save path.
- [ ] Reload each matching slot with an incremented refresh revision.
- [ ] Preserve relay and Inspector identities without leaks.

### Slice D: Console Instrumentation

- [ ] Add `consoleBridge` schema/form support.
- [ ] Package explicit-origin bridge bootstrap for foreign pages.
- [ ] Add profile-aware unique worker labels.
- [ ] Inject marked GeckoView frames at document start.
- [ ] Inject exact marked Electron subframes after load.
- [ ] Validate registration, reconnect, background, and teardown.

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

## Explicit Deferrals

- HTTP response-header rewriting and a shared L7 proxy.
- Dynamic auxiliary client-port remapping.
- Console injection into arbitrary ordinary-browser cross-origin pages.
- Any Page Preview behavior change.
- Electron surface detachment or native DevTools before the owned surface projection exists.
