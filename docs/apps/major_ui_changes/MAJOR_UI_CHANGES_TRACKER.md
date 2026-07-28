# Code TE2 Major UI Changes Tracker

## Status

Implementation complete. Live desktop and mobile validation remains pending.

## Approved Scope

- [x] Confirm `ProjectSidecar.recent_files` is the 12-entry authority.
- [x] Confirm visual tab order is local-only and project-scoped.
- [x] Confirm square means square-cornered compact tabs.
- [x] Confirm touch swipe scroll plus long-press touch reorder.
- [x] Remove `.fe-menubar`.
- [x] Move File, Edit, Editor, View, and Branch into `.fe-toolbar`.
- [x] Replace the branch label trigger with the vendored Git Codicon.
- [x] Remove the active filename from `.fe-toolbar`.
- [x] Replace the Recents dropdown with a horizontal file-tab viewport.
- [x] Add full-height tab close targets.
- [x] Add wheel/touch horizontal scrolling.
- [x] Add mouse/touch tab reordering and project-scoped persistence.
- [x] Add typed sidecar-backed recent-file close RPC.
- [x] Define active-tab successor behavior.
- [x] Add bounded Git/draft/diagnostics tab decoration projection.
- [x] Reuse Explorer file-card visual semantics.
- [x] Correct file icon mapping through the vendored Seti icon provider.
- [x] Move drawer fullscreen into shared drawer chrome.
- [x] Add focused backend and frontend tests.
- [x] Run full Code TE2 frontend validation.
- [ ] Complete live desktop and mobile validation.

## Contracts

### Backend

- `ProjectSidecar.last_file` is active-file authority.
- `ProjectSidecar.recent_files` is tab-membership authority.
- `OpenStateChanged` remains the lifecycle fact after tab close.
- Tab decorations are bounded to the current recent-file projection.
- No HTTP-era history route becomes a frontend dependency.

### Frontend

- One active editor file/model remains the runtime behavior.
- localStorage controls ordering only.
- Missing backend entries are removed from local order.
- New backend entries append without rewriting stored backend MRU order.
- Active close prefers the visual right neighbor, then the left neighbor.
- All dropdowns remain in-DOM Code TE2 controls.

## Validation Record

- `python -m unittest discover -s tests -p 'test_open_state_recents.py'`
  passed 2 tests.
- `npm run test:file-tabs` passed 3 tests.
- `npm run typecheck` passed.
- `node build.mjs` passed and regenerated `static/dist/host.js`.
- Targeted strict BasedPyright passed for the new tab projector and close
  handler.
- `python -m compileall -q app/apps/file_editor_cm6
  tests/test_open_state_recents.py` passed.

## Deferred

- Persisting visual tab order in backend state.
- More than 12 tabs.
- Multiple simultaneously active editor models.
- Android asset publication.
- Release version bump and commit/push.
