# Client Runtime Polish Tracker

Plan: [PLAN.md](PLAN.md). Baseline: published TE2 0.2.351.
Working branch: `feature/desktop-deb-packaging`; no new branch needed for planning.

## Planning

- [x] Record the three requested workstreams and initial source entry points.
- [x] Separate verified source observations from unconfirmed bug explanations.
- [x] Capture stable identity, dedicated persistence, asynchronous startup, and
  deferred 14-day cleanup requirements.

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

- [ ] Reproduce hide/order loss across Code TE2 worker restart and capture keys.
- [ ] Audit native/browser identity creation, validation, reset, and propagation.
- [ ] Decide compact new-ID format without rotating existing client identities.
- [ ] Define dedicated backend config schema, migration, and single write owner.
- [ ] Integrate one small initial preference projection with existing boot traffic.
- [ ] Separate editor readiness, Sidebar shell readiness, and extension activation.
- [ ] Add coalesced last-access tracking and deferred inactive-record cleanup.
- [ ] Validate restart, multi-client/project, relay-port, stale snapshot, and
  delayed-provider behavior across all four client types.

## Cefrium zoom

- [ ] Classify the live zoom gesture and affected browser surfaces/devices.
- [ ] Inspect pinned API and suppression lifecycle/recreation paths.
- [ ] Implement only the confirmed correction, if required.
- [ ] Build/bundle and live-test Motorola and Pixel with verified client assets.

## Completion

- [ ] Update architectural documentation/memory for verified contract changes.
- [ ] Record automated checks and user live acceptance separately.
- [ ] Commit/push/merge or release only under the corresponding user instruction.
