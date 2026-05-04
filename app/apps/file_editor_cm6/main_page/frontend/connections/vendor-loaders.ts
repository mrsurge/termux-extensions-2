// @ts-check

import type { IoFactory } from '../../../src/rpc/transport.ts';

interface VendorLoaderWindow {
  VConsole?: unknown;
  io?: IoFactory;
}

function getVendorLoaderWindow(): VendorLoaderWindow {
  return window as unknown as VendorLoaderWindow;
}

export function ensureSocketIoLoaded(): Promise<IoFactory | undefined> {
  const runtimeWindow = getVendorLoaderWindow();
  if (runtimeWindow.io) return Promise.resolve(runtimeWindow.io);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/static/vendor/socket.io.min.js';
    script.async = true;
    script.onload = () => resolve(getVendorLoaderWindow().io);
    script.onerror = () => reject(new Error('Failed to load Socket.IO client'));
    document.head.appendChild(script);
  });
}

export function ensureVConsoleLoaded(): Promise<unknown> {
  const runtimeWindow = getVendorLoaderWindow();
  if (runtimeWindow.VConsole) return Promise.resolve(runtimeWindow.VConsole);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/apps/file_editor_cm6/static/vendor/vconsole/vconsole.min.js';
    script.async = true;
    script.onload = () => resolve(getVendorLoaderWindow().VConsole);
    script.onerror = () => reject(new Error('Failed to load vConsole'));
    document.head.appendChild(script);
  });
}
