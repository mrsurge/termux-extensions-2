# FILE_EDITOR_CM6 Explorer Feature Overhaul Plan

## Problem statement

The Explorer search/results surface is still split across several custom renderers that were good enough for the initial cut but are now too limited for the next UX pass:

- content-search results are plain text rows with no syntax highlighting
- changes/review results render whole diff lines only, with no word-level or semantic diff emphasis
- name search and content search are separate top-level modes even though they are part of the same user search flow
- content search and changes are both hard-truncated in the backend, so the overlay cannot grow into a VS Code-like result browser

The user-approved starting scope for this overhaul is:

1. vendor `highlight.js` and use the GitHub theme for content-search results and "by changes" results
2. vendor the diff package/module directly instead of relying on a CDN
3. use file extension matching for syntax/highlight language selection
4. combine the current "By name" and "By contents" search tabs into one broader search flow
5. organize results by page/tabs because the current content-search result set is capped hard
6. study and vendor the relevant VS Code file-search result element/logic/UI as precedent, while keeping the existing Explorer results overlay shell

## Current code review summary

### Current frontend seams

- The overlay shell and mode switching live in `app/apps/file_editor_cm6/src/explorer/search/overlay-controller.ts`.
- Top-level search modes are still:
  - `name`
  - `content`
  - `changes`
  - `review`
  - `diagnostics`
- The current mode list is hard-coded in `SEARCH_MODE_OPTIONS` inside `overlay-controller.ts`.
- The overlay body dispatcher in `app/apps/file_editor_cm6/src/explorer/search/overlay-body-renderer.ts` still routes name/content/changes/review to separate custom renderers.

### Current search result renderers

- `app/apps/file_editor_cm6/src/explorer/search/results-renderer.ts`
  - `renderNameResults(...)` renders a flat list of file/dir hits
  - `renderContentResults(...)` renders grouped file matches, but each snippet is plain `textContent`
  - there is no syntax-aware rendering, no inline highlight spans, and no paging model
- `app/apps/file_editor_cm6/src/explorer/search/changes-results-renderer.ts`
  - renders the current worktree diff as custom hunk rows
  - currently uses raw line text only; there is no word-diff or semantic-diff overlay
- `app/apps/file_editor_cm6/src/explorer/search/review-results-renderer.ts`
  - reuses the same broad diff-row shape for draft review
  - this is likely the same renderer family that should benefit from the vendored diff/highlight stack

### Current backend result-shape limitations

- `app/apps/file_editor_cm6/explorer/search.py`
  - `search_by_name(...)` allows up to `500` results and returns one flat result list
  - `search_by_content(...)` hard-caps returned file groups to `50`
  - ripgrep and Python fallback both cap matches per file to `5`
  - `search_by_changes(...)` uses `CHANGE_RESULT_LIMIT = 40`
- The current content-search payload already includes enough raw data to support richer rendering:
  - `line`
  - `column`
  - full `text`
  - truncated `snippet`
- The current RPC handler path for search is already isolated and easy to evolve:
  - backend handler: `app/apps/file_editor_cm6/explorer/handlers/search.py`
  - contract types: `app/apps/file_editor_cm6/explorer/contracts/search_review.py`

### Reuse candidates already in this repo

- Explorer already has file-name/icon shaping through `applySetiIconToSpan(...)` in `app/apps/file_editor_cm6/src/explorer/app/bootstrap.ts`; the new search tree should keep using that instead of inventing a second file-label style.
- The editor runtime already has a path-to-language helper (`languageFromPath(...)`) in `app/apps/file_editor_cm6/monaco_editor/m_editor_app.ts`.
  - The Explorer overhaul should prefer extracting/sharing that mapping or mirroring its rules, rather than inventing a third unrelated extension-to-language table.

### External/reference sources

- Vendoring/layout precedent only:
  - `/data/data/com.termux/files/home/test-projects/als_rs/agent_log_server/static`
- Do **not** copy that repo's `dist` output.
- Do **not** introduce CDN runtime dependencies here.

### VS Code search source-of-truth to study/vendor

The relevant source files are in the installed VS Code/code-server tree:

- `/data/data/com.termux/files/home/code-server/lib/vscode/src/vs/workbench/contrib/search/browser/searchView.ts`
- `/data/data/com.termux/files/home/code-server/lib/vscode/src/vs/workbench/contrib/search/browser/searchResultsView.ts`
- `/data/data/com.termux/files/home/code-server/lib/vscode/src/vs/workbench/contrib/search/browser/searchTreeModel/fileMatch.ts`
- `/data/data/com.termux/files/home/code-server/lib/vscode/src/vs/workbench/contrib/search/browser/searchTreeModel/folderMatch.ts`
- `/data/data/com.termux/files/home/code-server/lib/vscode/src/vs/workbench/contrib/search/browser/searchTreeModel/match.ts`

These files are the right precedent for:

- grouped file/folder/match result modeling
- result tree rendering
- preview/highlight segmentation
- counts/badges and result hierarchy

The intent is **not** to vendor the entire VS Code search view. The intent is to vendor/adapt the result model and renderer pieces that fit inside the existing Explorer overlay shell.

## Constraints and non-goals

- Keep the current Explorer results overlay shell; do not replace it with a full sidebar/panel clone.
- Do not turn this into a transport refactor.
- Do not reopen the parked cross-backend/Explorer transport boundary work in this plan.
- Do not depend on CDN-hosted `highlight.js`, `diff`, or theme assets.
- Do not use generated `dist` output from the reference repo as source.

## Proposed workstreams

### Workstream 1: Vendor the rendering dependencies

Goal: move highlight/diff rendering onto checked-in local sources.

Plan:

1. Vendor `highlight.js` source and the GitHub theme into an app-local source location.
2. Vendor the `diff` package/module into an app-local source location.
3. Import both through the existing `app/apps/file_editor_cm6/build.mjs` bundle path so Explorer uses local bundled code, not runtime globals or CDN tags.
4. Keep the vendored surface narrow:
   - only the language/theme/runtime pieces we actually need
   - no unnecessary dist copies

Likely destination:

- `app/apps/file_editor_cm6/vendor/highlightjs/`
- `app/apps/file_editor_cm6/vendor/diff/`

### Workstream 2: Introduce a unified Explorer search result model

Goal: stop treating name/content as two unrelated top-level renderers.

Plan:

1. Replace the current top-level `name` vs `content` split with one broader search flow in the overlay.
2. Preserve separate result buckets inside that flow:
   - file/name hits
   - content hits
3. Represent those buckets as result pages/tabs inside the search mode instead of as separate overlay modes.
4. Keep `changes`, `review`, and `diagnostics` as separate higher-level modes for now.

Why:

- the current mode split is what makes the overlay feel fragmented
- paging/tabs inside one search session is the right place to absorb the current hard cap problem

### Workstream 3: Reshape backend search payloads for paging

Goal: replace fixed truncation with explicit paging/cursor semantics.

Plan:

1. Extend the search RPC contract so content/name search responses can return:
   - page metadata
   - total-ish counts
   - page/bucket identity
   - continuation token or offset
2. Remove the current hard-coded "first 50 files only" assumption from content search.
3. Replace `CHANGE_RESULT_LIMIT = 40` with an explicit page/window shape for changes, so "By changes" can grow without dumping the entire repo diff at once.
4. Preserve the current fast-path behavior for the first page so the overlay still feels snappy on mobile.

Notes:

- the current `search_by_content(...)` result shape is flat enough that this will require a contract revision, not just a renderer tweak
- ripgrep/Python fallback parity must stay intact

### Workstream 4: Vendor/adapt the VS Code result tree

Goal: stop growing custom one-off DOM renderers for complex search results.

Plan:

1. Study the VS Code search result model and rendering stack from the files listed above.
2. Vendor/adapt the minimal pieces needed for:
   - folder grouping
   - file grouping
   - match preview segmentation
   - counts/badges
   - progressive tree rendering
3. Bind the adapted tree to Explorer RPC payloads instead of VS Code's internal search service/query builder.
4. Mount the resulting tree inside the existing Explorer overlay result body.

Important:

- this is a UI/model vendoring task, not a full VS Code search-service transplant
- the TE2 Explorer backend remains the authoritative search producer

### Workstream 5: Add syntax-aware preview rendering

Goal: make content-search and diff results readable enough to scan quickly.

Plan:

1. Use the vendored GitHub `highlight.js` theme for:
   - content-search file previews
   - by-changes diff rows
   - review diff rows where it helps readability
2. Use file extension/path-based language selection.
3. Reuse or extract the current editor `languageFromPath(...)` behavior so highlight language inference follows the same general rules as the editor.
4. Fall back cleanly to plaintext when the extension cannot be mapped.

Important distinction:

- syntax highlighting is for readability
- it is not a replacement for diff emphasis

### Workstream 6: Add word-level / semantic diff emphasis

Goal: make changed lines readable beyond whole-line add/remove color blocks.

Plan:

1. Use the vendored `diff` module for word-level inline diff segmentation on changed lines.
2. Apply that first to:
   - `changes-results-renderer`
   - `review-results-renderer`
3. Keep the existing hunk structure and click/open behavior.
4. Layer inline diff spans on top of the existing line rows instead of replacing the whole diff UI at once.

Notes:

- "semantic diff" here should initially mean word/inline diff emphasis suitable for human review
- do not promise AST-aware semantic diff unless we deliberately scope that later

## Recommended implementation order

1. vendor `highlight.js` + GitHub theme + `diff`
2. extract/share file-path-to-language matching
3. add highlight/diff rendering to the current custom changes/content/review renderers first
4. revise the backend search payloads for paging
5. collapse name/content into one search flow with sub-tabs/pages
6. vendor/adapt the VS Code search result tree and swap it in behind the existing overlay shell

This order gives immediate UX wins before the larger tree-model transplant.

## Risks

### Risk: over-vendoring too much of VS Code

Mitigation:

- vendor only the search result tree/model seam, not the full search view/query widget/service stack

### Risk: language mismatch between Explorer highlight and editor highlight

Mitigation:

- reuse/extract the existing editor `languageFromPath(...)` rules

### Risk: mobile performance regression

Mitigation:

- keep page/window limits explicit
- render progressively
- do not syntax-highlight enormous result sets all at once

### Risk: backend/frontend contract churn

Mitigation:

- evolve the Explorer search RPC contract intentionally in one pass instead of layering ad hoc optional fields

## Acceptance criteria for the first approved implementation batch

1. Explorer search no longer depends on CDN-hosted highlight/diff assets.
2. Content-search previews are syntax highlighted with the GitHub theme when a language can be inferred.
3. Changes/review rows support inline word-diff emphasis.
4. Name/content are one search flow with internal result pages/tabs instead of two unrelated top-level overlay modes.
5. Content search is no longer hard-limited to the first 50 files as the only accessible result set.
6. The results overlay shell remains the user-facing container.
