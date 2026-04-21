
export function pickerAvailable() {
  return window.teFilePicker && typeof window.teFilePicker.openFile === 'function';
}

export async function pickFileWithPicker({ startPath, currentPath, lastPickerPath, homeDir, toAbsolute, parentDir, toast }) {
  if (!pickerAvailable()) {
    toast('File picker unavailable');
    return { path: null, lastPickerPath };
  }
  const baseStart = startPath || (currentPath ? parentDir(currentPath) : lastPickerPath);
  const initial = toAbsolute(baseStart, null, homeDir);
  try {
    const choice = await window.teFilePicker.openFile({ title: 'Open File', startPath: initial, selectLabel: 'Open' });
    if (choice && choice.path) return { path: choice.path, lastPickerPath: parentDir(choice.path) };
    return { path: null, lastPickerPath };
  } catch (e) {
    const eAny = /** @type {any} */ (e);
    if (eAny && eAny.message === 'cancelled') return { path: null, lastPickerPath };
    toast(eAny?.message || 'Browse failed');
    return { path: null, lastPickerPath };
  }
}

export async function pickDirectoryWithPicker({ startPath, currentPath, lastPickerPath, homeDir, toAbsolute, parentDir, toast }) {
  if (!pickerAvailable()) {
    toast('File picker unavailable');
    return { path: null, lastPickerPath };
  }
  const baseStart = startPath || (currentPath ? parentDir(currentPath) : lastPickerPath);
  const initial = toAbsolute(baseStart, null, homeDir);
  try {
    const choice = await window.teFilePicker.openDirectory({ title: 'Select Folder', startPath: initial, selectLabel: 'Select' });
    if (choice && choice.path) return { path: choice.path, lastPickerPath: choice.path };
    return { path: null, lastPickerPath };
  } catch (e) {
    const eAny = /** @type {any} */ (e);
    if (eAny && eAny.message === 'cancelled') return { path: null, lastPickerPath };
    toast(eAny?.message || 'Browse failed');
    return { path: null, lastPickerPath };
  }
}

export async function pickSaveTargetWithPicker({ currentPath, lastPickerPath, homeDir, toAbsolute, parentDir, basename, toast }) {
  if (!pickerAvailable()) {
    toast('File picker unavailable');
    return null;
  }
  const baseDir = currentPath ? parentDir(currentPath) : lastPickerPath;
  const initialDir = toAbsolute(baseDir, null, homeDir);
  try {
    const result = await window.teFilePicker.saveFile({
      title: 'Save As',
      startPath: initialDir,
      filename: currentPath ? basename(currentPath) : '',
      selectLabel: 'Save',
    });
    return result || null;
  } catch (e) {
    const eAny = /** @type {any} */ (e);
    if (eAny && eAny.message === 'cancelled') return null;
    toast(eAny?.message || 'Save cancelled');
    return null;
  }
}
