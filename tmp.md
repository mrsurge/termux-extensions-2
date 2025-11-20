# Explorer “By Changes” Plan (2025-11-20)

## Goals
- Reuse existing Git/diff infrastructure to surface working-tree changes in the Explorer’s search panel.
- Provide a third search mode (“By Changes”) alongside “By Name” and “By Contents”.
- Keep UI consistent with current search overlay; future-proof for commit-to-commit diffing.

## Backend
1. Extend `/explorer/search` so `mode: "changes"` returns a payload shaped like:
   ```json
   {
     "git": true,
     "head": { "short": "abc1234", "hash": "...", "subject": "Message" },
     "changes": [
       {
         "rel": "src/app.py",
         "path": "/abs/path/src/app.py",
         "label": "app.py",
         "status": "M",
         "summary": { "added": 3, "deleted": 1, "tracked": true },
         "hunks": [ ... collect_diff output ... ]
       }
     ],
     "truncated": false,
     "count": 4
   }
   ```
2. Implementation details:
   - Use `git_helper.is_git_repository` / `git_helper.get_status` (or similar) to list changed files vs HEAD (equivalent to `git status --short`).
   - For each changed file, call `diff_helper.collect_diff(project_root, rel_path)` to reuse the existing hunk format.
   - Limit results (e.g., first 40 files) and set `truncated` if more.
   - Include HEAD metadata using existing Git helpers (short hash + subject) for future dropdown use.

## Frontend
1. Update the search overlay header:
   - Buttons: “By Name”, “By Contents”, **“By Changes”**.
   - Selecting “By Changes” skips the text input; instead display a secondary header row containing a disabled button reading `HEAD <short>` (placeholder for future commit selection) plus explanatory text.
2. When `searchMode === 'changes'`:
   - Immediately request `/explorer/search` with `{ mode: 'changes' }` (no `query`).
   - Render a canonical list of changed files: file name header followed by diff hunks with red/green styling (reuse existing CSS if possible or add new classes in `explorer.css`).
   - Clicking a change opens the file and leverages the existing jump-to-line helpers (similar to content search).
3. Keep the `HEAD` selector disabled with a tooltip and an inline comment in code: `// stub/placeholder for future 'commit to document state diffing'`.
4. Leave hooks for future enhancements (e.g., commit dropdown) but do not implement filtering yet.

## Notes
- No new subprocess calls in `main.py`; rely on `git_helper` and `diff_helper` to preserve the single-source-of-truth model for diffs.
- UI must remain stateless: everything derived from backend payload.
- After backend response shape is stable, update docs/notes accordingly.
