# Agent Onboarding Guide: code_cm6 App

**For AI agents starting work on the Code CM6 editor app**

This guide provides a reading order and brief descriptions to help you understand the infrastructure from the ground up.

---

## Reading Order

### Phase 1: Framework Foundation (Read First)

Start with the main framework documentation to understand the infrastructure that code_cm6 runs on:

1. **[/GEMINI.md](/GEMINI.md)** — Project context, architecture overview, and agent workflow  
   *Read this first to understand how this Termux framework operates*

2. **[/REPO_STRUCTURE.md](/REPO_STRUCTURE.md)** — Directory structure and component organization  
   *Understand where everything lives in the codebase*

3. **[/docs/core/repo_overview.md](/docs/core/repo_overview.md)** — Deep dive into the framework architecture  
   *How apps, extensions, and the supervisor interact*

4. **[/docs/core/framework_shells.md](/docs/core/framework_shells.md)** — Framework shell PTY system  
   *Critical for understanding how background processes work (used by terminal & agents)*

### Phase 2: Code CM6 Core (App-Specific)

Now dive into the code_cm6 app itself:

5. **[/docs/apps/code_cm6/README.md](/docs/apps/code_cm6/README.md)** — Quick overview + documentation index  
   *Start here for code_cm6 - see features, architecture, recent updates*

6. **[/docs/apps/code_cm6/CODE_CM6_DOCUMENTATION.md](/docs/apps/code_cm6/CODE_CM6_DOCUMENTATION.md)** — Complete technical reference  
   *Comprehensive guide to architecture, realtime diffs, terminal drawer, WebSocket proxy*

7. **[/docs/apps/code_cm6/code_cm6_inline_diff_architecture.md](/docs/apps/code_cm6/code_cm6_inline_diff_architecture.md)** — Inline diff pipeline deep dive  
   *How live Git diffs work (file watcher → diff calculator → CodeMirror decorations)*

### Phase 3: Agent Integration (If Working on Agent Features)

Only needed if you're working on the agent drawer or AI integration:

8. **[/docs/apps/code_cm6/AGENT_DRAWER_ARCHITECTURE.md](/docs/apps/code_cm6/AGENT_DRAWER_ARCHITECTURE.md)** — **Most important agent doc**  
   *Shared shell pattern, session management, approval settings, no auto-spawn policy*

9. **[/docs/apps/code_cm6/agent_integration.md](/docs/apps/code_cm6/agent_integration.md)** — Original integration docs  
   *How Codex/Gemini integration was first implemented*

10. **[/docs/apps/code_cm6/agent_quick_reference.md](/docs/apps/code_cm6/agent_quick_reference.md)** — API reference  
    *WebSocket and REST endpoints for agent communication*

### Phase 4: Reference Material (As Needed)

Consult these when working on specific features:

- **[/docs/apps/code_cm6/CM6_NATIVE_SELECTION.md](/docs/apps/code_cm6/CM6_NATIVE_SELECTION.md)** — Android text selection implementation
- **[/docs/apps/code_cm6/CHANGELOG_2025_10_28.md](/docs/apps/code_cm6/CHANGELOG_2025_10_28.md)** — Recent changes (Oct 28-30)
- **[/docs/apps/code_cm6/code_cm6_todo.md](/docs/apps/code_cm6/code_cm6_todo.md)** — Active TODO list and backlog
- **[/docs/core/shared_file_picker.md](/docs/core/shared_file_picker.md)** — Framework-wide file picker (`window.teFilePicker`)
- **[/docs/core/state_store.md](/docs/core/state_store.md)** — Persistent state management

---

## Quick Summary by Document

### Framework Level

| Document | Purpose | When to Read |
|----------|---------|--------------|
| `GEMINI.md` | Project context, workflow, conventions | **Always read first** |
| `REPO_STRUCTURE.md` | Directory layout | When navigating codebase |
| `docs/core/repo_overview.md` | Framework architecture | Understanding app lifecycle |
| `docs/core/framework_shells.md` | PTY shell system | Working with terminal/agents |

### Code CM6 Core

| Document | Purpose | When to Read |
|----------|---------|--------------|
| `docs/apps/code_cm6/README.md` | Quick start + index | **Start here for code_cm6** |
| `CODE_CM6_DOCUMENTATION.md` | Complete technical reference | Deep understanding needed |
| `code_cm6_inline_diff_architecture.md` | Diff pipeline internals | Working on diff features |

### Agent Integration

| Document | Purpose | When to Read |
|----------|---------|--------------|
| `AGENT_DRAWER_ARCHITECTURE.md` | Shared shell + sessions | **Working on agent features** |
| `agent_integration.md` | Original design docs | Historical context |
| `agent_quick_reference.md` | API reference | Implementing agent calls |

### Specialized Topics

| Document | Purpose | When to Read |
|----------|---------|--------------|
| `CM6_NATIVE_SELECTION.md` | Android text selection | Touch/selection issues |
| `shared_file_picker.md` | File picker API | Adding file selection UI |
| `state_store.md` | Persistence layer | Saving user preferences |

---

## TL;DR for Maximum Efficiency

**If you only have time for 3 documents:**

1. **[GEMINI.md](/GEMINI.md)** — Understand the framework
2. **[docs/apps/code_cm6/README.md](/docs/apps/code_cm6/README.md)** — Understand code_cm6
3. **[docs/apps/code_cm6/AGENT_DRAWER_ARCHITECTURE.md](/docs/apps/code_cm6/AGENT_DRAWER_ARCHITECTURE.md)** — If working on agents

**Then use the comprehensive docs as reference when implementing specific features.**

---

## Key Architecture Concepts to Grasp

### 1. App Worker Pattern
- Code CM6 runs as a **separate Flask worker** on a dynamic port
- Main app acts as **WebSocket proxy** to route connections
- Each app gets its own isolated Python environment

### 2. Framework Shells (PTY System)
- Background processes managed via **framework_shells API**
- Used by terminal drawer and agent integration
- Supervisor cleans up orphaned processes on framework exit

### 3. Real-time Sync (WebSocket)
- File changes detected by `core_read.py` watchdog
- WebSocket streams `file_changed` and `diff_changed` events
- Frontend auto-reloads or updates diffs without user action

### 4. Shared Shell Architecture (Agents)
- **ONE** framework shell per agent type (Codex, Gemini)
- Multiple UI sessions multiplex through shared shell
- Sessions differentiated by Codex `conversationId`
- **No auto-spawn policy** - shells only created on explicit user action (code behavior, not agent behavior)

### 5. Inline Diff Pipeline
```
Git repository → diff_helper.py → WebSocket → diff_decorations.js → CodeMirror decorations
```

### 6. Terminal Drawer
- PTY streaming via `terminal_backend.py`
- History replay (2000 lines) on reconnect
- Session persistence across app restarts

---

## Common Gotchas

1. **Understand the no auto-spawn policy** - Framework shells are only created on deterministic user actions (Send button, etc.), not on navigation/page load
2. **Use `window.teFilePicker`** - Don't create custom file pickers
3. **Check `AGENTS.md`** - Contains user-specific conventions (like never checking off TODO items)
4. **Framework shells are cleaned on exit** - Don't rely on persistence across framework restarts
5. **WebSocket connections are proxied** - Don't hardcode ports, use relative URLs

---

## File Locations Cheat Sheet

```
termux-extensions-2/
├─ app/
│  ├─ apps/file_editor_cm6/        ← Code CM6 app lives here
│  │  ├─ main.py                   ← Flask app entry point
│  │  ├─ main.js                   ← Editor initialization
│  │  ├─ core_read.py              ← File watcher
│  │  ├─ core_write.py             ← Write handler
│  │  ├─ diff_helper.py            ← Git diff parser
│  │  ├─ terminal_backend.py       ← PTY streaming
│  │  ├─ agent_ws.py               ← Agent WebSocket
│  │  ├─ agent_bridge.py           ← MCP/ACP protocol
│  │  └─ static/js/
│  │     ├─ diff_decorations.js   ← Diff UI
│  │     ├─ explorer.js            ← File tree
│  │     ├─ terminal.js            ← Terminal UI
│  │     └─ agent_drawer.js        ← Agent UI
├─ docs/
│  ├─ core/                        ← Framework docs
│  └─ apps/code_cm6/              ← App-specific docs
└─ scripts/
   └─ bootstrap_termux.sh         ← Setup script
```

---

**Last Updated**: October 30, 2025

**Pro Tip**: Start with `GEMINI.md` and `docs/apps/code_cm6/README.md`, then use this guide to navigate deeper into specific areas as needed!
