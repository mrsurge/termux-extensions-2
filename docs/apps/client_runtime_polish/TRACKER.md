# Client Runtime Polish Tracker

Plan: [PLAN.md](PLAN.md). Baseline: published TE2 0.2.351.
Working branch: `feature/desktop-deb-packaging`; no new branch needed for planning.

## Planning

- [x] Record the three requested workstreams and initial source entry points.
- [x] Separate verified source observations from unconfirmed bug explanations.
- [x] Capture the original persistence proposal; superseded below after the
  reconciliation fix passed live acceptance.

## Color picker

- [ ] Trace normal-hover versus color-discovery/presentation flow end to end.
- [x] Investigate the document selector argument and existing provider waits.
- [ ] Capture cold/warm local/remote timings with bounded instrumentation.
- [x] Implement the evidenced generic fix; user reports live acceptance on all clients.

### First correction — provider selection

The frontend aggregated color provider sends no explicit provider handle for
presentations. WBA passed a language string to the document-aware registry,
which rejects it for missing languageId/path, then exhausted its five-second
discovery wait. Normal hover and document-color discovery already pass the full
document descriptor. Presentations now do likewise, preserving scheme/path
matching and all eligible providers without a language-specific workaround.

Rebuilt WBA output; five focused tests passed, including real-registry color
presentation dispatch for file and vscode-remote schemes with nonmatching
providers excluded and no discovery wait. Code TE2 typecheck and build passed.
The separate full WBA tsc invocation remains red on module resolution and other
errors outside this change; do not report it as passing.

User live acceptance: all clients passed. The initially reported consecutive-hover
delay was affected by a connection issue in the test environment, not a confirmed
failure of this correction. No numerical timing claims are made. Further timing
analysis and investigation of discovery's extra full-text didChange acknowledgement
are deferred unless fresh evidence warrants them. This correction changes only
the server-side WBA payload; no native asset publication is needed for the fix.

## Sidebar identity and preferences

### First correction — live membership is not durable preference authority

Source investigation found concurrent primary-view activation publishing each
individual view's snapshot as complete. Python could remove not-yet-created views,
then frontend reconciliation discarded their hidden/order settings. Persistent
contributed-view IDs are already deterministic; console IDs additionally contain
a separate window identity, so their length alone does not establish identity churn.

Implemented `membershipComplete` on WBA snapshots: activation progress upserts
immediately without pruning; completion permits live-membership removal. Session
reset remains non-authoritative. Frontend reconciliation retains order/mode for
absent persistent contributed views, but projects only live slots and clears stale
foreground/mention targets. Disposable panel/run-target removal is unchanged.
Storage migration, shortened IDs and expiry were subsequently cancelled by the
user; retain the existing client-local stores.

Validation: 26 focused JS tests and 12 Python tests passed; Code TE2 typecheck and
frontend/WBA build passed. User reports the correction working and live-accepted.
The agent did not restart the shared runtime, perform native OTA, edit Android,
bump versions or publish a release during implementation.

- [x] Trace and correct the source-backed preference-loss path.
- [x] Retain regression tests and record user live acceptance.
- [x] Close this workstream with existing client-local persistence retained.

Cancelled, not implemented: backend config migration, new boot projection,
compact-ID redesign, last-access tracking and 14-day expiry. Preserve asynchronous
Sidebar loading; no additional startup redesign without new evidence.

## Cefrium zoom

- [ ] Classify the live zoom gesture and affected browser surfaces/devices.
- [ ] Inspect pinned API and suppression lifecycle/recreation paths.
- [ ] Implement only the confirmed correction, if required.
- [ ] Build/bundle and live-test Motorola and Pixel with verified client assets.

## Release artifact reuse

- [x] Preliminary source inspection of Linux wheel injection, runtime provenance,
  native build info, bootstrap fingerprints and Termux version coupling.
- [x] Record proposed separate package/native identities and fail-closed reuse.
- [x] Define wheel/install-script-first publication and independent optional APK
  releases, with separately tracked native, bundled and OTA asset identities.
- [ ] Audit complete native inputs, protocol compatibility and version consumers.
- [x] Select release-family numbering: native `0.2.352`, reuse releases
  `0.2.352.1`, `.2`, then a new native family such as `0.2.353`.
- [ ] Audit version consumers and define provenance migration for that scheme.
- [ ] Define native/asset compatibility and APK resolution for wheel-only releases;
  audit latest/download links and existing Electron upgrade/materialization.
- [ ] Publish portable native artifact manifests and add verified reuse selection.
- [ ] Prove frontend-only packaging needs no Cargo; cover invalid reuse tests.
- [ ] Validate reused binaries through Debian/Termux fresh install and upgrade.
- [ ] Validate old-APK OTA, incompatible/failed OTA handling and fresh APK discovery
  when the newest release publishes only updated Python/frontend artifacts.

## Completion

- [ ] Update architectural documentation/memory for verified contract changes.
- [ ] Record automated checks and user live acceptance separately.
- [ ] Commit/push/merge or release only under the corresponding user instruction.
