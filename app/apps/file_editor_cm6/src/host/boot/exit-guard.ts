// @ts-check

/**
 * @param {{
 *   installBeforeExitGuard: (opts: any) => void,
 *   onBeforeExit: (cb: () => any) => void,
 *   getUnsaved: () => boolean,
 *   showConfirm: () => Promise<boolean>,
 *   toast: (msg: string) => void,
 *   flushSessionState: (force?: boolean) => Promise<any>,
 * }} deps
 */
export function installHostExitGuard(deps) {
  deps.installBeforeExitGuard({
    onBeforeExit: (cb) => deps.onBeforeExit(cb),
    getUnsaved: () => deps.getUnsaved(),
    showConfirm: () => deps.showConfirm(),
    toast: (msg) => deps.toast(msg),
    flushSessionState: (force) => deps.flushSessionState(force),
  });
}
