# Open VSX Explorer Marketplace Tracker

Status: implementation and automated build validation complete; manual
cross-client acceptance pending.

Legend:

- `[x]` complete
- `[ ]` not started
- `[-]` intentionally excluded

## Decisions

- [x] Use a new Explorer-owned marketplace overlay.
- [x] Do not reuse or replace the existing Settings extension modal.
- [x] Keep the local-VSIX workflow unchanged.
- [x] Reuse strict MessagePack `/rpc/explorer`.
- [x] Use separate search/list and sliding detail elements.
- [x] Query Open VSX from the Python backend, not the browser.
- [x] Render validated registry-hosted icons directly with a local fallback.
- [x] Install through the resolved code-server CLI and shared TE2 extension
  directory.
- [x] Reuse the existing uninstall and code-server/WBA restart behavior.
- [x] Mark explicit UI-only extensions unsupported.
- [x] Replace the Explorer project label with the projected Git branch.

## Investigation

- [x] Inspect code-server's Open VSX product patch.
- [x] Verify code-server install/uninstall-by-ID CLI support.
- [x] Inspect the live Open VSX search and latest-detail response shapes.
- [x] Trace TE2 extension registry, local-VSIX install, uninstall, rescan, and
  restart ownership.
- [x] Trace Explorer RPC contract and dispatcher seams.
- [x] Trace Explorer overlay DOM, controller, and CSS lifecycle conventions.
- [x] Trace Git branch facts from backend notification to frontend runtime
  state.
- [x] Record the implementation and validation plan.

## Phase 1: Backend contracts and service

- [x] Add search parameter/result contracts.
- [x] Add detail parameter/result contracts.
- [x] Add marketplace install-by-ID parameter/result contracts.
- [x] Add the three RPC methods to Python and TypeScript method maps.
- [x] Add Explorer runtime dispatch and handlers.
- [x] Add bounded server-side Open VSX search.
- [x] Add bounded server-side Open VSX detail lookup.
- [x] Normalize optional metadata and safe external links.
- [x] Restrict projected icon URLs to the matching Open VSX asset path.
- [x] Merge installed versions from the existing registry.
- [x] Classify explicit UI-only extensions as unsupported.
- [x] Add the code-server install-by-ID registry helper.
- [x] Share post-install rescan/settings-gate logic with local VSIX install.
- [x] Reuse code-server/WBA restart behavior after marketplace install.
- [x] Keep local-VSIX install and uninstall contracts backward compatible.

## Phase 2: Explorer marketplace overlay

- [x] Add the `🧩` Explorer-header button.
- [x] Add a dedicated marketplace overlay root beside the tree/search overlay.
- [x] Add persistent UI-extension support notice.
- [x] Implement search input, debounce, loading, error, empty, and ready states.
- [x] Implement paginated result list and Load more.
- [x] Render installed-version markers.
- [x] Render lazy, no-referrer icons in results and details with fallback.
- [x] Add stale search-response suppression.
- [x] Add the sliding detail element.
- [x] Preserve query, results, selection, and scroll position beneath details.
- [x] Implement detail loading, error, metadata, and support states.
- [x] Implement Back and layered Escape behavior.
- [x] Implement focus restoration.
- [x] Implement Install confirmation and single-flight action state.
- [x] Implement Uninstall confirmation and single-flight action state.
- [x] Refresh installed state without closing the detail element.
- [x] Make marketplace and Explorer search overlays mutually exclusive.
- [x] Close/invalidate marketplace state on project change.
- [x] Keep the overlay usable across recoverable RPC reconnects.
- [ ] Verify result and detail scrolling on touch layouts.

## Phase 3: Explorer branch label

- [x] Rename project-label DOM and controller symbols to branch-label symbols.
- [x] Retain `head`, `isRepository`, and `hasHead` in frontend Git status.
- [x] Render normal branch state.
- [x] Render detached HEAD state.
- [x] Render no-commit state.
- [x] Render non-repository state.
- [x] Render initial/pending state.
- [x] Refresh on bootstrap, project changes, Git status updates, and reconnect.
- [x] Remove the project path from the label title.

## Phase 4: Automated validation

- [x] Test marketplace contract validation.
- [x] Test normalized Open VSX search/detail responses.
- [x] Test icon URL normalization and browser image fallback.
- [x] Test Open VSX timeout handling.
- [x] Test Open VSX malformed response and HTTP errors.
- [x] Test installed-version merge and UI-only classification.
- [x] Test code-server install-by-ID command construction.
- [ ] Test registry rescan/settings gate and restart routing.
- [ ] Regression-test local-VSIX install and uninstall.
- [x] Test frontend debounce.
- [x] Test frontend stale-response suppression.
- [ ] Test paging and preserved results after page failure.
- [x] Test detail selection, Back, and repeated opening.
- [ ] Test Escape and focus restoration.
- [x] Test Install success.
- [ ] Test Install/Uninstall failure and retry.
- [ ] Test marketplace/search mutual exclusion and project-change teardown.
- [x] Test all branch-label states.
- [x] Run `npm run typecheck`.
- [x] Run `node build.mjs`.

## Phase 5: Manual acceptance

- [ ] Search and paginate against Open VSX.
- [ ] Open details repeatedly without losing list state.
- [ ] Install a supported extension.
- [ ] Upgrade an installed extension.
- [ ] Uninstall a user extension.
- [ ] Reject/disable an explicit UI-only extension.
- [ ] Report a code-server-incompatible extension cleanly.
- [ ] Recover from temporary Open VSX/RPC failure.
- [ ] Validate existing Settings extension manager.
- [ ] Validate existing local-VSIX picker/install.
- [ ] Validate branch label through repository/project changes.
- [ ] Validate desktop-width and narrow/mobile Explorer layouts.
- [ ] Validate browser, Android wrapper, and Electron wrapper.

## Explicit exclusions for this implementation pass

- [-] Microsoft Marketplace integration.
- [-] Browser-direct Open VSX API requests.
- [-] Remote README/changelog rendering.
- [-] UI-only extension execution.
- [-] A new RPC lane or app-wide marketplace service.
- [-] Changes to the Settings extension modal.
- [-] Android asset publication.
- [-] Version bump, release tag, or package publication.
