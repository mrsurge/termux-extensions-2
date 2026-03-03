// @ts-check

/**
 * @param {{
 *   pickFileWithPicker: (opts: any) => Promise<{ path: string|null, lastPickerPath: string }>,
 *   pickDirectoryWithPicker: (opts: any) => Promise<{ path: string|null, lastPickerPath: string }>,
 *   pickSaveTargetWithPicker: (opts: any) => Promise<any>,
 *   pickerAvailable: () => boolean,
 *   getCurrentPath: () => string,
 *   getLastPickerPath: () => string,
 *   setLastPickerPath: (path: string) => void,
 *   homeDir: string,
 *   toAbsolute: (path: string, base?: string|null, home?: string) => string,
 *   parentDir: (path: string) => string,
 *   basename: (path: string) => string,
 *   toast: (msg: string) => void,
 * }} deps
 */
export function createPickerController(deps) {
  function pickerAvailable() {
    return deps.pickerAvailable();
  }

  async function pickFile(startPath) {
    const res = await deps.pickFileWithPicker({
      startPath,
      currentPath: deps.getCurrentPath(),
      lastPickerPath: deps.getLastPickerPath(),
      homeDir: deps.homeDir,
      toAbsolute: deps.toAbsolute,
      parentDir: deps.parentDir,
      toast: (m) => deps.toast(m),
    });
    deps.setLastPickerPath(res.lastPickerPath);
    return res.path;
  }

  async function pickDirectory(startPath) {
    const res = await deps.pickDirectoryWithPicker({
      startPath,
      currentPath: deps.getCurrentPath(),
      lastPickerPath: deps.getLastPickerPath(),
      homeDir: deps.homeDir,
      toAbsolute: deps.toAbsolute,
      parentDir: deps.parentDir,
      toast: (m) => deps.toast(m),
    });
    deps.setLastPickerPath(res.lastPickerPath);
    return res.path;
  }

  async function pickSaveTarget() {
    return deps.pickSaveTargetWithPicker({
      currentPath: deps.getCurrentPath(),
      lastPickerPath: deps.getLastPickerPath(),
      homeDir: deps.homeDir,
      toAbsolute: deps.toAbsolute,
      parentDir: deps.parentDir,
      basename: deps.basename,
      toast: (m) => deps.toast(m),
    });
  }

  return { pickerAvailable, pickFile, pickDirectory, pickSaveTarget };
}
