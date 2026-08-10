import type { PickerBaseOptions, PickerResult, PickerSaveChoice, PickerSaveOptions } from './picker-helpers.ts';

interface PickerControllerDeps {
  pickFileWithPicker: (opts: PickerBaseOptions) => Promise<PickerResult>;
  pickDirectoryWithPicker: (opts: PickerBaseOptions) => Promise<PickerResult>;
  pickSaveTargetWithPicker: (opts: PickerSaveOptions) => Promise<PickerSaveChoice | null>;
  pickerAvailable: () => boolean;
  getCurrentPath: () => string | null;
  getLastPickerPath: () => string;
  setLastPickerPath: (path: string) => void;
  homeDir: string;
  toAbsolute: (path: string | null | undefined, base?: string | null, home?: string) => string;
  parentDir: (path: string | null | undefined) => string;
  basename: (path: string | null | undefined) => string;
  toast: (msg: string) => void;
}

export function createPickerController(deps: PickerControllerDeps) {
  function pickerAvailable(): boolean {
    return deps.pickerAvailable();
  }

  async function pickFile(startPath?: string | null): Promise<string | null> {
    const res = await deps.pickFileWithPicker({
      startPath,
      currentPath: deps.getCurrentPath(),
      lastPickerPath: deps.getLastPickerPath(),
      homeDir: deps.homeDir,
      toAbsolute: deps.toAbsolute,
      parentDir: deps.parentDir,
      toast: (message: string) => deps.toast(message),
    });
    deps.setLastPickerPath(res.lastPickerPath);
    return res.path;
  }

  async function pickDirectory(startPath?: string | null): Promise<string | null> {
    const res = await deps.pickDirectoryWithPicker({
      startPath,
      currentPath: deps.getCurrentPath(),
      lastPickerPath: deps.getLastPickerPath(),
      homeDir: deps.homeDir,
      toAbsolute: deps.toAbsolute,
      parentDir: deps.parentDir,
      toast: (message: string) => deps.toast(message),
    });
    deps.setLastPickerPath(res.lastPickerPath);
    return res.path;
  }

  async function pickSaveTarget(): Promise<PickerSaveChoice | null> {
    return deps.pickSaveTargetWithPicker({
      currentPath: deps.getCurrentPath(),
      lastPickerPath: deps.getLastPickerPath(),
      homeDir: deps.homeDir,
      toAbsolute: deps.toAbsolute,
      parentDir: deps.parentDir,
      basename: deps.basename,
      toast: (message: string) => deps.toast(message),
    });
  }

  return { pickerAvailable, pickFile, pickDirectory, pickSaveTarget };
}
