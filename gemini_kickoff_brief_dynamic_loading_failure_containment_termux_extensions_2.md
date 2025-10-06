# Gemini Kickoff Brief — Dynamic Loading & Failure Containment (termux-extensions-2)

**Goal:** Apply a generic, manifest‑driven integration that (a) makes app/extension loading non‑fatal, (b) supports conditional imports with graceful errors, (c) enables worker fallbacks, (d) keeps risky work inside Jobs, and (e) tags/tears‑down Framework Shells by **group/role/parent**. This is framework‑only and applies to **all apps discovered via `app/apps/*/manifest.json`**.

> Reference pack: **te_dynamic_loading_pack_v3.zip** (attached in chat). Use `INTRO.md` → `STEP01…STEP06` as the source of truth.

---

## Hard Constraints (do not violate)
- **Entry point:** `scripts/run_framework.sh` is the only launcher. Do not change its semantics.
- **Discovery:** Apps are discovered exclusively via **`app/apps/*/manifest.json`**; do not change manifest schema.
- **Routing:** The **Apps extension** provides `/api/apps`, `/apps/<dir>/…` (assets), and `/app/<id>` (shell). Do not alter launcher or shell UX.
- **Jobs:** Keep SSE progress streaming exactly as‑is. No framework‑wide refactors, no repo reset, no lint/test scaffolds unless explicitly requested.

---

## Files to Add / Modify

### Add (new)
1. `app/utils/optional_import.py` — helper that returns a **MissingModule** sentinel instead of throwing on import failures.
2. `app/utils/shell_groups.py` — `spawn_scoped_shell()` that stamps `TE_ROLE`, `TE_GROUP`, optional `TE_PARENT`; `terminate_group()` to cascade shutdown.

### Modify (patch)
1. `app/main.py` — make **dynamic loader non‑fatal** for apps & extensions (wrap `exec_module`, record `__load_error__`/`__load_warning__`, skip registration on failure).
2. `app/extensions/apps/main.py` — generic backend that:
   - lists apps from `app/apps/` (`/api/apps`),
   - serves per‑app assets (`/apps/<dir>/…`),
   - renders the app shell (`/app/<id>`),
   - **safely** auto‑registers any app backend blueprint (non‑fatal on errors).
3. `app/templates/app_shell.html` — small `pagehide` hook that POSTs `{group}` to `/api/framework_shells/terminate_group` so **all shells tagged with this view's group** are torn down when the user leaves.

> All diffs and file blobs are provided in **STEP01…STEP06** of the v3 pack.

---

## Implementation Order
1) **STEP01_NON_FATAL_LOADER.md** → Patch `app/main.py` loader to be non‑fatal.
2) **STEP02_OPTIONAL_IMPORT.md** → Add `app/utils/optional_import.py`; convert any risky endpoint imports to use it (call‑site import, JSON error on miss).
3) **STEP03_WORKER_FALLBACK.md** → Use Framework Shells for heavy/unsafe deps (child process import; idle reaper). Keep parent process thin.
4) **STEP04_JOBS_FAILURE_ISOLATION.md** → Ensure jobs attach to subprocesses; failures don’t crash Flask.
5) **STEP05_SHELL_GROUPS_AND_BREADCRUMBS.md** → Add `spawn_scoped_shell()` and `terminate_group()` helpers; expose `POST /api/framework_shells/terminate_group`.
6) **STEP06_GENERIC_APPS_EXTENSION.md** → Wire the generic Apps extension backend + `pagehide` teardown hook. **No app‑specific wiring.**

---

## Output Format (what to return)
- **Unified diffs** for modified files.
- **Full file blobs** for new files.
- A short **CHANGELOG** summarizing exactly what changed where.

Do **not**:
- Reformat unrelated files or apply repo‑wide lint rules.
- Introduce new build/CI tooling.
- Rename or restructure app folders or manifests.

---

## Acceptance Tests (must pass)

### 1) Non‑fatal loader
- Add a dummy app under `app/apps/bad/` whose backend raises on import.
- Start framework; `GET /api/apps` lists `bad` with `__load_error__`; server stays up.

### 2) Apps extension routing
- `GET /api/apps` returns manifest list with `_dir`, `entrypoints`.
- Navigate to `/app/<some_id>` → shell loads; shell fetches `/apps/<_dir>/<template|script>` and renders.

### 3) Group teardown on close
- Open an app that spawns shells with `TE_GROUP=window.__teAppGroup`.
- Close the page (or navigate away). Server receives `POST /api/framework_shells/terminate_group` and all shells in that group disappear from `list`.

### 4) Optional import behavior
- Hit an endpoint that does `optional_import("PIL")` on a host without PIL. JSON error returned; Flask remains healthy.

### 5) Worker fallback (spot‑check)
- Endpoint falls back to a child worker when import fails; child responds; killing it does not affect Flask.

---

## Quick Commands (manual spot‑checks)
```bash
# list apps
curl -s http://127.0.0.1:8080/api/apps | jq '.data | map({id, __load_error__})'

# simulate app shell teardown (replace GROUP)
curl -s -X POST http://127.0.0.1:8080/api/framework_shells/terminate_group \
  -H 'Content-Type: application/json' -d '{"group":"app:demo:1700000000000"}'
```

---

## Notes for the Model
- Keep **SSE jobs streaming** unchanged.
- Use **call‑site imports** for heavy deps in endpoints; prefer **worker processes** for unsafe C‑exts.
- Always tag child shells with `TE_GROUP` from the app shell (`window.__teAppGroup`).
- Do not add iframes; the app shell is already full‑screen inside the Apps extension template.

---

## Deliverables Checklist
- [ ] `app/main.py` patched (non‑fatal loaders)
- [ ] `app/utils/optional_import.py` added
- [ ] `app/utils/shell_groups.py` added
- [ ] `app/extensions/apps/main.py` implemented (generic backend)
- [ ] `app/templates/app_shell.html` pagehide → terminate_group hook
- [ ] Diffs + new file blobs + short CHANGELOG

