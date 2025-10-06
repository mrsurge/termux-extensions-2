# Dynamic App Loading & Failure Containment — Implementation Guide (final)

This pack hardens your framework so **broken app modules never crash the server**, and heavy/fragile deps **load on demand** with safe fallbacks. It’s generic and manifest‑driven (works for all apps under `app/apps/*/manifest.json`).

**Steps**
1. `STEP01_NON_FATAL_LOADER.md` — make dynamic loading non‑fatal.
2. `STEP02_OPTIONAL_IMPORT.md` — add `optional_import` helper.
3. `STEP03_WORKER_FALLBACK.md` — child workers for heavy/unsafe deps.
4. `STEP04_JOBS_FAILURE_ISOLATION.md` — jobs attach + safe failure.
5. `STEP05_SHELL_GROUPS_AND_BREADCRUMBS.md` — `TE_GROUP`/`TE_ROLE` + terminate group.
6. `STEP06_GENERIC_APPS_EXTENSION.md` — generic Apps extension backend + app shell lifecycle.

Follow in order. Each step includes diffs/new files/paths and a breadcrumb to the next.
