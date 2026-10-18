# Code TE2 Outstanding Issues

## Electron must await a framework source build

- Status: implemented in desktop_build_startup; user confirms cold-build/cached/
  cancel startup acceptance on 2026-10-15. Original deferral/history below is
  retained, not a current missing implementation.
- User-reported behavior: Electron does not await completion when launching the configured local framework triggers a source build.
- Required behavior: retain startup ownership while bootstrap builds, then continue using the existing framework/app readiness flow. A build must not be treated as a failed launch merely because the server is not listening yet.
- Investigation: trace the Electron-owned process controller, bootstrap output/exit handling and startup timeouts before selecting the fix. Preserve parallel UI startup and never stop an externally owned framework.
- Acceptance: launch from an installation requiring a real source build, then verify preferred-app opening and genuine build-failure handling before the follow-up tag.

## Terminal profile activation-event validation

- Status: fixed in source in the grouped pre-release correctness cleanup.
- Location: `workbench_protocol_proxy/node_workbench_adapter/src/extensions/activation-events.ts`, terminal contribution generator.
- Diagnostic: TS2488, `Type '{}' must have a '[Symbol.iterator]()' method`.
- Cause: `contribution.profiles` is `unknown`; `?? []` handles nullish values but does not establish that the value is an array.
- Impact: valid profile arrays work normally. Malformed non-array contributions can throw or be iterated incorrectly. No observed runtime failure is attributed to this issue.
- History: the affected line dates to July 25, 2026; this is not a newly introduced change in the current packaging slice.
- Fix: narrow with `Array.isArray`, skip malformed values, and cover valid, missing and malformed profiles, mixed entries and later valid contributions. No diagnostic-suppressing cast or VS Code terminal feature was added.
- Validation: targeted TypeScript check and activation-event tests, followed by the normal adapter bundle build. The regular Code TE2 frontend typecheck excludes the adapter source; bundling alone does not validate types.
- The normal build now includes the fix for the next candidate; an existing WBA must restart to adopt it. No accepted wheel was replaced by this cleanup.

## Deleted automatically selected editable mypyc artifact

- Status: investigation/fix pending in ../release_0_2_354/PLAN.md; not implemented.
- User reports deleting a build/pin caused native Python import FileNotFoundError
  for domain-a7f57a2.../manifest.json instead of interpreted startup. Rebuilding
  and activating recovered; exact selector provenance must still be established.
- Proposed boundary: handle missing automatic editable selection safely without
  weakening explicit selection, corrupt payload or packaged-runtime validation.
