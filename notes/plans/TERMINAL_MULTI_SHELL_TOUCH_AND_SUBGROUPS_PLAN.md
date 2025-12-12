# Terminal Drawer: Touch UX + Per‑Project Multi‑Shell + Framework Subgroups

**Date:** 2025-12-12  
**Scope:** `file_editor_cm6` terminal drawer, `framework_shells`, `sessions_and_shortcuts`  
**Status:** Draft – ready for implementation

---

## Goals (High Level)
1. **Make xterm.js touch‑friendly** without changing SSOT rules.
2. **Support multiple PTY shells per project** in Code CM6, backend‑owned, with simple numbering.
3. **Add app‑defined “subgroups” to framework shells** and surface them in Sessions & Shortcuts.

---

## Constraints / Non‑Goals
- **Frontend is project‑blind.** No localStorage/cookies/URL state for project selection. Shell selection is via backend endpoints only.
- **Subgroups are app‑defined strings.** Framework stores/echoes them; it does not interpret semantics.
- **No auto “project → shell” inference in JS.** Backend decides the active project/shell and forces WS reconnects.
- Avoid unrelated UI/aesthetic refactors.

---

## Phase 1 — Per‑Project Multi‑Shell (Code CM6)

### 1.1 Sidecar / SSOT schema
Extend `ProjectSidecar` data:
- `terminal_shell_ids: []` (ordered by creation time)
- `active_terminal_shell_id: null`
- Optional cap: `terminal_shell_cap` (default e.g. 5; oldest trimmed on insert)

Lazy migration:
- If sidecar lacks `terminal_shell_ids` but has legacy `terminal_shell_id`, seed list `[legacy]`, set active to legacy, then clear legacy slot.

### 1.2 Backend endpoints (terminal_backend.py)
Add:
- `GET /terminal/shells`
  - Returns ordered shells for active project, plus which one is active.
  - Include only live shells by default; allow `?include_exited=1` if desired.
- `POST /terminal/shells`
  - Spawn new PTY shell for active project.
  - Append to `terminal_shell_ids` (trim to cap), set active.
  - Return new shell metadata + label.
- `POST /terminal/shells/{shell_id}/activate`
  - Validate shell is live and in this project’s list.
  - Set `active_terminal_shell_id = shell_id`.
  - Call `close_active_terminal_sockets()` to force drawer WS rebinding.
- `DELETE /terminal/{shell_id}`
  - Destroy shell.
  - If the shell is in this project list, remove it.
  - If it was active, set active to newest remaining or auto‑create fresh.

### 1.3 Shell creation / labels
Update `create_editor_shell(...)`:
- Stable base label per project (already implemented).
- Add sequence suffix for multi‑shell (`:1`, `:2`, …) based on list length.

**Display name rule (frontend):**
- “Terminal XXXX” where `XXXX` is last 4 of `fs-id` (framework shell id).
- Ordered first‑opened first, etc.

### 1.4 Terminal drawer UI
Modify terminal header:
- Replace static “Terminal” title with a dropdown selector.
- On open, call `GET /terminal/shells` and populate:
  - Active shell shown as title.
  - List items: “Terminal XXXX” (last 4 chars), ordered.
  - “+ New terminal” item → `POST /terminal/shells`.
- Selecting a shell calls `POST /terminal/shells/{id}/activate`.

No project logic in JS; only consumes backend shell list.

---

## Phase 2 — Framework Shell Subgroups

### 2.1 Schema + manager
Extend `ShellRecord` (`app/libs/framework_shells.py`):
- `subgroups: List[str] = []` (serialized to meta JSON, exposed in API).

Update spawn endpoints:
- Accept optional `subgroups` array in `POST /api/framework_shells` and `/spawn_pty`.
- Validate is list of non‑empty strings; store as‑is.

No manager behavior change beyond storage/echo.

### 2.2 App usage (Code CM6 terminals)
When spawning project terminals:
- Set `subgroups` to include:
  - `app:file_editor_cm6`
  - `project:<label or path hash>` (exact string app‑defined)

This enables external discovery/cleanup by subgroup without app‑side orchestration.

---

## Phase 3 — Sessions & Shortcuts Hygiene + Subgroup UI

### 3.1 Snapshot partitioning
Update sessions extension backend snapshot (or client filtering) to:
- Separate `running` vs `exited` framework shells.
- Ensure `shell_trees` only contain live children.

### 3.2 UI grouping
In `app/extensions/sessions_and_shortcuts/main.js`:
- Group framework shells first by **app worker / app label** (current behavior).
- Within each app, group shells by `subgroups` intersection:
  - If multiple subgroup strings, allow multiple placements OR pick first matching app‑namespace subgroup.
- Render subgroup headers (collapsible).
- Exited shells appear in a separate “Exited” section (collapsed by default) with Purge action.

### 3.3 Termination semantics cleanup
- Use subgroup/group labels for “kill app + children” where possible.
- Make “Terminate” vs “Purge metadata/logs” explicit in UI.
- Ensure stale metadata never shows as running (sweep/adoption already marks exited).

---

## Phase 4 — Touch UX for xterm.js (TOUCH_XTERM-JS.md)

Implement in terminal drawer JS/CSS:
- **Mobile tuning:** larger font/lineHeight, smooth scroll, narrower/hidden scrollbar on coarse pointers.
- **One‑finger scrollback:** touch drag → `term.scrollLines()` (selection mode disables scroll handler).
- **Selection mode:**
  - Long‑press enters selection mode.
  - Touch‑drag maps to mouse drag (mousedown/mousemove/mouseup) to use xterm selection.
  - Double‑tap selects word.
  - Show Copy/Clear bar on selection (`term.getSelection()` → Clipboard API).
- **Keyboard focus affordance:** tap to focus; optional “show keyboard” button.

---

## Deliverables
- Multi‑shell: sidecar fields, terminal endpoints, drawer dropdown, stable numbering.
- Subgroups: `ShellRecord.subgroups`, API plumb‑through, sessions grouping UI.
- Touch: scroll, selection, scrollbar rules, copy bar.

---

## Open Questions (to confirm during implementation)
- Default `terminal_shell_cap` value (suggest 5) and whether to expose in Settings.
- Whether Code CM6 should ever show exited shells in its own dropdown (default: no).

