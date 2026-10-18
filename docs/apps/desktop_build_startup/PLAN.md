# Desktop editable framework startup awareness

## Approved scope

Resolve the Electron timeout during editable/source framework and native worker
builds. Preserve the canonical manifest/cache/fingerprint build flow and existing
readiness authority. No health polling during the build. Show Cargo's x/n output
as feedback, wait without an elapsed-time startup failure, and permit cancellation
of the exact owned launch. Process exit/signal confirms termination; a cancelled
launch never selects a late endpoint or launches the preferred app.

## Implementation

- Opt-in bootstrap FD3 startup events begin before migration/build locks. Events
  distinguish preparing, building (unit plus bounded latest Cargo output), build
  finished (exit code), and starting. Keep the existing shutdown-capable hello
  after native preparation. Build success is not readiness.
- Normal manifest-based Cargo builds tee stderr diagnostics while forwarding
  Cargo's forced non-TTY progress display. No compiler/fingerprint/cache policy
  changes and no heuristic readiness detection from output text.
  The stdlib feedback helper is packaged under `app/cli/` because installed
  bootstrap files are discovered by path, not imported as a `framework` package.
  Explicit developer `--cargo-manifest`/`--no-build-cache` Cargo-run overrides
  retain their existing behavior; Desktop does not supply those overrides.
- Desktop enables the shared controller's established indefinite-startup mode:
  await hello before any framework-health polling. Existing old bootstrap
  versions remain usable without progress events. Packaged/cached launches skip
  building and proceed to the same handshake/readiness gates.
- The shared shell shows build state/latest output and an independently usable
  Cancel button even while Start's invocation is awaiting readiness.
- Keep startup state transient and exact-child fenced; clear it after readiness,
  failure or exit. Keep external/remote frameworks outside cancellation ownership.

## Validation and activation

Run isolated bootstrap progress/identity/native-build tests, Electron strict
typecheck/tests/compile, shared launcher browser regressions and Electromux source
checks as applicable. No shared runtime restart, Electron relaunch, APK assembly,
client OTA or release is authorized by implementation approval. These are separate
activation steps. The earlier deferral is in desktop_deb_packaging/TRACKER.md and
electromux/PLAN.md (Release-compatible mobile launch wait).
