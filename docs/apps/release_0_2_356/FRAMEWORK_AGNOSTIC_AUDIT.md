# App-agnostic framework and live catalog refresh — 2026-10-22

## Scope and invariant

User requires the framework to remain app-agnostic: no app-name-conditioned
production behavior, app-owned Python imports, fixed recipient identities or
private app paths in framework source. New app integration surfaces must be
manifest-driven; app-specific implementation belongs to the app. Names inside
app manifests are legitimate policy data, not framework knowledge.

This document records the approved **audit and staged plan** plus the separately
approved Stage A1 bootstrap implementation below. It supersedes the earlier assumption that restoring Refresh is merely
a route-index fix. User previously approved that bounded restoration; discovery
of deeper native selection/policy coupling now requires concrete slice approvals.
The original audit performed no production source edits, refresh request,
worker/framework restart, build, publication, version bump or commit.
Existing uncommitted PyO3 work and user shellspec overrides remain separate.

The search reported by the user is a useful intake, not a runtime-coupling count:
many matches are inline test fixtures. The production violations below are real
independently of that distinction. Tests should use neutral sample identities
unless they exercise app-owned integration; those tests belong beside the app
rather than embedding built-in app assumptions in framework unit tests.

## Native binary resolution: what is reusable today?

`framework/bootstrap/bootstrap.py` already has:

- `_load_native_build`: validated native-build JSON → NativeWorkerBuild.
- `_rust_source_fingerprint`: shared framework-source-v2 source/profile/platform/
  architecture fingerprint. App config declares Cargo inputs/shared inputs.
- `_prepare_native_build(..., build=False)`: compute selected cache path and
  verify usability/ABI compatibility receipt without building/publishing.
- `_prepare_native_build(..., build=True)`: the same policy plus existing cache
  lock, Cargo invocation, changed-source rejection and atomic binary publication.
- `_prepare_native_workers`: assigns each declaration's environmentKey to its
  selected executable, but this is performed at bootstrap, not per app refresh.

The reusable core is not bespoke to Code TE2. The surrounding discovery/runtime
composition is currently incomplete:

- `_native_worker_registry` scans only app/apps/*/native_build.json. It does not
  use the same configured second/extra roots as the Rust app registry.
- The editable loop branches on worker.app_id == code_te2 for Python/mypyc/host
  environment setup. `_select_editable_domain` contains Code TE2-specific policy.
- The packaged path assumes exactly one Code TE2 worker and imports its specific
  private-runtime provider. Packaged validation must remain strict, but provider
  selection should be generic and app-owned, not weakened or silently bypassed.
- Code TE2's shellspec reads CODE_TE2_WORKER_BIN. A running framework's inherited
  environment retains the old selected value even after a separate build publishes
  a new fingerprinted executable. Rereading that variable is not re-resolution.

Observed failure: the user built a current executable with feed_frames, while the
framework launched the older cached worker without that method against a newer
domain. This is a launch-context selection issue, not proof of a broken compiler
cache. Existing executables cannot be replaced in memory by catalog refresh.

## Production coupling inventory

Line locations are orientation only; source wins if subsequent edits move them.

| Source / owner | Coupling found | Direction using existing facilities |
|---|---|---|
| app_intent_pipe.rs, allowed (around L520) | Fixed target and caller app allowlist for app.intent.dispatch | Receiver manifest exports/authorization, analogous to existing ipc.services; typed target hooks still own intent payload policy |
| app_intent_pipe.rs, add_mcp_shortcut (around L550) | Hardcoded recipient for shortcut integration | Manifest-declared capability/provider; explicit provider selection and ambiguity rejection; no first/global-active fallback |
| native_mcp.rs, wba_program / WBA dispatch | App Python import assembled in framework; fixed parent app check | Worker-owned typed debug operation advertised as a capability, through existing authenticated exact-target debug owner; preserve credentials/incarnation/cancellation, not arbitrary import strings |
| app_proxy.rs, code_te2_agent_cors_headers | App-specific agent path and localhost origin/port policy | Validated manifest proxy/CORS policy with exact bounded paths/origins/methods; no default wildcard broadening |
| apps_lifecycle.rs, app_bootstrap_payload | Fixed app/legacy state key migration | Explicit app-owned migration declaration; aliases alone must not unexpectedly move unrelated persisted state |
| frontend_assets.rs, service_worker | Reads one app's private version.txt path | Reuse existing asset-bundle manifest version_file / generic asset version owner; preserve published cache semantics |
| bootstrap.py native worker setup | App-specific editable/packaged domain and environment policy | Native runtime declarations plus app-owned preparation/validation, reusing common selector/ABI/receipt rules |

Already generic pieces to preserve: AppRegistry aliases/id resolution, configured
app root ordering, asset-base/entrypoint lookup, proxy_shell declarations,
manifest sio_service parsing, and app.rpc.call policy from ipc.services with
caller/method/version/byte/time limits. Do not introduce parallel permission tables.

The asset bundler in android_assets.rs already reads its version_file from JSON;
app names in its tests do not mean the production bundler hardcodes those apps.
Likewise, generic data keys such as settings/terminal are not automatically app
identities; inspect their use rather than mechanically replacing words.

## Why Refresh is incomplete today

All current buttons are wired: framework app launcher extension, Electron shared
shell, Gecko/Cefrium Android launcher, and TE2 Termux's shared shell adapter reach
POST /api/apps/reload (Android through its existing gateway).

`reload_apps_data` rereads AppRegistry from configured roots, replaces the app
registry and reconciles running records, then publishes registry/catalog events.
Frontend templates/scripts and generic app-worker proxy lookup already consult
current registry snapshots. Native-client buttons need no speculative rewire.

However, main.rs constructs SioRouteIndex once and app_proxy.rs registers concrete
physical Engine.IO mounts once on the Axum router. Registry replacement does not
replace either map. New/changed/removed Socket.IO/service aliases can therefore
disagree with the refreshed catalog. The immutable bootstrap child environment
is a separate stale selection source; a route refresh alone does not fix it.

## Staged implementation proposal

### A — Generic native runtime selection contract

First derive a bounded declaration/selection plan before implementing Refresh:

1. Reuse existing native build manifests and shared fingerprint/ABI/cache receipt
   validation. Discover declared app runtimes from the same authorized app roots,
   including second-root apps; do not recursively scan arbitrary project trees.
2. Move Code TE2 editable/private-runtime/mypyc policy into app-owned declarations
   or a narrowly invoked app-owned provider. Prefer declarative policy where
   sufficient. Do not execute imports/build scripts merely because refresh sees
   a new manifest; existing launch/build authority and trust boundaries remain.
3. Define a reusable **no-build selection** result: exact executable, app-owned
   runtime/ABI context and declaration/receipt generation. Refresh prepares a new
   future-launch context rather than mutating process-global environment.
4. Select current usable cached artifacts, never an arbitrary newest mtime or an
   unverified Cargo output. Missing/incompatible current artifacts report build
   required; no automatic Cargo/mypyc compile or fallback under Refresh.
5. Choose how the Rust lifecycle consumes the existing resolver contract before
   editing: a generic narrow preparation owner or validated atomically published
   selection receipt are candidates. Do not independently reimplement Python's
   fingerprint algorithm in Rust. Preserve explicit user overrides and packaged
   no-build validation. Stage A2 below selects the existing private sidecar owner;
   actual lifecycle/catalog integration remains Stage B.

Tests must use at least two neutral app identities, both root positions, alternate
environment keys, distinct binaries and changed runtime context, so a disguised
Code TE2-only branch cannot pass. Cover stale receipt, missing artifact, explicit
override, runtime compatibility and concurrent source/publication changes.

### B — Atomic catalog/routes/launch-context refresh

Build a fully validated candidate generation off-loop from configured roots, then
publish registry, declared service routes and eligible future-launch contexts as
one coherent snapshot. Preserve built-in/user root precedence and alias policy.
Do not partially update those owners or reconcile over concurrent launches from
an older snapshot. Define serialization/lock order with existing lifecycle owners.

Make new declared physical routes reachable without remounting the whole Axum
router. The next concrete design must address precedence, protected framework
paths, collisions, encoded paths, base/trailing/wildcard forms and old aliases;
simply swapping an Arc of routes cannot add an absent physical router mount.
Do not let an app declaration hijack framework APIs. Invalid/conflicting candidate
generations should return actionable diagnostics and preserve the prior usable
generation, not silently lose routes while saying Refresh succeeded.

Keep active workers and upgraded connections alive. New HTTP/upgrade/launch
requests use the published generation; established connections retain exact old
owners until normal close. Removed definitions must not terminate their processes
or mutate disk state as a side effect. Define/report removal and changed-worker
restart requirements rather than claiming running code reloaded.

Reuse POST /api/apps/reload and the existing catalog event lane. Return a bounded
generation/change summary and app-specific build/restart-required diagnostics;
frontend controls remain intent/feedback only. Prefer server-only restoration
when existing controls can present the result; native source changes/publication
require separate explicit scope if richer feedback actually needs them.

### C — Migrate app-specific broker and ancillary policy

Remove runtime identity branches from the inventory in independently approved,
testable groups: intent/provider authorization, exact-target MCP/debug routing,
proxy CORS, explicit state migrations and shared asset version lookup. Declare
policy in owning app metadata/hooks; do not replace literals with a framework
config file containing the same hardcoded built-in table.

Preserve permissions, caller proof and stale-incarnation fences. Provider absence
and multiple providers are explicit errors/choices, never silent app selection.
Public MCP tool compatibility and legacy persisted state need regression gates.

### D — Guardrails and acceptance

Use neutral fixture identities in generic framework unit tests; relocate concrete
app integration fixtures under the app-owned tests where appropriate. Add a
source-policy regression for built-in app identity/import/path literals in
production framework code, with no blanket ignore of an entire runtime file.
Allowed framework protocol/service names are distinct from built-in app identity.

Validate second-root add/change/remove and future executable change through the
real reload API on an isolated server, including active worker/connection survival,
rejected generation rollback, concurrent reload/start, exact permission behavior
and prior installed app compatibility. No shared runtime is the test fixture.
Only afterwards obtain approval for a real framework transition and client groups.

## Ordering and boundaries

This agnostic correction/Refresh design takes precedence over the previously
proposed network RPC optimization; the latter remains planned, not implemented.
Accepted PyO3 source and user-reported live outcomes are not discarded. No new
version/tag/release work, cleanup, app migration, worker restart or Android change
is implied by this audit. Stage A1 is now source-complete; the Rust-facing
selection exchange and live refresh remain separate design/approval gates.

## Stage A1 implemented contract

Bootstrap respects TE2_SERVER_APP_ROOTS instead of replacing it. Native discovery
visits immediate app directories with manifest.json in configured root order,
skips underscore-prefixed directories, and matches native appId against manifest
id, not directory spelling. First-root ownership also suppresses later native
declarations when the first app has no native worker. Selected declarations and
runtimeProvider paths must stay inside authorized roots/owning apps; conflicting
environment keys fail rather than silently retarget another worker.

select_native_build returns a frozen NativeBuildSelection containing executable,
receipt, fingerprint, compatibility and usability. It shares receipt checking
with actual preparation, preserving framework-source-v2 bytes, pre-receipt
framework reuse and strict Python-ABI receipts. It reads source/cache only; it
does not import app providers, create caches or compile. It is not yet a wire
protocol or authorization to run it from Rust. Concurrent publication/selection
generation fences for live refresh remain A2/B work.

Optional runtimeProvider names a Python file directly inside the owning app.
During explicit bootstrap preparation only, its prepare_runtime receives the
typed app.cli.native_runtime.NativeRuntimeContext and returns NativeRuntimeResult
(environment updates/removals and optional packaged executable). Providers are
trusted app code, not a sandbox; discovering/selecting declarations does not
execute them. Editable providers cannot replace Cargo selection; packaged apps
must supply their validated executable and cannot fall back to Cargo. Environment
updates publish only after every selected worker prepares successfully. This is
environment atomicity, not rollback of completed explicit builds.

Code TE2's provider owns all CODE_TE2_* setup, private-runtime validation and
editable mypyc selection. It does not change ordinary shellspec or user overrides.
Python source/package discovery includes the new app/cli and app-owned modules;
no new runtime dependency, static frontend asset or Android mapping is required.
Installed-package execution still requires package/release validation separately.

## Stage A2 — private read-only selection exchange

User separately approves this contract/owner/client slice and later explicitly
approves focused Cargo unit-test compilation only. No production artifact build,
framework/worker restart, live refresh, Android change or publication is included.

The existing Python runtime bridge mounts POST /internal/native-runtime/select.
It requires its existing x-te2-owner-key capability; there is no public framework
proxy or MCP registration for this endpoint. A caller may submit only
`{"schema_version":1}` (4 KiB ingress limit); roots, profile, environment and
provider paths are not request-controlled. No body/credentials are logged.

Explicit bootstrap preparation now exports TE2_NATIVE_SELECTION_CONTEXT, a
versioned msgspec contract bounded to 64 KiB (below per-string exec limits).
It carries the chosen profile/mode plus per-app declaration/provider/manifest
digest, selected executable and app-provider environment updates/removals.
Packaged executable SHA-256 is captured with bounded streaming reads. It does
not expose or copy the whole inherited environment, and is not a disk selector.
Publication remains part of the existing all-workers-or-none environment update.
Declaration/provider changes across preparation refuse a fresh receipt;
selection also rechecks its parsed declaration before returning. Identity queries
do not prepare this context. These checks are not the complete Stage B filesystem/
catalog concurrency fence.

The owner captures its own startup environment, invokes the installed bootstrap
through the existing installed/source locator, and calls native_selection_snapshot.
That function reuses native discovery/fingerprint/ABI/cache receipts; it never
imports app providers or invokes Cargo/mypyc. Provider setup is reused only if
the bootstrap receipt still matches the owning declarations/provider. A new or
changed provider reports preparation_required. Missing/incompatible editable
artifacts report build_required. Packaged selection uses the bootstrap-validated
receipt and rechecks executable hash/usability; no Cargo fallback exists. Full
private-domain payload validation remains app-owned at explicit preparation and
worker startup, not a repeated import of app policy during manifest scans.

SelectionSnapshot contains schema version, profile, packaged mode, generation
digest, and typed WorkerSelection entries (app ID, environment export key,
declaration digest, ready/build_required/preparation_required, executable,
fingerprint and prepared app environment delta). The generation hashes this
projection; it is NOT yet an atomic catalog-generation or file-transaction fence.
Stage B must reconcile the candidate registry, routes and launch context together,
including concurrent declaration/source/publication and active-owner changes.

Responses are no-store and bounded to 1 MiB. One off-loop resolution is admitted
per owner; concurrent requests get 503 rather than queueing scans. Cancelling the
HTTP request does not release admission before its scan finishes. Invalid
manifests/SystemExit become controlled 503 errors, not sidecar loop termination.
Missing startup context is preparation_required/503; old peers never silently
fall back to a separate resolver or inherited path.

The Rust native_selection client is compiled but not called by lifecycle/reload.
It accepts only explicit numeric-loopback HTTP owner URLs and a supplied key,
uses a dedicated no-proxy/no-redirect/no-retry client with a 30-second bound,
checks status before bounded response reading, and strictly decodes/validates
schema/profile/status, IDs, environment keys, duplicate exports and ready paths.
This introduces no app literals or second fingerprint implementation. Native
routes, registry publication, launch behavior and existing running owners are
not cut over by A2. A matching bootstrap/sidecar must be adopted before any future
caller is enabled; source/test success does not establish live activation.
