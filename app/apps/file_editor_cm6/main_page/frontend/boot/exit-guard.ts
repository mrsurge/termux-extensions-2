interface HostExitGuardDeps {
  installBeforeExitGuard: (opts: {
    onBeforeExit: (cb: () => Record<string, unknown>) => void;
    getUnsaved: () => boolean;
    showConfirm: () => Promise<boolean> | boolean | void;
    toast: (msg: string) => void;
    flushSessionState: (force?: boolean) => Promise<unknown> | void;
  }) => void;
  onBeforeExit: (cb: () => Record<string, unknown>) => void;
  getUnsaved: () => boolean;
  showConfirm: () => Promise<boolean>;
  toast: (msg: string) => void;
  flushSessionState: (force?: boolean) => Promise<unknown>;
}

export function installHostExitGuard(deps: HostExitGuardDeps): void {
  deps.installBeforeExitGuard({
    onBeforeExit: (cb) => deps.onBeforeExit(cb),
    getUnsaved: () => deps.getUnsaved(),
    showConfirm: () => deps.showConfirm(),
    toast: (msg: string) => deps.toast(msg),
    flushSessionState: (force?: boolean) => deps.flushSessionState(force),
  });
}
