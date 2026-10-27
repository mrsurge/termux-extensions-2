import {createElectronMain} from '../../vendor/electromux/runtime/src/electron-main';
import {type NativeEffect, type MainWindow} from '../../vendor/electromux/runtime/src/electron-compat';
import {type Parameters} from '../../vendor/electromux/runtime/src/protocol';

/** TE2 supplies policy; window ordering, API behavior and effects are upstream-owned. */
export function createElectronNavigation(apply: (effect: NativeEffect) => Promise<void>, version: string) {
  const createHost = () => {
    const host = createElectronMain({schemaVersion: 1, windows: 'main-only',
      chrome: {style: 'gnome', titleBar: false, menuBar: false}, disabledMenuItems: {}, deferredFeatures: {}},
    {apply, supportsRole: () => false, report: error => console.error('Window effect failed:', error.message)},
    {name: 'TE2 Termux', version, versions: {}}, message => console.warn(message));
    host.markReady();
    return host;
  };
  let host = createHost();
  let window: MainWindow | undefined;
  return async (params: Parameters | undefined): Promise<Record<string, unknown>> => {
    if (!params || !['home', 'reload'].includes(String(params.action))) throw new Error('Unsupported window action');
    const action = params.action;
    if (Object.keys(params).some(key => key !== 'action' && !(action === 'home' && key === 'url')))
      throw new Error('Unexpected window action parameter');
    let url: URL | undefined;
    if (action === 'home') {
      if (typeof params.url !== 'string') throw new Error('Native launcher URL required');
      url = new URL(params.url);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password ||
          url.pathname !== '/electromux-shell/index.html' || url.search || url.hash)
        throw new Error('Packaged loopback launcher required');
    }
    try {
      window ??= new host.electron.BrowserWindow({});
      if (url) await window.loadURL(url.href);
      else window.webContents.reload();
      await host.owner.flush();
    } catch (error) {
      // Retire failed window ownership; only a NEW explicit intent can register
      // the native surface again. Never retry/replay this uncertain mutation.
      host = createHost(); window = undefined;
      throw error;
    }
    return {completed: true};
  };
}
