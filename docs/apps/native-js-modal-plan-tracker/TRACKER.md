# Native JavaScript Modal Tracker

## Status legend

- `[ ]` not started
- `[-]` in progress
- `[x]` complete and validated
- `blocked` requires a recorded decision or prerequisite
- `inline-only` is registered in Pass 1 but not yet portable to Electron

Tracker rows must be updated in the same change as their source migration.

## Phase gates

| Gate | Status | Evidence |
| --- | --- | --- |
| Inventory reviewed against current source | [x] | Initial plan audit, 2026-07-21 |
| Shared async contract approved | [ ] | |
| Inline presenter and lifecycle tests pass | [ ] | |
| Direct blocking-dialog source count is zero | [ ] | Initial count: 50 |
| Every custom modal has an owner and stable surface ID | [ ] | |
| Pass 1 browser parity passes | [ ] | |
| Pass 1 Android wrapper parity passes | [ ] | |
| Electron preload/IPC boundary passes | [ ] | |
| Electron child host passes simple-dialog matrix | [ ] | |
| Every non-emergency modal is Electron-portable | [ ] | |
| Packaged Electron Wayland smoke passes | [ ] | |

## Pass 1 work items

| ID | Work item | Status | Notes |
| --- | --- | --- | --- |
| P1-001 | Define versioned request/result and field contracts | [ ] | Structured-clone-safe; no raw HTML/functions |
| P1-002 | Add `teUI.dialog` async wrappers | [ ] | `alert`, `confirm`, `prompt`, `open` |
| P1-003 | Add inline presenter and canonical styles | [ ] | Browser and Android default |
| P1-004 | Add stack, resolution-once, focus, Escape, and teardown lifecycle | [ ] | Include nested dialogs |
| P1-005 | Add presenter registration and inline fallback | [ ] | Electron hook remains optional |
| P1-006 | Add unit/DOM coverage | [ ] | Contract, lifecycle, accessibility |
| P1-007 | Add source gate against direct blocking dialogs | [ ] | Active built-in frontend sources only |
| P1-008 | Migrate all blocking browser-dialog calls | [ ] | See inventory below |
| P1-009 | Register all true custom modal families | [ ] | Stable surface IDs |
| P1-010 | Audit and prune orphaned template-only modal markup | [ ] | Preserve emergency fallback |
| P1-011 | Classify non-modal overlays explicitly | [ ] | No accidental floating drawers/search |
| P1-012 | Validate browser and Android parity | [ ] | No Android native-source changes |

## Blocking browser-dialog inventory

The initial inventory contains 50 direct calls. Counts are migration units, not
estimates.

| App/surface | Source | Calls | Current kinds | Status |
| --- | --- | ---: | --- | --- |
| Code TE2 host assembly | `app/apps/file_editor_cm6/main.ts` | 1 | confirm dependency | [ ] |
| Code TE2 save flow | `main_page/frontend/file-ops/save-flow.ts` | 3 | confirm | [ ] |
| Code TE2 Git branch menu | `main_page/frontend/host-git-branch-menu.ts` | 2 | prompt | [ ] |
| Code TE2 terminal drawer | `main_page/frontend/host-terminal-drawer.ts` | 2 | prompt, alert | [ ] |
| Code TE2 projects debug | `main_page/frontend/ui/projects-debug-modal.ts` | 4 | confirm, alert | [ ] |
| Code TE2 settings manager | `main_page/frontend/ui/settings-manager.ts` | 1 | confirm | [ ] |
| Code TE2 Go to Line | `main_page/frontend/ui/menu-actions-basic.ts` | 1 | prompt | [ ] |
| Explorer chrome | `src/explorer/chrome/explorer-chrome-controller.ts` | 4 | confirm | [ ] |
| Explorer Git footer | `src/explorer/git/footer-utils.ts` | 5 | prompt, confirm | [ ] |
| Explorer review results | `src/explorer/search/review-results-renderer.ts` | 1 | confirm | [ ] |
| Explorer tree menu | `src/explorer/tree/menu-controller.ts` | 8 | prompt, confirm | [ ] |
| File Explorer | `app/apps/file_explorer/main.js` | 5 | prompt, confirm | [ ] |
| Archive Manager | `app/apps/archive_manager/main.js` | 5 | prompt, confirm | [ ] |
| Terminal | `app/apps/terminal/src/main.ts` | 4 | alert, confirm | [ ] |
| File Editor | `app/apps/file_editor/main.js` | 2 | prompt, confirm | [ ] |
| Aria Downloader | `app/apps/aria_downloader/main.js` | 1 | confirm | [ ] |
| Shared file picker | `app/static/js/file_picker.js` | 1 | prompt | [ ] |
| **Total** |  | **50** |  |  |

## Custom modal family inventory

`Registered` means lifecycle is owned by `teUI.dialog`. `Portable` means the
request/state is serializable and eligible for Electron. `Electron` means live
child-window validation is complete.

| Proposed surface ID | Current owner/source | Classification | Registered | Portable | Electron |
| --- | --- | --- | --- | --- | --- |
| `framework.recents` | `app/templates/app_shell.html` | Stateful list/actions | [ ] | [ ] | [ ] |
| `framework.file-picker` | `app/static/js/file_picker.js` | Stateful filesystem picker | [ ] | [ ] | [ ] |
| `code-te2.export-diagnostics` | `host-chrome-runtime.ts`, `template.html` | Simple choice | [ ] | [ ] | [ ] |
| `code-te2.autosave-enable` | `ui/autosave-modal.ts` | Confirmation | [ ] | [ ] | [ ] |
| `code-te2.watcher-limit` | `ui/watcher-settings.ts` | Password/action form | [ ] | [ ] | [ ] |
| `code-te2.projects-debug` | `ui/projects-debug-modal.ts` | Stateful list/actions | [ ] | [ ] | [ ] |
| `code-te2.run-profiles` | `ui/run-profiles-modal.ts` | Complex declarative form | [ ] | [ ] | [ ] |
| `code-te2.new-project` | `src/explorer/chrome/new-project-modal.ts` | Choice/conditional prompt | [ ] | [ ] | [ ] |
| `code-te2.editor-settings` | `template.html`, `ui/settings-*` | Complex settings | [ ] | [ ] | [ ] |
| `code-te2.agent-shortcuts` | `template.html`, `sidebar-shortcuts/runtime.ts` | Stateful shortcut editor | [ ] | [ ] | [ ] |
| `code-te2.themes` | `template.html`, `ui/settings-themes.ts` | Stateful choice list | [ ] | [ ] | [ ] |
| `code-te2.extension-manager` | `template.html`, `ui/settings-manager.ts` | Stateful list/actions | [ ] | [ ] | [ ] |
| `code-te2.extension-config` | `template.html`, `ui/settings-config-modal.ts` | Schema-driven form | [ ] | [ ] | [ ] |
| `code-te2.android-config` | `template.html` | Platform-only; owner audit required | [ ] | blocked | blocked |
| `code-te2.crash` | `template.html` | Emergency fallback; owner audit required | [ ] | n/a | inline fallback |
| `file-editor.unsaved` | `app/apps/file_editor/template.html`, `main.js` | Three-action confirmation | [ ] | [ ] | [ ] |
| `file-explorer.properties` | `app/apps/file_explorer/template.html`, `main.js` | Read-only/stateful details | [ ] | [ ] | [ ] |
| `file-explorer.bookmarks` | `app/apps/file_explorer/template.html`, `main.js` | Stateful list/actions | [ ] | [ ] | [ ] |
| `file-explorer.bookmark-form` | `app/apps/file_explorer/template.html`, `main.js` | Form | [ ] | [ ] | [ ] |
| `archive-manager.bookmarks` | `app/apps/archive_manager/template.html`, `main.js` | Stateful list/actions | [ ] | [ ] | [ ] |
| `archive-manager.bookmark-form` | `app/apps/archive_manager/template.html`, `main.js` | Form | [ ] | [ ] | [ ] |
| `aria-downloader.new-task` | `app/apps/aria_downloader/template.html`, `main.js` | Form | [ ] | [ ] | [ ] |

## Overlay classification audit

These are not automatically modal work. Each needs an explicit source-backed
classification before Pass 1 closes.

| Surface | Current source | Expected classification | Status |
| --- | --- | --- | --- |
| Code TE2 search overlay | `template.html`, `src/explorer/search/` | Non-modal search/review surface | [ ] |
| Terminal drawer overlay | `app/apps/terminal/template.html` | Drawer backdrop | [ ] |
| Toasts and notification cards | `app/static/js/te_ui.js` | Non-modal status UI | [ ] |
| App and field listboxes | declarative/settings controllers | In-dialog JavaScript menus | [ ] |

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

## Decisions

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-07-21 | Scope includes all active built-in apps | Explicit user approval |
| 2026-07-21 | Use an async shared API; do not monkeypatch blocking dialogs | Electron child presentation is asynchronous |
| 2026-07-21 | Browser/Android render inline; Electron uses a presenter adapter | Preserves existing non-desktop behavior |
| 2026-07-21 | Do not move live DOM or callbacks between renderers | Renderer-process objects are not portable |
| 2026-07-21 | Keep one reusable desktop child with an internal stack | Supports nested dialogs without OS-window chains |
