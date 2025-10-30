# code_cm6 — CodeMirror 6 Editor

**Full-featured CodeMirror 6 editor optimized for mobile devices with Termux.**

---

## Quick Overview

The `file_editor_cm6` app provides a native-feeling code editing experience with real-time file synchronization, live Git diffs, embedded terminal drawer, and AI agent integration.

### Key Features

- **Real-time file change notifications** via WebSocket
- **Live inline Git diffs** with instant updates on save/external changes
- **Embedded terminal drawer** with session persistence and history replay
- **Branch dropdown + Git footer** for Stage/Unstage/Commit/Push/Pull directly in the explorer
- **AI Agent Integration** with Codex/Gemini via shared shell architecture
- **Android-native selection mode** with long-press detection
- **Project-based file management** with explorer drawer
- **Disk-backed preferences** for themes and editor settings

### Architecture Highlights

```
WebSocket Proxy (Main App)
  ↓
file_editor_cm6 Worker
  ├─ core_read.py (file watcher)
  ├─ core_write.py (write handler)
  ├─ diff_helper.py (git diff parser)
  ├─ terminal_backend.py (PTY streaming)
  ├─ agent_ws.py (agent WebSocket)
  ├─ agent_bridge.py (MCP/ACP protocol)
  └─ history_store.py (state persistence)
```

---

## Documentation Index

### Core Documentation

- [CODE_CM6_DOCUMENTATION.md](CODE_CM6_DOCUMENTATION.md) — Comprehensive technical reference (architecture, realtime diffs, terminal drawer, roadmap)
- [CHANGELOG_2025_10_28.md](CHANGELOG_2025_10_28.md) — Latest release notes (Oct 28-30, 2025)
- [code_cm6_inline_diff_architecture.md](code_cm6_inline_diff_architecture.md) — Deep dive into the inline diff pipeline
- [CM6_NATIVE_SELECTION.md](CM6_NATIVE_SELECTION.md) — Android-native selection implementation
- [code_cm6_todo.md](code_cm6_todo.md) — Active TODO list and backlog

### Agent Integration

- [AGENT_DRAWER_ARCHITECTURE.md](AGENT_DRAWER_ARCHITECTURE.md) — **Complete architecture documentation** for the agent drawer (shared shell pattern, session management, approval settings)
- [agent_integration.md](agent_integration.md) — Original agent integration documentation for Codex/Gemini
- [agent_quick_reference.md](agent_quick_reference.md) — Quick API reference for WebSocket and REST endpoints
- [agent_implementation_summary.md](agent_implementation_summary.md) — Implementation summary and backend overview

---

## Recent Updates

**October 30, 2025**

- ✅ Fixed inline diffs not updating after git commit (file reload after commit/push)
- ✅ Agent drawer: Per-session approval settings via modal configuration
- ✅ Agent drawer: Shared shell architecture (no auto-spawn on navigation)
- ✅ Agent drawer: Session naming and custom display names

**October 29, 2025**

- ✅ Added menubar branch dropdown (list, checkout, create)
- ✅ Added explorer footer with Stage/Unstage/Commit/Push/Pull buttons and live status summary
- ✅ Expanded `git_helper.py` + REST API to support new Git UI workflows

**October 28, 2025**

- ✅ Real-time inline diffs via WebSocket `diff_changed` events
- ✅ Embedded terminal with PTY streaming and 2000-line history replay
- ✅ WebSocket proxy architecture for dynamic worker ports
- ✅ Framework shell orphan cleanup
- ✅ Terminal history whitespace fix

---

**Last Updated**: October 30, 2025

