# Explorer V2 – WebSocket Protocol Definition

**Endpoint:** `/api/app/file_editor_cm6/ws/ui`
**Transport:** JSON over WebSocket

## 1. Message Envelope

All messages (inbound and outbound) share this structure:

```json
{
  "type": "namespace:action",  // e.g., "explorer:list", "git:status"
  "payload": { ... },          // Command arguments or event data
  "id": "optional-uuid"        // Request ID for correlation (optional)
}
```

---

## 2. Inbound Commands (Client → Server)

### Explorer Navigation
- **`explorer:list`**
  - Payload: `{ "rel": "path/to/dir" }`
  - Response: `explorer:setList`
- **`explorer:refresh`**
  - Payload: `{}`
  - Response: `explorer:refreshed` (triggers client to re-request visible nodes)

### File Operations
- **`explorer:createFile`**
  - Payload: `{ "parent_rel": "path", "name": "filename.ext" }`
- **`explorer:createDir`**
  - Payload: `{ "parent_rel": "path", "name": "dirname" }`
- **`explorer:rename`**
  - Payload: `{ "rel": "path/old", "new_name": "newname" }`
- **`explorer:delete`**
  - Payload: `{ "rel": "path/to/item" }`
- **`explorer:copy`**
  - Payload: `{ "rel": "src", "dest_path": "/abs/path" }`
- **`explorer:move`**
  - Payload: `{ "rel": "src", "dest_path": "/abs/path" }`
- **`explorer:copyFrom`**
  - Payload: `{ "source_path": "/abs/src", "dest_rel": "dest" }`
- **`explorer:moveFrom`**
  - Payload: `{ "source_path": "/abs/src", "dest_rel": "dest" }`
- **`explorer:batchDelete`**
  - Payload: `{ "rels": ["path1", "path2"] }`
- **`explorer:batchCopy`**
  - Payload: `{ "rels": [...], "dest_path": "..." }`
- **`explorer:batchMove`**
  - Payload: `{ "rels": [...], "dest_path": "..." }`
- **`explorer:openExternal`**
  - Payload: `{ "path": "/abs/path/to/open" }` (Proxied to File Explorer app)

### Git Operations
- **`git:status`**
  - Payload: `{}`
  - Response: `git:status`
- **`git:stage`**
  - Payload: `{ "paths": ["rel1", "rel2"] }`
- **`git:unstage`**
  - Payload: `{ "paths": ["rel1", "rel2"] }`
- **`git:stageAll`**
  - Payload: `{}`
- **`git:unstageAll`**
  - Payload: `{}`
- **`git:restore`**
  - Payload: `{ "path": "rel", "commit": "HEAD" }`
- **`git:commit`**
  - Payload: `{ "message": "...", "amend": bool }`
- **`git:push`**
  - Payload: `{ "remote": "origin", "branch": "main", "force": bool }`
- **`git:pull`**
  - Payload: `{ "remote": "origin", "branch": "main", "rebase": bool }`
- **`git:setDiffBase`**
  - Payload: `{ "ref": "HEAD~1" }`

### Search & Review
- **`search:run`**
  - Payload: `{ "mode": "name"|"content"|"changes", "query": "..." }`
  - Response: `search:results`
- **`review:list`**
  - Payload: `{ "lightweight": bool }`
  - Response: `review:list`
- **`review:save`**
  - Payload: `{ "files": ["rel1", "rel2"] }`
- **`review:discard`**
  - Payload: `{ "files": ["rel1", "rel2"] }`

### Project
- **`project:open`**
  - Payload: `{ "path": "/abs/path" }`
- **`project:create`**
  - Payload: `{ "parent_path": "/abs", "name": "foo" }`

---

## 3. Outbound Events (Server → Client)

### Data Updates
- **`explorer:setList`**
  - Payload:
    ```json
    {
      "cwd": "rel/path",
      "entries": [
        {
          "rel": "rel/path/file.txt",
          "name": "file.txt",
          "kind": "file",
          "gitStatus": "modified",
          "hasDraft": true,
          "isExecutable": false,
          "isSymlink": false
        }
      ]
    }
    ```

- **`git:status`**
  - Payload:
    ```json
    {
      "branch": "main",
      "ahead": 1,
      "behind": 0,
      "staged": ["file1.txt"],
      "unstaged": ["file2.txt"],
      "untracked": ["new.txt"]
    }
    ```

### Operation Results
- **`explorer:created`**, **`explorer:renamed`**, **`explorer:deleted`**
  - Payload: `{ "rel": "...", "success": true }`
- **`git:restored`**
  - Payload: `{ "path": "..." }`
- **`error`**
  - Payload: `{ "message": "Error description" }`

### Notifications
- **`notification`**
  - Payload: `{ "message": "Saved successfully", "type": "info"|"error" }`
