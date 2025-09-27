# Shared File & Directory Picker

A reusable modal picker is now available across the entire framework. The component
mirrors the File Editor's browsing experience, adds one-tap navigation (single click
enters directories), and exposes a compact API so apps/extensions can launch it
without duplicating UI code.

## Usage

```javascript
const result = await window.teFilePicker.open({
  title: 'Select a Script',
  startPath: '~/scripts',
  mode: 'file',        // 'file' | 'directory' | 'any' | 'save'
  showHidden: true,    // optional initial state
});
```

- The promise resolves with `{ path, type, name, showHidden }` (and, in save mode,
  `{ directory, existed }`) or rejects with an error when the user cancels.
- Paths are always returned as absolute filesystem paths (e.g.
  `/data/data/com.termux/files/home/Downloads/file.txt`).
- Start locations are remembered **per mode** (`open`, `directory`, `save`), so
  the next invocation resumes where the user last picked—unless you override it
  via `startPath`.
- Use helpers for common cases:

```javascript
const folder = await window.teFilePicker.openDirectory({ startPath: '~', selectLabel: 'Use Folder' });
```

```javascript
const target = await window.teFilePicker.saveFile({
  startPath: '~/projects',
  filename: 'notes.txt',
});
if (target && target.existed) {
  // prompt for overwrite if needed
}
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | string | "Select Item" / "Save File" | Header text inside the modal. |
| `startPath` | string | `~` | Initial directory (`~` or absolute path). |
| `mode` | string | `any` | `file`, `directory`, `any`, or `save`. |
| `filename` | string | `''` | Prefills the filename input in save mode. |
| `showHidden` | boolean | retain previous | Initial state of the "Show hidden files" toggle. |
| `allowSelectCurrent` | boolean | `true` unless file/save | Toggles the "Select current directory" button. |
| `selectLabel` | string | Contextual | Custom label for the primary action button. |

## Behaviour

- Uses `GET /api/browse` under the hood, respecting the "Show hidden files" toggle.
- Breadcrumb navigation, Up button, a dedicated **Home** button (`🏠`), and
  single-click to drill into folders.
- Save mode exposes a filename input and returns `{ path, directory, existed }`.
- Selection only enabled when the item matches the requested `mode`.
- Styled to match the shared dark theme; automatically injected into both the
  main launcher page and the app shell.
- When the picker cannot access a directory (permission denied, missing mount,
  etc.), the modal displays the error message inline so you can see exactly what
  failed without digging through server logs.

## Notes

- The picker relies on `window.teUI.toast` for error messages; ensure the global UI
  helper remains available.
- For form flows, handle a rejection (cancelled) to avoid unhandled promise rejections.

Example integration:

```javascript
async function browseForConfig() {
  try {
    const choice = await window.teFilePicker.openFile({
      title: 'Choose Config File',
      startPath: '~/config',
    });
    if (choice) {
      configPathInput.value = choice.path;
    }
  } catch (_) {
    // user cancelled
  }
}
```

This shared component keeps file/directory selection consistent across the
framework, remembers per-mode history, and reduces duplicate UI logic.
