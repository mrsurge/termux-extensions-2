import type { HostAppApi } from './api';
import type { ActionDialog, FilePicker, PickerChoice, PickerOptions } from './action_types';
import type { TabOptions } from './tab_protocol';
import type { TabSocket } from './tab_client';

export function field(value: unknown, name: string): unknown {
  return value && (typeof value === 'object' || typeof value === 'function') ? Reflect.get(value, name) : undefined;
}
function method(value: unknown, name: string, args: unknown[]): unknown {
  const callable = field(value, name);
  if (typeof callable !== 'function') throw new Error(`Missing frontend capability: ${name}`);
  return Reflect.apply(callable, value, args);
}
export function runtimeValue(name: string): unknown { return Reflect.get(window, name); }
export interface AppHost {
  id: string;
  setTitle(title: string): void;
  loadState(): unknown;
  saveState(state: object): void;
  toast(message: string): boolean;
}
export function hostContract(value: unknown): AppHost {
  return {
    id: typeof field(value, 'id') === 'string' ? String(field(value, 'id')) : 'file_explorer',
    setTitle(title) { if (typeof field(value, 'setTitle') === 'function') method(value, 'setTitle', [title]); },
    loadState() { return typeof field(value, 'loadState') === 'function' ? method(value, 'loadState', [null]) : null; },
    saveState(state) { if (typeof field(value, 'saveState') === 'function') method(value, 'saveState', [state]); },
    toast(message) { if (typeof field(value, 'toast') !== 'function') return false; method(value, 'toast', [message]); return true; },
  };
}
export function apiContract(value: unknown): HostAppApi {
  if (typeof field(value, 'get') !== 'function' || typeof field(value, 'post') !== 'function') throw new Error('File Explorer host API is unavailable');
  return { get: async endpoint => await method(value, 'get', [endpoint]), post: async (endpoint, body) => await method(value, 'post', [endpoint, body]) };
}
export function dialogContract(): ActionDialog & { confirm(message: string, options?: object): Promise<boolean> } {
  return {
    async prompt(message, initial) { const result = await method(field(runtimeValue('teUI'), 'dialog'), 'prompt', [message, initial]); if (result == null) return null; if (typeof result !== 'string') throw new Error('Invalid prompt response'); return result; },
    async confirm(message, options?: object) { const result = await method(field(runtimeValue('teUI'), 'dialog'), 'confirm', options ? [message, options] : [message]); if (typeof result !== 'boolean') throw new Error('Invalid confirmation response'); return result; },
  };
}
export function pickerContract(): FilePicker | undefined {
  const picker = runtimeValue('teFilePicker');
  const choice = async (name: string, options: PickerOptions): Promise<PickerChoice | null> => {
    const result = await method(picker, name, [options]); if (result == null) return null;
    const path = field(result, 'path'); if (typeof path !== 'string') throw new Error('Invalid file picker response'); return { path };
  };
  const save = typeof field(picker, 'saveFile') === 'function', directory = typeof field(picker, 'openDirectory') === 'function';
  if (!save && !directory) return undefined;
  return { ...(save ? { saveFile: (options: PickerOptions) => choice('saveFile', options) } : {}), ...(directory ? { openDirectory: (options: PickerOptions) => choice('openDirectory', options) } : {}) };
}
export function uiNotification(notification: object): void {
  const manager = runtimeValue('teUI');
  if (typeof field(manager, 'notify') === 'function') method(manager, 'notify', [notification]);
}
export function dismissNotification(id: string): void {
  const manager = runtimeValue('teUI');
  if (typeof field(manager, 'dismiss') === 'function') method(manager, 'dismiss', [id]);
}
export function uiToast(message: string): void {
  if (!message) return;
  const ui = runtimeValue('teUI');
  if (typeof field(ui, 'toast') === 'function') method(ui, 'toast', [message]);
  else console.log('[toast]', message);
}
export interface Preferences extends TabOptions { path: string }
export function preferenceDto(value: unknown, path: string | null, embedded: boolean): Preferences {
  const savedPath = field(value, 'path'), sort = field(value, 'sortBy');
  return { path: path || (!embedded && typeof savedPath === 'string' ? savedPath : '~'), showHidden: Boolean(field(value, 'showHidden')),
    view: field(value, 'view') === 'grid' ? 'grid' : 'list', sortBy: sort === 'size' || sort === 'type' || sort === 'date' ? sort : 'name', sortAsc: field(value, 'sortAsc') !== false };
}
export interface RuntimeSocket extends TabSocket {
  on(name: string, callback: ((...args: unknown[]) => void) | ((value: never) => void)): void;
  off(name: string, callback: ((...args: unknown[]) => void) | ((value: never) => void)): void;
  once(name: string, callback: (...args: unknown[]) => void): void;
  connect(): void;
}
export type SocketFactory = (namespace: string, options: object) => RuntimeSocket;
function socketContract(raw: unknown): RuntimeSocket {
  for (const name of ['on', 'off', 'once', 'emit', 'connect', 'disconnect']) if (typeof field(raw, name) !== 'function') throw new Error(`Invalid Socket.IO capability: ${name}`);
  return {
    get connected() { return field(raw, 'connected') === true; },
    get sendBuffer() { const buffer = field(raw, 'sendBuffer'); return Array.isArray(buffer) ? buffer : undefined; },
    on(name, callback) { method(raw, 'on', [name, callback]); }, off(name, callback) { method(raw, 'off', [name, callback]); },
    once(name, callback) { method(raw, 'once', [name, callback]); }, emit(name, payload, ack) { method(raw, 'emit', [name, payload, ack]); },
    connect() { method(raw, 'connect', []); }, disconnect() { method(raw, 'disconnect', []); },
  };
}
const SOCKET_IO_CLIENT_SRC = '/static/vendor/socket.io.min.js';
let socketIoLoadPromise: Promise<SocketFactory> | null = null;
export function ensureSocketIoLoaded(): Promise<SocketFactory> {
  const factory = (): SocketFactory => {
    const io = runtimeValue('io'); if (typeof io !== 'function') throw new Error('Socket.IO client failed to initialize');
    return (namespace, options) => socketContract(Reflect.apply(io, window, [namespace, options]));
  };
  if (typeof runtimeValue('io') === 'function') return Promise.resolve(factory());
  if (socketIoLoadPromise) return socketIoLoadPromise;
  socketIoLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SOCKET_IO_CLIENT_SRC}"]`), script = existing ?? document.createElement('script');
    const loaded = () => { try { resolve(factory()); } catch (error) { reject(error); } };
    script.addEventListener('load', loaded, { once: true }); script.addEventListener('error', () => reject(new Error('Socket.IO client failed to load')), { once: true });
    if (!existing) { script.src = SOCKET_IO_CLIENT_SRC; script.async = true; document.head.append(script); }
  });
  return socketIoLoadPromise;
}
export function requireElement<T extends Element>(root: ParentNode, selector: string, type: { new (...args: never[]): T }): T {
  const element = root.querySelector(selector); if (!(element instanceof type)) throw new Error(`File Explorer template missing ${selector}`); return element;
}
