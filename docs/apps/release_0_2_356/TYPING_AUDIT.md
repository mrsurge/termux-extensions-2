# Code TE2 strict / Any audit

## Post-audit mypyc import correction

The user's full build completed 310 C targets but failed snapshot import
validation. Retained output reproduces a TypeError at runtime_checkable applied
to compiled NativeEventHandler: mypy success did not prove runtime Protocol
identity. Separately approved native_runtime_contracts.py keeps that definition
and QueueSizeReader interpreted; implementation modules remain compiled.
Strongest audit now passes all 247 files. A real two-module mypyc regression
compiles/imports the implementations and exercises both protocol checks.
Full new-domain build/activation remains a separate gate; failed outputs are
not published or activated. This does not relax the typing policy.

Subsequent compiled runtime validation exposed the equivalent msgspec schema
seam in host/sidebar_rpc_backend: nullable coordinates and qualified identity
fields were erased to runtime `type`. Three Struct definitions now live in
already-interpreted ui_ipc/sidebar_rpc_contract.py; dispatch stays compiled.
A real compiled first-call file-open regression also identified lazy module
initialization depending on an earlier CWD call; the separately approved direct
module import removes that ordering dependency. The expanded three-module
fixture validates schemas plus actual owner dispatch; strongest static audit
still passes 247 files. Fresh full-domain activation/live acceptance is pending.

## Reproduction and scope

2026-10-21, starting source checkpoint `61f33c70`, repository `.jitenv`,
CPython 3.14 and mypy 2.3.0 (compiled). The original user report
`mypy_typecheck_errors.txt` is preserved unchanged and remains untracked.
It does not contain its invocation or tool version; this is a reproducible
reconstruction of the requested strict/extra/all-Any policy, not a claim that
the original invocation is known exactly.

Run from `app/apps/code_te2`, using the repository interpreter:

```bash
../../../.jitenv/bin/python -B -m mypy \
  --config-file ../../../pyproject.toml \
  --strict --extra-checks \
  --disallow-any-expr --disallow-any-decorated \
  --disallow-any-explicit --disallow-any-generics \
  --disallow-any-unimported --disallow-subclassing-any \
  --no-incremental --cache-dir=/dev/null .
```

The initial run checks 245 files and reports 323 diagnostics in 75 files:
297 outside `tests/`, 26 in tests. Non-test includes build helpers, not just
runtime modules. These command-line flags do not change durable build policy.

## Approved staged cleanup

User approves the staged production/test cleanup, beginning with callbacks,
transport wrappers and worker lifecycle. No new Any, unchecked casts, diagnostic
suppressions or weakened checks. Preserve runtime behavior, existing owners,
lazy import boundaries and the original report. No compilation/activation,
restart, commit or publication is included.

The user subsequently approves a local checkpoint and continuation; the first
slice is committed as `039e38bf`. No push or version bump. The continuation below
remains uncommitted until separately requested.

1. Native FWS callbacks, namespace dispatch, editor/terminal transport and worker
   lifecycle; then project/Git service hooks.
2. Remaining event/DTO ingress, retained state and service projections.
3. Build/overlay helpers and test fixtures; distinguish third-party stub seams
   from local contracts rather than replacing precise types with opaque objects.
4. Full stronger check and owner regressions before the next approved mypyc build.

## First slice

- Native FWS observer registers explicit zero-argument connect/disconnect and
  one-payload notification callbacks instead of a variadic registry. The old
  connect-error registration was never dispatched by this native observer; its
  existing error/reconnect behavior is unchanged.
- Native namespace lookup checks callability at its existing dynamic event
  boundary. Event owners retain concrete signatures/DTO validation; wrong arity,
  raised failures and cancellation retain existing dispatch semantics.
- Background-task arguments/results use ParamSpec/TypeVar. Worker shutdown
  records task results as object because cancellation never interprets them.
- Editor wrappers and terminal shell helpers directly invoke already typed
  methods. No new transport, session owner or terminal implementation.
- Project-switch helpers use lazy typed imports, not importlib/getattr plus
  callable assertions. Imports remain inside the same call-time boundaries.
- Git/project actions retain their actual owners and off-loop execution. Unused
  results are discarded as statements instead of assigning generic results to
  `_`, which can feed Any context back into generic call inference. No new
  mutation wrapper, guard removal, retry or thread hop.
- Native-exclusion mismatch found during this pass has separately approved
  correction: `skipSid` accepts null, one string or a list of strings; malformed
  lists reject before fan-out. Python adapters preserve the full list. Rust
  tests cover empty/single/multiple lists and malformed input. This fixes a real
  transport gap, not merely an annotation.

The refreshed full check reports **215 diagnostics in 65 files**: 189 outside
tests, 26 in tests. All 11 production modules changed in this slice pass the same
stronger flags (also checked independently with `--follow-imports=silent`).
No general compilation-time improvement follows from these counts alone.

Remaining larger clusters include build/overlay helpers (20), diagnostics
metrics (9), Sidebar window state (9), editor backend (9), HTTP/asset seams,
retained sidecar/projection dictionaries and lifecycle futures. Group these by
boundary; a diagnostic is not necessarily an independent defect.

## Continuation — remaining report closed

After `039e38bf`, the same full invocation now succeeds for **all 246 source
files** in the Code TE2 tree, including its Python tests and build helpers.
The source count increased by one for `http_contracts.py`. The new root regression
file `tests/test_code_te2_typed_ingress.py` independently passes the same stronger
flags with `--follow-imports=silent`; it is outside that 246-file tree.

- Retained state/future maps discard unused removals directly; task identities
  carry object result types without interpreting them. Shielding, cancellation,
  conditional cleanup and no-replay semantics are unchanged.
- Named typed sorting functions preserve revision ordering, eviction, stable
  migration precedence, directory depth and autosave due-time selection.
  Autosave compares the two known tuple fields directly instead of relying on
  the heterogeneous tuple-slice stub. It does not alter commit lineage or mode.
- Concrete lazy imports replace reflective File Explorer/watcher service calls.
  Existing operations, import-cycle boundaries and thread ownership remain.
- Editor boot/open callbacks declare the actual keyword signatures. Editor
  preferences/diff objects reject non-string keys instead of asserting their
  type; cached editor content retains its missing-attribute fallback.
- `http_contracts.path_parameter` validates string path converters in retained
  Python HTTP resource adapters. Existing paths, traversal guards, headers and
  native serving ownership remain. Heterogeneous framework/library values are
  narrowed at their ingress; no new runtime dependencies or transports.
- Argparse receives an annotated Namespace with the same flags/defaults. Legacy
  mypyc manifests validate root/module maps, source lists and strings before
  modifying import state. Schema-v2 validation stays with its existing owner;
  selectors, missing-artifact errors and compilation/activation commands remain.
- A concrete decorator annotation specializes the existing stdlib lru_cache
  boundary; no cache replacement, eviction or concurrency policy change.
- Mock/HTTP fixtures and expected lists have explicit shapes. Their original
  assertions remain, rather than skipping tests or suppressing Any diagnostics.

Final combined owner regression run: **337 passed, 20 subtests passed**. Coverage
includes the first slice plus DTO ingress, valid/invalid legacy overlay selection,
boot/editor RPC, sidecar metrics, Python resource routing, developer build command
resolution, drafts/review/autosave, diagnostics, Sidebar state/identity, History,
run profiles, themes, marketplace and terminal projection. No native extension is
built or loaded by the synthetic overlay test; its temporary file tests finder
selection only. The user report retains SHA-256
`55e06c59ffaad42222106ce7cc5f66b19083a31c52b28d436be03cff9eb08f6b`.

No new Any annotations, casts, ignores or checker suppression escapes were added.
`pyproject.toml` remains unchanged: this stronger audit is not a silent build-policy
change. Mypyc/native compilation and live adoption remain separate gates. Passing
mypy does not establish mypyc code-generation success or compile-time improvement.

## Validation and activation boundary

Focused regressions cover native namespace dispatch, FWS callback order/snapshot
barrier/shutdown, terminal transport, worker lifecycle, run profiles, app RPC,
project switching/hydration/autosave and historical Git guards. The broader run
also exposed two prior-cutover test expectations missing the existing optional
`before_switch=None`; update those assertions, not the production guard.

First-slice grouped Python result: **163 passed, 15 subtests passed**. All 11 changed
production modules also pass the independent stronger check. `git diff --check`
and the explicit native-file `rustfmt --check` pass.

Rust exclusion tests are source-added and formatting-checked, **not executed**:
the user explicitly requested no rebuild. No Rust/mypyc production build or
activation was performed. Matching native worker compilation is required before
claiming list-exclusion delivery is live. No frontend assets changed.

The user reports current interpreted Code TE2 works well; this does not close all
formal multi-client/standalone cutover acceptance gates. Progress/results are
maintained in this workstream's TRACKER.md.
