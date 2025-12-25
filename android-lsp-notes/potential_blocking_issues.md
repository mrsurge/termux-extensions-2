# Potential Blocking Issues

**Generated:** 2025-12-23 01:39 UTC  
**Author:** Atlas

This document identifies synchronous blocking calls that may cause event loop starvation in the async/websocket-heavy architecture.

---

## Critical (Called from async handlers, blocks event loop)

### 1. `diff_helper.py` — All functions are synchronous

| Line | Code | Impact |
|------|------|--------|
| 85 | `subprocess.run([...], capture_output=True)` | Blocks on git show |
| 119-130 | `subprocess.Popen` + `.communicate()` | Blocks on git diff |
| 211 | `subprocess.run([...])` | Blocks on git operations |

**Called from:** `_get_combined_diffs()` in `editor_app.py` which is called on every keystroke (debounced), file switch, and save.

**Fix:** Wrap in `anyio.to_thread.run_sync()` or rewrite as async with `asyncio.create_subprocess_exec()`.

---

### 2. `explorer_helper.py` — Synchronous subprocess calls

| Line | Code | Impact |
|------|------|--------|
| 242 | `subprocess.run(['git', ...])` | Blocks on git status |
| 423 | `subprocess.run(['git', ...])` | Blocks on git operations |

**Called from:** Various explorer operations, file tree refresh.

**Fix:** Same as above.

---

### 3. `git_helper.py` — Synchronous subprocess calls

| Line | Code | Impact |
|------|------|--------|
| 54 | `subprocess.run(['git', ...])` | Blocks |
| 70 | `subprocess.run(['git', ...])` | Blocks |
| 92 | `subprocess.run(['git', ...])` | Blocks |

**Fix:** Offload to thread pool.

---

### 4. `editor_app.py` — Synchronous file I/O in async context

| Line | Code | Context |
|------|------|---------|
| 402 | `Path(file_path).read_text()` | Inside `_get_combined_diffs()` |
| 640 | `Path(last_file).read_bytes()` | Page load (less critical, one-time) |
| 1953 | `Path(file_path).read_text()` | `handle_external_discard()` |

**Most critical:** Line 402 — called on every debounced edit when draft diffs are enabled.

**Fix:** 
```python
# Before
disk_content = Path(file_path).read_text(encoding='utf-8', errors='replace')

# After
disk_content = await anyio.to_thread.run_sync(
    lambda: Path(file_path).read_text(encoding='utf-8', errors='replace')
)
```

---

### 5. `editor_app.py` — Synchronous hashing

| Line | Code | Context |
|------|------|---------|
| 431 | `hashlib.sha256(...).hexdigest()` | `_persist_to_cache_debounced()` |
| 542 | `hashlib.sha256(...).hexdigest()` | `_persist_active_draft_immediately()` |
| 734 | `hashlib.sha256(...).hexdigest()` | `_on_editor_change()` — **every keystroke** |
| 1254 | `hashlib.sha256(...).hexdigest()` | `set_editor_content()` |

**Impact:** SHA256 on large files (>100KB) can take several milliseconds, blocking the event loop.

**Fix:** Offload to thread for files over a size threshold, or use incremental hashing.

---

### 6. `history_store.py` — Synchronous file I/O

| Line | Code | Impact |
|------|------|--------|
| 79 | `json.loads(content)` | Reading sidecar JSON |
| 103 | `tmp_path.write_text(json.dumps(...))` | Writing sidecar |
| 276 | `json.loads(content)` | Reading cached documents |
| 798 | `hashlib.sha256(...)` | Content hashing |

**Called from:** Multiple async handlers via `_history_store` singleton.

**Fix:** Make store methods async or wrap calls in `run_sync()`.

---

### 7. `preferences_store.py` — Synchronous file I/O

| Line | Code | Impact |
|------|------|--------|
| 92 | `json.dumps(...)` + file write | Persisting preferences |
| 138 | `json.loads(content)` | Loading preferences |
| 150 | `json.dumps(...)` + file write | Updating preferences |

**Called from:** Preference updates, which can happen during typing.

---

### 8. `lsp_ws.py` — Potential blocking in reader task

| Line | Code | Impact |
|------|------|--------|
| 454 | `pipe_state.process.stdin.write(...)` | Could block if pipe buffer full |

**Note:** This is in an async context but writes to a synchronous pipe. If the LSP server is slow to consume, this can block.

**Fix:** Use `asyncio.get_event_loop().run_in_executor()` for pipe writes, or implement backpressure.

---

### 9. `ipc_stack/agent_handler.py` — Blocking HTTP requests

| Line | Code | Impact |
|------|------|--------|
| 269 | `requests.get(...)` | Blocking HTTP call |
| 407 | `requests.get(...)` | Blocking HTTP call |
| 418 | `requests.get(...)` | Blocking HTTP call |
| 437 | `requests.post(...)` | Blocking HTTP call |
| 454 | `requests.post(...)` | Blocking HTTP call |

**Fix:** Replace `requests` with `httpx` (async) or `aiohttp`.

---

### 10. `core_read.py` — Blocking sleep

| Line | Code | Impact |
|------|------|--------|
| 109 | `time.sleep(0.3)` | Blocks event loop for 300ms |

**Fix:** Use `await asyncio.sleep(0.3)`.

---

## Medium Priority (Less frequent code paths)

### `main.py` (file_editor_cm6)

| Line | Code | Context |
|------|------|---------|
| 836-837 | `open(...).read()` | File content loading |

### `explorer/search.py`

| Line | Code | Context |
|------|------|---------|
| 344 | `path.open('rb')` | File search — already uses async subprocess for ripgrep |

### `libs/bookmarks.py`, `libs/jobs.py`, `libs/app_manager.py`

Multiple synchronous file operations — lower priority since these aren't in hot paths.

---

## Recommended Fix Order

1. **`diff_helper.py`** — Highest impact, called on every edit
2. **`editor_app.py` line 734** — SHA256 on every keystroke
3. **`history_store.py`** — Called frequently for draft persistence
4. **`explorer_helper.py`** — Affects file tree responsiveness
5. **`ipc_stack/agent_handler.py`** — Blocking HTTP can stall agent responses
6. **`core_read.py` line 109** — Easy fix, `time.sleep` → `asyncio.sleep`

---

## Quick Wins

```python
# 1. Replace time.sleep with asyncio.sleep
# Before
time.sleep(0.3)
# After
await asyncio.sleep(0.3)

# 2. Wrap synchronous functions
# Before
diff_data = collect_diff(project_root, rel, base_ref=ref)
# After
diff_data = await anyio.to_thread.run_sync(
    lambda: collect_diff(project_root, rel, base_ref=ref)
)

# 3. For frequently called hashing
# Before
sha = hashlib.sha256(content.encode()).hexdigest()
# After (only for large content)
if len(content) > 50000:
    sha = await anyio.to_thread.run_sync(
        lambda: hashlib.sha256(content.encode()).hexdigest()
    )
else:
    sha = hashlib.sha256(content.encode()).hexdigest()
```

---

## Architecture Note

The core issue is that `diff_helper.py`, `explorer_helper.py`, and `git_helper.py` were written as synchronous utilities but are now called from async handlers. A proper fix would be to:

1. Create async versions of these modules
2. Or create a dedicated thread pool for git/file operations
3. Or use a task queue (e.g., `asyncio.Queue`) with worker threads

The current pattern of sprinkling `run_sync()` everywhere works but is fragile — easy to miss a call path.
