# Git Status Bar Count Fix

**Date:** 2025-12-01  
**Issue:** Explorer footer git status bar miscounted staged/unstaged files  
**Root Cause:** `.strip()` removing leading whitespace from `git status --short` output

---

## The Bug

The git status bar in the explorer footer consistently miscounted files:
- 5 modified files → showed "1 staged, 4 changes"
- 1 modified file → showed "1 staged, 0 changes"

One file from each category was always incorrectly counted as "staged".

## Investigation

### Git Status Format

`git status --short` outputs lines in format `XY path`:
- Position 0 (X): Index/staging area status
- Position 1 (Y): Working tree status
- Position 2: Space separator
- Position 3+: File path

Examples:
- `M ` = Modified and staged, no additional working tree changes
- ` M` = Not staged, modified in working tree
- `MM` = Staged with additional unstaged modifications
- `??` = Untracked

### The Problem

For unstaged files, the output starts with a space:
```
 M app/apps/file_editor_cm6/main.js
 M app/apps/file_editor_cm6/editor_app.py
```

When the FIRST file is unstaged, the entire output starts with a space:
```python
stdout = ' M app/first_file.py\n M app/second_file.py\n'
```

The `_run_git_optional()` function used `.strip()`:
```python
return completed.stdout.strip()  # BUG: Removes leading space!
```

After `.strip()`:
```python
'M app/first_file.py\n M app/second_file.py\n'
#^ Leading space GONE from first line!
```

### Parsing Consequence

The parsing code in `_collect_status()`:
```python
code = line[:2]  # First 2 chars
path = line[3:]  # Path after "XY "

if code[0] != ' ':
    staged.append(path)  # Oops! First file misclassified
if code[1] != ' ':
    unstaged.append(path)
```

For the corrupted first line `'M app/first_file.py'`:
- `code = 'M '` (M-space instead of space-M)
- `code[0] = 'M'` ≠ `' '` → **incorrectly added to staged**
- `path = 'p/first_file.py'` → **path also corrupted** (missing 'ap')

## The Fix

Changed `.strip()` to `.rstrip()` to preserve leading whitespace:

```python
def _run_git_optional(project_root: Path, *args: str) -> Optional[str]:
    ...
    # Use rstrip() to preserve leading whitespace (important for git status --short)
    return completed.stdout.rstrip()
```

## Files Modified

- `app/apps/file_editor_cm6/git_helper.py`

## Verification

Before fix:
```
staged (1): ['pp/apps/file_editor_cm6/explorer_ws.py']  # Wrong! Path corrupted too
unstaged (5): [...]
```

After fix:
```
staged (0): []
unstaged (6): ['app/apps/file_editor_cm6/explorer_ws.py', ...]  # Correct!
```

## Notes

This bug existed since the original explorer implementation and was carried over to the Socket.IO refactor. It only manifested when the first file in git status output was unstaged (not staged), which is the common case.

---

_VectorArc, 2025-12-01_
