# Goal

Split **Framework Shells** into a standalone, platform-agnostic Python package **without breaking TE2**, while adding a simple, robust separation model so two independent runtimes (e.g., two clones of the same repo) can run concurrently without cross-adoption or cross-control via the provided control surfaces.

This document is written for an agent that will implement the refactor.

---

# Current Reality (TE2)

## What TE2 currently relies on

* **TE2 is a multi-process platform**: a supervisor starts the framework, an IPC server orchestrates shutdown, and app workers run in their own subprocesses.
* **Apps are “framework shells”**: worker processes are spawned and managed via the shell manager. The platform assumes the shell manager is the runtime substrate.

### Supervisor responsibilities (deep integration today)

The supervisor:

* creates/ensures `TE_RUN_ID`
* launches the framework process group
* delegates shutdown to IPC (`POST /actions/shutdown`), with a fallback direct kill
* cleans up run id file

See: `supervisor.py`.

### Framework responsibilities (current main)

The framework main:

* registers itself with IPC at startup
* loads services/extensions/apps
* starts background lifecycle tasks
* starts a framework shell log monitor
* proxies HTTP + WS to app workers
* exposes *internal shell control endpoints* guarded by `TE_FRAMEWORK_SHELL_TOKEN` via `X-Framework-Key`

See: `main.py`.

### Apps extension responsibilities

The apps extension:

* starts/opens/quits/locks/unlocks apps by interacting with the lifecycle/app_manager
* provides a shell log viewer and a WS tail endpoint

See: extension `main.py`.

### App example dependency

Code CM6 explicitly depends on Framework Shells for:

* PTY terminal drawer
* spawning shared daemon-like services (e.g., MCP)
* log capture, adoption, stats

See: Code CM6 README.

---

# Why the split is valuable

* Framework Shells can be installed into *any* python environment and immediately provide a capable process control plane.
* TE2 becomes a consumer of a stable library contract instead of a special-case environment.
* The shell system becomes easier to document, test, and harden.

---

# Hard Boundary (Non-negotiable)

## “Your mileage may vary” OS limit

If two runtimes share the same OS user, they can often signal each other’s processes at the OS level. The library cannot prevent that.

What we **must** guarantee:

* runtimes do not **count** each other’s shells
* runtimes do not **adopt** each other’s shells
* runtimes cannot **control** each other’s shells via the library’s control surfaces

---

# Target Architecture (Standalone Framework Shells)

## Package layout

Create a new repo/package (example name):

```
framework_shells/
  __init__.py
  manager.py
  record.py
  store.py
  pty.py
  metrics.py
  hooks.py
  auth.py
  api/
    fastapi_router.py
    pty_routes.py
  cli/
    main.py
```

## Core principles

* **Core is host-agnostic**: no imports from TE2 (`app.*`, IPC, app_manager, etc.)
* **Transport is optional**: FastAPI router lives in `api/` and depends on the core, not vice versa.
* **Policy is injectable**: registry hooks, settings providers, eviction policies are adapters.
* **Namespace + capability** are first-class: runtime separation is not a “view feature,” it is part of record semantics.

---

# Runtime Separation & Control-Surface Hardening (Simple Mode)

## Single flag (developer experience)

Introduce a single runtime flag/env var:

* `FRAMEWORK_SHELLS_SECRET`

This one value enables:

1. **Runtime namespace** (prevents cross-count/adopt)
2. **Control-surface auth** (prevents cross-control via API)
3. **Record integrity signature** (prevents record tampering/spoofing across runtimes)

### Derivations

From `FRAMEWORK_SHELLS_SECRET` derive:

* `runtime_id = sha256(secret)[:16]` (or base64url short form)
* `api_token = HMAC(secret, "api")`

Persist into each record:

* `runtime_id`
* `record_sig = HMAC(secret, canonical_json(record_without_sig))`

### Behavioral rules

* `list_shells()` filters by `runtime_id` by default
* adoption only considers records with matching `runtime_id`
* record is trusted only if `record_sig` verifies
* mutating API endpoints require `Authorization: Bearer <api_token>`
* even with valid auth, record runtime_id must match current runtime_id

### Storage hygiene

Default store root becomes namespaced:

* `<base>/<runtime_id>/meta/...`
* `<base>/<runtime_id>/logs/...`

This avoids collisions even when users point two runtimes at the same base directory.

---

# What to Remove From the Core (TE2-specific coupling)

## Remove direct TE2 imports

The following patterns must not exist in the standalone core:

* `from app.main import get_setting`
* `from app.ipc.client import register_process/unregister_process`
* `from app.libs.app_lifecycle ...`
* any TE2-specific label semantics like `label.startswith("app-worker:")`

Replace with:

* `Config` object passed to the manager
* `Hooks` interface (optional) invoked on spawn/stop/remove
* optional `EvictionPolicy` interface

## Remove TE2 app wiring

The standalone repo should not include:

* app launcher logic
* worker proxy logic
* extension loader
* NiceGUI routing hacks

Those stay in TE2.

---

# What to Keep in the Core

## Keep

* process spawn (pipe + PTY)
* log capture
* persistence store + adoption
* metrics (psutil + fallback)
* grouping semantics (as first-class record field)
* subscriptions for output streams (for PTY and log tails)
* deterministic termination (term/kill + grace)

## Adjust

* grouping must be record-level (`record.group`) not derived from env visibility
* describe payloads must be explicit about what is included (env keys vs full env)

---

# What to Move Into Adapters / Reference Modules

## FastAPI reference router

Create a clean router that exposes:

* list / spawn / describe / action / remove
* optional PTY: spawn_pty / write / resize / stream

Keep it behind `Authorization: Bearer` when secret is set.

## Process registry integration

Define hooks:

```
class Hooks:
  def on_spawn(self, record): ...
  def on_stop(self, record): ...
  def on_remove(self, record): ...
```

TE2 provides a hook implementation that calls IPC registry APIs.

## TE2 Supervisor integration

Supervisor logic is not required for library users.
Provide it as either:

* a TE2-only module, OR
* an optional example (`examples/supervisor.py`) showing a best-effort orchestrator.

---

# TE2 Integration Plan (Keep TE2 working)

## Step 1: Vendor the new library into TE2 temporarily

* Add the new `framework_shells` package as a local dependency or submodule.
* Update TE2 imports (`app.libs.framework_shells -> framework_shells`).

## Step 2: Provide TE2 adapters

* `te2_framework_shells_hooks.py` implements hooks to IPC
* `te2_config.py` maps TE2 settings/env to `framework_shells.Config`

## Step 3: Replace TE2 internal token usage

TE2 currently has internal shell endpoints guarded by `TE_FRAMEWORK_SHELL_TOKEN` (`X-Framework-Key`).

* Map this to the library’s `Authorization: Bearer` mechanism.
* Keep TE2’s header option as a compatibility layer if needed (router adapter accepts both).

## Step 4: Runtime separation in TE2

* TE2 supervisor or entrypoint generates/loads a runtime secret when not provided.
* Each TE2 run writes its `FRAMEWORK_SHELLS_SECRET` into environment for framework and worker processes.

---

# Agent Task List (Implementation)

## A) Extract core

1. Create new `framework_shells` package with:

   * record + store + manager modules
   * PTY subsystem
   * metrics subsystem
   * subscription/output streaming primitives
2. Ensure no TE2 imports remain.

## B) Implement namespace + capability mode

1. Add `auth.py`:

   * `runtime_id_from_secret(secret)`
   * `api_token_from_secret(secret)`
   * `sign_record(secret, record_dict)` / `verify_sig(...)`
2. Add `runtime_id` + `record_sig` to record schema and persistence.
3. Update adoption/list/control paths to enforce:

   * runtime match
   * signature verification

## C) Implement reference FastAPI router

1. `api/fastapi_router.py`:

   * read-only endpoints remain public by default (configurable)
   * mutating endpoints require bearer token when secret set
2. Implement optional PTY routes.

## D) Update TE2 to consume the library

1. Replace imports in TE2.
2. Add TE2 hooks + config adapters.
3. Remove TE2-specific logic from the library.

## E) Tests / acceptance

Minimum acceptance tests:

* Two separate runtimes with different secrets, same base directory:

  * runtime A does not list B shells
  * runtime A does not adopt B shells
  * runtime A cannot terminate B shells via API
* Signature tamper test:

  * editing a record file invalidates it for adoption/control
* Backward TE2 behavior:

  * Code CM6 terminal and MCP spawning still work
  * app workers still spawn
  * log streaming still functions

---

# Line Drawing (What belongs where)

## Belongs in standalone Framework Shells

* record/store/manager
* PTY management
* log capture
* metrics and status
* grouping + labels
* runtime namespace + record signature
* capability auth for control surfaces
* reference router + CLI (optional)

## Belongs in TE2

* IPC server implementation
* process registry DB and shutdown orchestration
* app launcher, app proxy, extension loader
* app lifecycle policies (lock state, idle eviction, port assignment)
* NiceGUI routing hacks

---

# Questions for the Agent to Ask Early

To avoid multi-day drift, the agent should ask for:

1. The current `app/libs/framework_shells.py` (if not already provided in the working set).
2. Where TE2 stores shell metadata/logs today (confirm actual paths used by manager vs README docs).
3. The current IPC registry API contract (just enough to implement hooks cleanly).
4. The current app-worker spawn path (how shell manager is invoked to spawn workers).

---

# Notes / Known Couplings to Fix in TE2

* `app.main` currently imports `get_bridge` from Code CM6 (`get_bridge # This has to go... ASAP`). This must be removed from the framework entrypoint and moved behind an optional adapter/extension.
* TE2 currently implements internal shell endpoints (`/api/internal/shells/...`) guarded by `TE_FRAMEWORK_SHELL_TOKEN`. This should become a thin wrapper around the library router or be replaced with it.

---

# Success Definition

* Framework Shells becomes a pip-installable library with clean docs.
* TE2 remains fully functional with minimal adapter glue.
* Running two clones simultaneously is safe-by-default:

  * no cross-count
  * no cross-adopt
  * no cross-control via library surfaces
* Anything beyond OS boundaries is explicitly out of scope (“your mileage may vary”).
