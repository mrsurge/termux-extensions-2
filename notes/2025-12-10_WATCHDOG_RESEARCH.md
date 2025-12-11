# Watchdog & File Watching Research
**Date:** 2025-12-10
**Focus:** Managing file watching in large repositories (monorepos, build artifacts) and efficient git status checking.

## The Problem: Inotify Limits
On Linux/Android, `watchdog` uses `inotify`. Each directory watched requires an inotify descriptor.
- **Limit:** `fs.inotify.max_user_watches` (often defaults to 8192 or 65536).
- **Crash:** `OSError: [Errno 28] inotify watch limit reached`.
- **Cause:** Recursive watching of large trees (`node_modules`, `build/`, `dist/`, `.git/`) consumes all handles.

## Industry Solutions

### 1. VS Code (`parcel/watcher`)
VS Code switched from `nsfw` to `@parcel/watcher` (C++ bindings).
- **Strategy:**
    - Uses native OS APIs (FSEvents on macOS, inotify on Linux, ReadDirectoryChangesW on Windows).
    - **Crucial:** Implements native exclusion filters. Directories like `node_modules` are ignored *before* attaching watches, preventing handle exhaustion.
    - **Fallback:** If native watching fails or hits limits, it falls back to a polling strategy or warns the user.
    - **VS Code "Files: Watcher Exclude":** Users map patterns to ignore. These are passed down to the low-level watcher.

### 2. Facebook Watchman
Watchman is a dedicated daemon service for file watching.
- **Architecture:** Runs as a separate background process. Clients connect via socket.
- **Features:**
    - **Settling:** Waits for a "settle period" before notifying (debouncing built-in).
    - **Queries:** "Show me changed files since Clockspec X".
    - **Git Integration:** Can trigger `git status` updates.
- **Pro:** Highly optimized, one daemon for the whole system (deduplication).
- **Con:** External dependency, heavy for a lightweight editor.

### 3. Git's Own Mechanisms (`core.fsmonitor`)
Git has solved this problem for itself.
- **`core.fsmonitor = true`:** Starts a long-running daemon (`git fsmonitor--daemon`).
- **Mechanism:** It listens to OS events (FSEvents/inotify) and maintains an in-memory bitmap of changed files.
- **IPC:** Git commands (`git status`, `git add`) query the daemon via IPC instead of scanning the disk.
- **`core.untrackedCache`:** Git remembers mtimes of directories to skip scanning for untracked files.
- **Relevance:** We could potentially *ask* git for changes instead of watching files ourselves, but latency might be higher than direct inotify.

### 4. IntelliJ / JetBrains (`fsnotifier`)
IntelliJ uses a custom native binary `fsnotifier`.
- **Strategy:**
    - Similar to VS Code: Native helper tool.
    - **Filters:** aggressively filters out ignored directories.
    - **Fallback:** Smart scanning/polling when limits are hit.

## Recommendation for Code CM6

### 1. "Fail Gracefully" (Implemented)
Catch `errno.ENOSPC` and switch to polling. This keeps the app alive but burns CPU/battery.

### 2. "Native Exclusion" (The Real Fix)
We are currently using `watchdog.observers.Observer.schedule(recursive=True)`.
**Issue:** `watchdog`'s recursive implementation walks the *entire* tree and places a watch on *every* subdirectory. It does *not* accept exclude patterns at the scheduling level (it filters *events*, not *watches*).

**Solution A: Custom Recursive Walker**
Instead of `recursive=True`, we manually walk the tree and call `schedule(recursive=False)` only on directories that are *not* in our exclude list (`node_modules`, `.git`, `build`).
- **Pros:** Drastically reduces handle usage.
- **Cons:** We must watch for `mkdir` events to dynamically attach new watches to created directories. `watchdog` does complex logic here; re-implementing it is risky.

**Solution B: Hybrid / "Sparse" Watching**
Only recursively watch `src/`. For the root, watch non-recursively.
- **Pros:** Simple.
- **Cons:** User might edit config files in root or new folders.

**Solution C: Increase Limits (System Level)**
- `echo 524288 > /proc/sys/fs/inotify/max_user_watches`
- **Cons:** Requires root/privileged access, which we may not have in strict Termux/Android environments (though often accessible in standard Termux).

### 3. Leveraging Git Status
For `git` features (diffs, branches), relying on `watchdog` is overkill.
- We should assume `git status` is slow but authoritative.
- Use `core.fsmonitor` if available to speed up `git` CLI calls.

### 4. Polling Optimization
If we fall back to polling:
- **Snapshot-based:** `os.walk` is expensive.
- **Heuristic:** Check `mtime` of `project_root`. If it hasn't changed, subdirs *might* not have changed (filesystem dependent).
- **Focus-based:** Poll aggressively only when window is focused; slow poll (5s) when backgrounded.

## Conclusion
The `ENOSPC` crash confirms that `watchdog` + `recursive=True` is dangerous on large repos without native exclusion. Since `watchdog` doesn't support "exclude-from-watch", the graceful fallback to polling is the correct immediate fix. Long-term, we need a smarter watcher that skips `node_modules` *before* watching.

## Addendum: Adaptive & Specialized Strategies

To further reduce resource usage and improve responsiveness, we can adopt a more granular, state-aware approach to file watching.

### 1. Specialized Git Watcher
Instead of treating `git status` as just another file change event, we can run a specialized, low-frequency poller specifically for git state.
*   **Trigger-Based:** Only run `git status` when:
    *   A file is saved (high probability of status change).
    *   Terminal commands execute (e.g., user runs `git checkout`).
    *   The app window regains focus.
*   **Debounced:** Ensure `git status` runs at most once every 1-2 seconds, even if multiple files change.
*   **Separation of Concerns:** Let the primary file watcher handle *content* updates (hot path), while the git watcher handles *metadata* updates (cold path).

### 2. "Active Document" Priority
Most of the time, the user only cares about the file they are currently editing.
*   **High-Frequency Watch:** Place a specific, non-recursive watch on the *currently open file*. This is cheap (1 descriptor) and ensures instant updates for collaboration.
*   **Low-Frequency Background:** If we fall back to polling, poll the *rest* of the project at a slower interval (e.g., 5s) while polling the active file every 200ms.

### 3. Activity-Based Throttling (Debounce on Type)
When the user is actively typing, we know the file content is changing in memory.
*   **Pause Watcher:** We can temporarily pause/suppress external change events for the active file while the user is typing (detected via `cm6-dirty-state` or similar).
*   **Resume on Idle:** When typing stops (debounce > 1s), resume watching to catch up with any external changes (e.g., a background formatter).

### 4. Connection-Aware Lifecycle
The watcher is only useful if there is a client to receive the events.
*   **Hibernate on Disconnect:** If all WebSocket connections (tabs) close, the backend is effectively idle. We can `stop()` the `Observer` or `PollingWatcher` completely.
*   **Wake on Connect:** When a new WebSocket connects, perform a "cold boot" scan (full `git status`, file tree refresh) and restart the watcher.
*   **Benefit:** Zero CPU usage when the app is running in the background with no active clients (common in mobile/Termux scenarios).