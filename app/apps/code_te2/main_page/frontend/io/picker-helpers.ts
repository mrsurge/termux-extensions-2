export interface PickerPathChoice {
  path: string;
}

export interface PickerSaveChoice {
  path: string;
  directory: string;
  name: string;
  existed?: boolean;
}

interface TeFilePicker {
  openDirectory(options: {
    title: string;
    startPath: string;
    selectLabel: string;
  }): Promise<PickerPathChoice | null>;
  openFile?(options: {
    title: string;
    startPath: string;
    selectLabel: string;
  }): Promise<PickerPathChoice | null>;
  saveFile(options: {
    title: string;
    startPath: string;
    filename: string;
    selectLabel: string;
  }): Promise<PickerSaveChoice | null>;
}

interface PickerRuntimeWindow {
  teFilePicker?: TeFilePicker;
}

export interface PickerBaseOptions {
  startPath?: string | null;
  currentPath: string | null;
  lastPickerPath: string;
  homeDir: string;
  toAbsolute: (path: string | null | undefined, base?: string | null, home?: string) => string;
  parentDir: (path: string | null | undefined) => string;
  toast: (message: string) => void;
}

export interface PickerSaveOptions extends Omit<PickerBaseOptions, 'startPath'> {
  basename: (path: string | null | undefined) => string;
}

export interface PickerResult {
  path: string | null;
  lastPickerPath: string;
}

function getRuntimeWindow(): PickerRuntimeWindow {
  return window as unknown as PickerRuntimeWindow;
}

function getPicker(): TeFilePicker | null {
  return getRuntimeWindow().teFilePicker ?? null;
}

function errorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : null;
  }
  return null;
}

export function pickerAvailable(): boolean {
  const picker = getPicker();
  return !!picker && typeof picker.openFile === 'function';
}

export async function pickFileWithPicker({
  startPath,
  currentPath,
  lastPickerPath,
  homeDir,
  toAbsolute,
  parentDir,
  toast,
}: PickerBaseOptions): Promise<PickerResult> {
  const picker = getPicker();
  if (!picker || typeof picker.openFile !== 'function') {
    toast('File picker unavailable');
    return { path: null, lastPickerPath };
  }
  const baseStart = startPath || (currentPath ? parentDir(currentPath) : lastPickerPath);
  const initial = toAbsolute(baseStart, null, homeDir);
  try {
    const choice = await picker.openFile({ title: 'Open File', startPath: initial, selectLabel: 'Open' });
    if (choice && choice.path) return { path: choice.path, lastPickerPath: parentDir(choice.path) };
    return { path: null, lastPickerPath };
  } catch (error) {
    const message = errorMessage(error);
    if (message === 'cancelled') return { path: null, lastPickerPath };
    toast(message || 'Browse failed');
    return { path: null, lastPickerPath };
  }
}

export async function pickDirectoryWithPicker({
  startPath,
  currentPath,
  lastPickerPath,
  homeDir,
  toAbsolute,
  parentDir,
  toast,
}: PickerBaseOptions): Promise<PickerResult> {
  const picker = getPicker();
  if (!picker) {
    toast('File picker unavailable');
    return { path: null, lastPickerPath };
  }
  const baseStart = startPath || (currentPath ? parentDir(currentPath) : lastPickerPath);
  const initial = toAbsolute(baseStart, null, homeDir);
  try {
    const choice = await picker.openDirectory({ title: 'Select Folder', startPath: initial, selectLabel: 'Select' });
    if (choice && choice.path) return { path: choice.path, lastPickerPath: choice.path };
    return { path: null, lastPickerPath };
  } catch (error) {
    const message = errorMessage(error);
    if (message === 'cancelled') return { path: null, lastPickerPath };
    toast(message || 'Browse failed');
    return { path: null, lastPickerPath };
  }
}

export async function pickSaveTargetWithPicker({
  currentPath,
  lastPickerPath,
  homeDir,
  toAbsolute,
  parentDir,
  basename,
  toast,
}: PickerSaveOptions): Promise<PickerSaveChoice | null> {
  const picker = getPicker();
  if (!picker) {
    toast('File picker unavailable');
    return null;
  }
  const baseDir = currentPath ? parentDir(currentPath) : lastPickerPath;
  const initialDir = toAbsolute(baseDir, null, homeDir);
  try {
    const result = await picker.saveFile({
      title: 'Save As',
      startPath: initialDir,
      filename: currentPath ? basename(currentPath) : '',
      selectLabel: 'Save',
    });
    return result || null;
  } catch (error) {
    const message = errorMessage(error);
    if (message === 'cancelled') return null;
    toast(message || 'Save cancelled');
    return null;
  }
}
