# Shared File & Directory Picker

A reusable modal picker is now available across the entire framework. The component
mirrors the File Editor's browsing experience and is exposed as a global helper so
apps and extensions can launch it without duplicating UI code.

## Usage

```javascript
const result = await window.teFilePicker.open({
  title: 'Select a Script',
  startPath: '~/scripts',
  mode: 'file',        // 'file' | 'directory' | 'any'
});
```

- The promise resolves with `{ path, type, name }` or rejects with an error when the
  user cancels.
- Use `openFile()` or `openDirectory()` helpers for convenience:

```javascript
const folder = await window.teFilePicker.openDirectory({ startPath: '~', selectLabel: 'Use Folder' });
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | string | "Select Item" | Header text inside the modal. |
| `startPath` | string | `~` | Initial directory (`~` or absolute path). |
| `mode` | string | `any` | Restrict selection to `file`, `directory`, or allow both. |
| `allowSelectCurrent` | boolean | `true` (unless `mode === 'file'`) | Toggles the "Select current directory" button. |
| `selectLabel` | string | `Select` (or `Select Folder` for `openDirectory`) | Custom label for the primary action button. |

## Behaviour

- Uses `GET /api/browse` under the hood.
- Breadcrumb navigation, Up button, and double-click to enter directories.
- Selection only enabled when the item matches the requested `mode`.
- Styled to match the shared dark theme; automatically injected into both the
  main launcher page and the app shell.

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
framework and reduces duplicate UI logic.
