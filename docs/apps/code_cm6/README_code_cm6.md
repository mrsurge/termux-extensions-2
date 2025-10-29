# code_cm6 — CodeMirror 6 Editor

**For complete technical documentation, see [CODE_CM6_DOCUMENTATION.md](CODE_CM6_DOCUMENTATION.md)**

---

## Quick Overview

The `file_editor_cm6` app is a full-featured CodeMirror 6 editor optimized for mobile devices with Termux. It provides a native-feeling code editing experience with real-time file synchronization, live Git diffs, and an embedded terminal drawer.

### Key Features

- **Real-time file change notifications** via WebSocket
- **Live inline Git diffs** with instant updates on save/external changes
- **Embedded terminal drawer** with session persistence and history replay
- **Branch dropdown + Git footer** for Stage/Unstage/Commit/Push/Pull directly in the explorer
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
  └─ history_store.py (state persistence)
```

### Quick Links

- [Complete Documentation](CODE_CM6_DOCUMENTATION.md)
- [Active TODO List](code_cm6_todo.md)
- [Inline Diff Architecture](code_cm6_inline_diff_architecture.md)
- [Changelog (Oct 28, 2025)](CHANGELOG_2025_10_28.md)

### Recent Updates

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

**Last Updated**: October 29, 2025
