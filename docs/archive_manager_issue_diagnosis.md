# Archive Manager Extraction Failure — Diagnosis and Remediation Guide

## Issue Overview
- **Affected feature:** Archive Manager UI when browsing archives or attempting extraction.
- **User-facing symptom:** Selecting an archive or expanding into it triggers a "Server Error 500" toast. The server log shows a `GET /api/app/archive_manager/browse ... 500` error before any extraction begins.
- **Regression window:** Broke during the modularization refactor that moved apps behind individual backend shells.
- **Expected behavior:** Archive contents should be listed, an extraction job should start through the jobs system, progress toasts should update, and files should appear at the chosen destination.

## Reproduction Checklist
1. Launch the modular Flask host and navigate to **Archive Manager** from the UI shell list.
2. Pick any archive under `$HOME` (for example the bundled `android-ndk-r27b-aarch64.zip`).
3. Attempt to browse into the archive or trigger **Extract** to any destination.
4. Observe the toast reporting **Server Error 500** while the backend logs `NameError: name 'which' is not defined` for the
   `/browse` route. No extraction job is created and the filesystem remains unchanged.

## Observations & Evidence
1. `/browse` switches into archive mode when the selected item looks like an archive. The very next call is `_run_7zz`, which immediately invokes `_select_7zz`.【F:app/apps/archive_manager/backend.py†L111-L194】
2. `_select_7zz` references `which`, but the backend module no longer imports it. The call therefore raises `NameError: name 'which' is not defined`, which Flask surfaces as the HTTP 500 toast seen in the UI. That missing import appeared when archive-manager was migrated into a lazily-loaded backend module during the refactor.【F:app/apps/archive_manager/backend.py†L28-L63】
3. The regression is **not** libarchive failing—`extract_streaming_with_progress` remains intact and works when invoked directly. The crash happens **before** libarchive executes because the request dies inside the legacy `_select_7zz` guard. `/archives/extract` also runs synchronously, so even when it returns to libarchive the UI keeps polling the jobs API for updates that never arrive because no job was enqueued.【F:app/apps/archive_manager/backend.py†L362-L449】【F:app/apps/archive_manager/main.js†L660-L737】
4. The shared jobs layer already exposes `job_extract_archive`, which wraps `extract_streaming_with_progress` and streams progress callbacks. Archive Manager simply stopped delegating to it when the loader rewrite landed.【F:app/libs/archiver_service.py†L1-L69】
5. Legacy p7zip helpers (`_run_7zz`, `_build_extract_command`, `_parse_7zz_slt`, etc.) still live in the backend. Once the missing import knocked them offline, every archive-mode code path now dies before libarchive can run—even if the 7-Zip binary still exists on disk.【F:app/apps/archive_manager/backend.py†L195-L529】

## Possible Root Causes
1. **Missing `shutil.which` import:** The modular loader refactor dropped the `from shutil import which` import, so every `_run_7zz` call now throws a `NameError`, yielding the 500 with no actionable message in the UI.【F:app/apps/archive_manager/backend.py†L28-L63】
2. **Legacy p7zip branch never re-evaluated:** Archive browsing and validation routes still depend on the old helpers. Until they are retired or repaired, any archive interaction will keep hitting the broken branch before libarchive gets involved.【F:app/apps/archive_manager/backend.py†L111-L529】
3. **Job orchestration mismatch:** The extraction HTTP endpoint performs synchronous work instead of deferring to the shared job handler, conflicting with the UI's expectation of streamed progress events.【F:app/apps/archive_manager/backend.py†L362-L449】【F:app/apps/archive_manager/main.js†L660-L737】
4. **Duplicated path resolution logic:** `_resolve_user_path` is implemented both here and in the jobs service, increasing the chance that permission or sandbox updates drift apart.【F:app/apps/archive_manager/backend.py†L64-L110】【F:app/libs/archiver_service.py†L1-L69】
5. **Lack of guardrails:** Nothing in CI forbids stale p7zip helpers from lingering, so once they broke under the lazy-loader changes the regression went unnoticed until runtime.【F:app/apps/archive_manager/backend.py†L195-L529】

## Recommended Fix Plan (Step-by-Step)
1. **Restore the missing import immediately:** Add `from shutil import which` (or delete `_select_7zz`) so `/browse`, `/archives/expand`, and `/archives/test` stop crashing on `NameError`. That unblocks QA and confirms libarchive is still operational.
2. **Decide whether the p7zip helpers should survive:** If archive browsing is now meant to be libarchive-only, port `_list_archive_children` to use libarchive entry iteration and remove `_run_7zz` entirely. If the helpers must stay, reintroduce them with correct imports and error handling that surfaces actionable responses to the UI.
3. **Wire extraction into the jobs system:** Update `/archives/extract` (and `/archives/expand` if it stays) to enqueue `extract_archive` jobs via `archiver_service.job_extract_archive`, returning job metadata immediately so the UI's toast can show progress.
4. **Consolidate path resolution utilities:** Move `_resolve_user_path` into a shared helper (for example `app/utils/paths.py`) that both the Archive Manager backend and the jobs layer reuse to keep permission checks aligned.
5. **Add a lint guard against p7zip references:** Even after removing the helpers, keep a simple check so dead code does not creep back in. One option is a CI step that runs `rg --files-with-matches "\b7z{1,2}\b" app` and fails if it finds backend references.
6. **Regression validation:** After applying the fixes, validate archive browsing, extraction, and progress toasts end-to-end in both the Archive Manager app and the File Manager app to ensure parity.

## Quick Reference — Manual Lint Command
```
rg --files-with-matches "\b7z{1,2}\b" app
```
Run the command above (or integrate it into an automated lint script) to flag any lingering 7-Zip references for removal before merging future changes.
