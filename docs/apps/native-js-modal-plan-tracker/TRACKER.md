# Native JavaScript Modal Tracker

## Status legend

- `[ ]` not started
- `[-]` in progress
- `[x]` complete and validated
- `blocked` requires a recorded decision or prerequisite
- `inline-only` is registered in Pass 1 but not yet portable to Electron
- `removed` was proven orphaned by a whole-repository source audit and pruned

Tracker rows must be updated in the same change as their source migration.

## Phase gates

| Gate | Status | Evidence |
| --- | --- | --- |
| Inventory reviewed against current source | [x] | Initial plan audit, 2026-07-21 |
| Shared async contract approved | [x] | Explicit Pass 1 approval, 2026-07-21 |
| Inline presenter and lifecycle tests pass | [x] | 10 Node/Happy DOM tests |
| Direct blocking-dialog source count is zero | [x] | Corrected baseline: 52; source gate: zero |
| Every custom modal has an owner and stable surface ID | [x] | 20 active families; 2 orphaned blocks removed |
| Pass 1 browser parity passes | [x] | Automated DOM matrix plus live headless Chromium app-shell smoke |
| Pass 1 Android wrapper parity passes | [x] | User-validated live Android behavior, 2026-07-21; no version/publication requested |
| Electron preload/IPC boundary passes | [ ] | |
| Electron child host passes simple-dialog matrix | [ ] | |
| Every non-emergency modal is Electron-portable | [ ] | |
| Packaged Electron Wayland smoke passes | [ ] | |

## Pass 1 work items

| ID | Work item | Status | Notes |
| --- | --- | --- | --- |
| P1-001 | Define versioned request/result and field contracts | [x] | Structured-clone-safe; raw HTML rejected |
| P1-002 | Add `teUI.dialog` async wrappers | [x] | `alert`, `confirm`, `prompt`, `open` |
| P1-003 | Add inline presenter and canonical styles | [x] | Browser and Android default |
| P1-004 | Add stack, resolution-once, focus, Escape, and teardown lifecycle | [x] | Nested generated and declared surfaces covered |
| P1-005 | Add presenter registration and inline fallback | [x] | Electron hook remains optional |
| P1-006 | Add unit/DOM coverage | [x] | Contract, lifecycle, focus, nesting, declared surfaces |
| P1-007 | Add source gate against direct blocking dialogs | [x] | Scans active built-in JS/TS/HTML source |
| P1-008 | Migrate all blocking browser-dialog calls | [x] | Corrected 52-call inventory below |
| P1-009 | Register all true custom modal families | [x] | Stable service contract or `data-te-dialog-surface` ID |
| P1-010 | Audit and prune orphaned template-only modal markup | [x] | Removed unowned Android-config and crash blocks |
| P1-011 | Classify non-modal overlays explicitly | [x] | Drawers/search/toasts/listboxes stay outside modal service |
| P1-012 | Validate browser and Android parity | [x] | Automated/live browser checks plus user live Android validation |

## Blocking browser-dialog inventory

The corrected inventory contains 52 direct calls. The initial scan missed two
inline-script confirmations in the shared app shell; the source gate now scans
active HTML as well as JavaScript and TypeScript.

| App/surface | Source | Calls | Current kinds | Status |
| --- | --- | ---: | --- | --- |
| Code TE2 host assembly | `app/apps/file_editor_cm6/main.ts` | 1 | confirm dependency | [x] |
| Code TE2 save flow | `main_page/frontend/file-ops/save-flow.ts` | 3 | confirm | [x] |
| Code TE2 Git branch menu | `main_page/frontend/host-git-branch-menu.ts` | 2 | prompt | [x] |
| Code TE2 terminal drawer | `main_page/frontend/host-terminal-drawer.ts` | 2 | prompt, alert | [x] |
| Code TE2 projects debug | `main_page/frontend/ui/projects-debug-modal.ts` | 4 | confirm, alert | [x] |
| Code TE2 settings manager | `main_page/frontend/ui/settings-manager.ts` | 1 | confirm | [x] |
| Code TE2 Go to Line | `main_page/frontend/ui/menu-actions-basic.ts` | 1 | prompt | [x] |
| Explorer chrome | `src/explorer/chrome/explorer-chrome-controller.ts` | 4 | confirm | [x] |
| Explorer Git footer | `src/explorer/git/footer-utils.ts` | 5 | prompt, confirm | [x] |
| Explorer review results | `src/explorer/search/review-results-renderer.ts` | 1 | confirm | [x] |
| Explorer tree menu | `src/explorer/tree/menu-controller.ts` | 8 | prompt, confirm | [x] |
| File Explorer | `app/apps/file_explorer/main.js` | 5 | prompt, confirm | [x] |
| Archive Manager | `app/apps/archive_manager/main.js` | 5 | prompt, confirm | [x] |
| Terminal | `app/apps/terminal/src/main.ts` | 4 | alert, confirm | [x] |
| File Editor | `app/apps/file_editor/main.js` | 2 | prompt, confirm | [x] |
| Aria Downloader | `app/apps/aria_downloader/main.js` | 1 | confirm | [x] |
| Shared file picker | `app/static/js/file_picker.js` | 1 | prompt | [x] |
| Shared app shell | `app/templates/app_shell.html` | 2 | confirm | [x] |
| **Total** |  | **52** |  | [x] |

## Custom modal family inventory

`Registered` means lifecycle is owned by `teUI.dialog`. `Portable` means the
request/state is serializable and eligible for Electron. `Electron` means live
child-window validation is complete.

| Proposed surface ID | Current owner/source | Classification | Registered | Portable | Electron |
| --- | --- | --- | --- | --- | --- |
| `framework.recents` | `app/templates/app_shell.html` | Stateful list/actions | [x] | inline-only | [ ] |
| `framework.file-picker` | `app/static/js/file_picker.js` | Stateful filesystem picker | [x] | inline-only | [ ] |
| `code-te2.export-diagnostics` | `host-chrome-runtime.ts` | Simple choice contract | [x] | [x] | [ ] |
| `code-te2.autosave-enable` | `ui/autosave-modal.ts` | Confirmation contract | [x] | [x] | [ ] |
| `code-te2.watcher-limit` | `ui/watcher-settings.ts` | Password/action form | [x] | inline-only | [ ] |
| `code-te2.projects-debug` | `ui/projects-debug-modal.ts` | Stateful list/actions | [x] | inline-only | [ ] |
| `code-te2.run-profiles` | `ui/run-profiles-modal.ts` | Complex declarative form | [x] | inline-only | [ ] |
| `code-te2.new-project` | `src/explorer/chrome/new-project-modal.ts` | Choice/conditional prompt | [x] | inline-only | [ ] |
| `code-te2.editor-settings` | `template.html`, `ui/settings-*` | Complex settings | [x] | inline-only | [ ] |
| `code-te2.agent-shortcuts` | `template.html`, `sidebar-shortcuts/runtime.ts` | Stateful shortcut editor | [x] | inline-only | [ ] |
| `code-te2.themes` | `template.html`, `ui/settings-themes.ts` | Stateful choice list | [x] | inline-only | [ ] |
| `code-te2.extension-manager` | `template.html`, `ui/settings-manager.ts` | Stateful list/actions | [x] | inline-only | [ ] |
| `code-te2.extension-config` | `template.html`, `ui/settings-config-modal.ts` | Schema-driven form | [x] | inline-only | [ ] |
| `code-te2.android-config` | former `template.html` block | Orphaned markup/CSS | removed | n/a | n/a |
| `code-te2.crash` | former `template.html` block | Orphaned markup | removed | n/a | n/a |
| `file-editor.unsaved` | `app/apps/file_editor/template.html`, `main.js` | Three-action confirmation | [x] | inline-only | [ ] |
| `file-explorer.properties` | `app/apps/file_explorer/template.html`, `main.js` | Read-only/stateful details | [x] | inline-only | [ ] |
| `file-explorer.bookmarks` | `app/apps/file_explorer/template.html`, `main.js` | Stateful list/actions | [x] | inline-only | [ ] |
| `file-explorer.bookmark-form` | `app/apps/file_explorer/template.html`, `main.js` | Form | [x] | inline-only | [ ] |
| `archive-manager.bookmarks` | `app/apps/archive_manager/template.html`, `main.js` | Stateful list/actions | [x] | inline-only | [ ] |
| `archive-manager.bookmark-form` | `app/apps/archive_manager/template.html`, `main.js` | Form | [x] | inline-only | [ ] |
| `aria-downloader.new-task` | `app/apps/aria_downloader/template.html`, `main.js` | Form | [x] | inline-only | [ ] |

## Overlay classification audit

These are not automatically modal work. Each needs an explicit source-backed
classification before Pass 1 closes.

| Surface | Current source | Expected classification | Status |
| --- | --- | --- | --- |
| Code TE2 search overlay | `template.html`, `src/explorer/search/` | Non-modal search/review surface | [x] |
| Terminal drawer overlay | `app/apps/terminal/template.html` | Drawer backdrop | [x] |
| Toasts and notification cards | `app/static/js/te_ui.js` | Non-modal status UI | [x] |
| App and field listboxes | declarative/settings controllers | In-dialog JavaScript menus | [x] |

## Pass 2 work items

| ID | Work item | Status | Notes |
| --- | --- | --- | --- |
| P2-001 | Add isolated app-view dialog preload | [ ] | Minimal API only |
| P2-002 | Add validated app-view-to-main dialog IPC | [ ] | Exact current view and relay origin |
| P2-003 | Add modal child `BrowserWindow` and renderer | [ ] | Parent-owned, frameless, modal |
| P2-004 | Reuse canonical dialog renderer and styles | [ ] | No Electron-only visual fork |
| P2-005 | Add size negotiation and display clamping | [ ] | Scroll body after clamp |
| P2-006 | Add stack, focus, keyboard, IME, and accessibility behavior | [ ] | One reusable child host |
| P2-007 | Add navigation/app-close/desktop-close teardown | [ ] | Resolve every pending promise |
| P2-008 | Route simple portable contracts | [ ] | Alert, confirm, prompt, simple forms |
| P2-009 | Add forced-failure inline fallback test | [ ] | Never display duplicate dialogs |
| P2-010 | Refactor every stateful family to portable state/actions | [ ] | Update family table per slice |
| P2-011 | Validate file/folder picker in child host | [ ] | Filesystem authority stays in app |
| P2-012 | Complete packaged Wayland validation | [ ] | Check disk before build |

## Validation record

| Date | Slice | Commands/checks | Result |
| --- | --- | --- | --- |
| 2026-07-21 | Initial read-only inventory | Targeted `rg` over non-generated built-in frontend source | 50 blocking calls; custom families recorded |
| 2026-07-21 | Corrected full source inventory | JS/TS/HTML source gate | 52-call baseline; zero remaining |
| 2026-07-21 | Shared contract and lifecycle | `npm run test:dialogs` | 10/10 pass, including nesting, focus, declared surfaces, and page teardown |
| 2026-07-21 | Touched typed frontends | Code TE2 and Terminal `npm run typecheck` | pass |
| 2026-07-21 | Frontend bundles | Code TE2 and Terminal `node build.mjs` after 18 GB disk check | pass |
| 2026-07-21 | Template owner audit | Whole-repository targeted `rg` | Android-config and crash blocks unowned; removed |
| 2026-07-21 | Test dependency audit | `npm audit` after Happy DOM 20.11.0 update | Added test dependency clean; 4 unrelated existing Vite/ws findings remain |
| 2026-07-21 | Live browser smoke | Disposable headless Chromium against `/app/file_editor_cm6` | Prompt returned edited value, zero layers remained, six static surfaces registered, zero runtime exceptions |
| 2026-07-21 | Android/PWA asset path audit | Asset inventory and Service Worker source | Android bundle already includes full static JS tree; added dialog module to PWA precache |
| 2026-07-21 | Live Android validation | User device check | Pass 1 behavior operates correctly; version/publication intentionally deferred |

## Decisions

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-07-21 | Scope includes all active built-in apps | Explicit user approval |
| 2026-07-21 | Use an async shared API; do not monkeypatch blocking dialogs | Electron child presentation is asynchronous |
| 2026-07-21 | Browser/Android render inline; Electron uses a presenter adapter | Preserves existing non-desktop behavior |
| 2026-07-21 | Do not move live DOM or callbacks between renderers | Renderer-process objects are not portable |
| 2026-07-21 | Keep one reusable desktop child with an internal stack | Supports nested dialogs without OS-window chains |
