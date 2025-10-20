# Gemini Edits for Auto-Save Feature

This file contains the proposed edits to fix the auto-save and streaming updates functionality.

## File: `/home/mrsurge/knowwhere3/files/home/termux-extensions/te-2-code_oss-mens-diffs/app/apps/code_oss/static/js/ide_fullpage.js`

### Change 1: Add a variable for the Save button

**Estimated Line:** 60

**Action:** Add the following line with the other `mi...` variables:

```javascript
const miSave = document.getElementById('mi-save');
```

### Change 2: Import Annotation and define `fromBridge`

**Estimated Line:** 80

**Action:** Replace the existing `const { EditorView, ... } = CM;` line with this:

```javascript
const { EditorView, keymap, highlightActiveLine, highlightActiveLineGutter, lineNumbers, Annotation } = CM;
const fromBridge = Annotation.define();
```

### Change 3: Update `applyEditorChanges` function

**Estimated Line:** 1300

**Action:** Replace the `applyEditorChanges` function with this new version:

```javascript
function applyEditorChanges(docId, changes) {
  if (!cmState.view || docId !== cmState.docId) return;
  if (!Array.isArray(changes) || !changes.length) return;
  const edits = [];
  changes.forEach((change) => {
    const from = posFromLocation(change?.start);
    const to = posFromLocation(change?.end);
    const insert = typeof change?.text === 'string' ? change.text : '';
    edits.push({ from, to, insert });
  });
  if (edits.length) {
    cmState.view.dispatch({
      changes: edits,
      annotations: fromBridge.of(true)
    });
    cmState.text = cmState.view.state.doc.toString();
  }
}
```

### Change 4: Refine the Editor Update Listener

**Estimated Line:** 1850

**Action:** Replace the `EditorView.updateListener` block inside the `makeExtensions` function with the following:

```javascript
  exts.push(EditorView.updateListener.of((update) => {
    if (update.transactions.some(tr => tr.annotation(fromBridge))) {
        return;
    }
    if (update.docChanged) {
      ignoreBridgeEvents = true;
      if (cmState.autosave) {
        if (autosaveTimer) clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(() => {
          saveFile();
        }, 1500);
      } else {
        if (miSave) miSave.disabled = false;
      }
    }
  }));
```

### Change 5: Update the `saveFile` function

**Estimated Line:** 1933

**Action:** Replace the `saveFile` function with this new version:

```javascript
async function saveFile() {
    if (!currentFile || !cmState.view) return;

    const content = cmState.view.state.doc.toString();

    try {
        await fetch('/api/app/code_oss/file', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: currentFile, content }),
        });
        if (miSave) miSave.disabled = true;
    } catch (error) {
        console.error('[ide_fullpage] Failed to save file', error);
    } finally {
        ignoreBridgeEvents = false;
    }
}
```

### Change 6: Add Event Listener for Manual Save

**Estimated Line:** 2020

**Action:** Add this event listener after the `miAutosave` listener:

```javascript
miSave?.addEventListener('click', () => {
    saveFile();
});
```
