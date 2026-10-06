# Code TE2 Outstanding Issues

## Electron must await a framework source build

- Status: deferred by user approval on 2026-10-06 to an editable-install follow-up source tag; not a 0.2.352 binary-release blocker.
- User-reported behavior: Electron does not await completion when launching the configured local framework triggers a source build.
- Required behavior: retain startup ownership while bootstrap builds, then continue using the existing framework/app readiness flow. A build must not be treated as a failed launch merely because the server is not listening yet.
- Investigation: trace the Electron-owned process controller, bootstrap output/exit handling and startup timeouts before selecting the fix. Preserve parallel UI startup and never stop an externally owned framework.
- Acceptance: launch from an installation requiring a real source build, then verify preferred-app opening and genuine build-failure handling before the follow-up tag.

## Terminal profile activation-event validation

- Status: deferred; fix before the next release.
- Location: `workbench_protocol_proxy/node_workbench_adapter/src/extensions/activation-events.ts`, terminal contribution generator.
- Diagnostic: TS2488, `Type '{}' must have a '[Symbol.iterator]()' method`.
- Cause: `contribution.profiles` is `unknown`; `?? []` handles nullish values but does not establish that the value is an array.
- Impact: valid profile arrays work normally. Malformed non-array contributions can throw or be iterated incorrectly. No observed runtime failure is attributed to this issue.
- History: the affected line dates to July 25, 2026; this is not a newly introduced change in the current packaging slice.
- Proposed fix: narrow with `Array.isArray`, skip malformed values, and add regression coverage for valid, missing and malformed profile contributions. Do not suppress the diagnostic with a cast.
- Validation: targeted TypeScript check and activation-event tests, followed by the normal adapter bundle build. The regular Code TE2 frontend typecheck excludes the adapter source; bundling alone does not validate types.
- Current checkpoint adds documentation/comments only. Do not rebuild or replace the accepted Linux wheel for this note; include the eventual behavioral fix in the next release candidate.
