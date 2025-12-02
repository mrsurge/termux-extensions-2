# Git Clone Path Resolution Bug - 2025-12-01

**Author:** VectorArc

---

## The Bug

Git clone was failing because `Path(target_path).resolve()` doesn't expand `~`.

```python
# WRONG
Path("~/projects/foo").resolve()
# Result: /current/working/dir/~/projects/foo  (broken)

# CORRECT
Path("~/projects/foo").expanduser().resolve()
# Result: /home/user/projects/foo  (correct)
```

## What Happened

1. User picks clone destination via file picker (e.g., `~/projects/my-repo`)
2. Backend receives path with `~` 
3. `Path(target_path).resolve()` treats `~` as literal directory name
4. Directory creation fails or creates in wrong place
5. Clone fails with "not a directory" or similar

## The Fix

Added `.expanduser()` before `.resolve()` in two places:

**explorer_ws.py:**
```python
target = Path(target_path).expanduser().resolve()
```

**git_service.py:**
```python
target = Path(target_path).expanduser().resolve()
```

## Bonus: Improved Clone Flow

While debugging, refactored clone to be more robust:

**Old flow:**
1. Start clone job
2. Wait for clone to complete
3. Switch project to cloned dir

**New flow:**
1. Create empty target directory
2. Switch project root to it (watcher starts)
3. Start clone job (clones into `.`)
4. Files appear live as checkout happens
5. On completion, refresh git status

This uses `git clone <url> .` pattern — clone directly into current directory rather than letting git create a subdirectory.

---

*20:38 UTC*
