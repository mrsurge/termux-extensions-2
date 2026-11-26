import { isUnknownArray } from './rpc/value-types.ts';

const ttl = 3 * 24 * 60 * 60 * 1000;
const limit = 128;
type Entry = { path: string; used: number };
type WrapState = { base: boolean; overrides: Entry[] };
const memory = new Map<string, string>();

/** Overrides always mean the opposite of this logical client's default. */
export function localWordWrap(client: string) {
  const key = 'code_te2_word_wrap:' + client;
  function write(state: WrapState) {
    const raw = JSON.stringify(state);
    memory.set(key, raw);
    try { localStorage.setItem(key, raw); } catch { /* session-only */ }
  }
  function read(seed?: boolean): WrapState {
    let raw = memory.get(key);
    try { raw = localStorage.getItem(key) ?? raw; } catch { /* session-only */ }
    if (raw) try {
      const data: unknown = JSON.parse(raw);
      if (data && typeof data === 'object' && 'base' in data && typeof data.base === 'boolean'
          && 'overrides' in data && isUnknownArray(data.overrides)) {
        const overrides = data.overrides.filter((x): x is Entry => !!x && typeof x === 'object'
          && 'path' in x && typeof x.path === 'string' && 'used' in x && typeof x.used === 'number'
          && x.used > Date.now() - ttl).slice(-limit);
        const state = { base: data.base, overrides };
        if (overrides.length !== data.overrides.length) write(state);
        return state;
      }
    } catch { /* invalid or obsolete */ }
    const state = { base: seed ?? false, overrides: [] };
    if (seed !== undefined) write(state);
    return state;
  }
  function changed(state: WrapState) { write(state); window.dispatchEvent(new Event(key)); }
  return {
    value(path: string | null, seed?: boolean, touch = false) {
      const state = read(seed);
      const entry = state.overrides.find(x => x.path === path);
      if (entry && touch) {
        state.overrides = [...state.overrides.filter(x => x !== entry), { path: entry.path, used: Date.now() }];
        write(state);
      }
      return entry ? !state.base : state.base;
    },
    toggle(path: string | null, seed?: boolean) {
      const state = read(seed);
      if (!path) { changed({ base: !state.base, overrides: [] }); return; }
      const remaining = state.overrides.filter(x => x.path !== path);
      if (remaining.length === state.overrides.length) remaining.push({ path, used: Date.now() });
      changed({ base: state.base, overrides: remaining.slice(-limit) });
    },
    listen(callback: () => void) {
      const storage = (e: StorageEvent) => { if (e.key === key) callback(); };
      window.addEventListener(key, callback);
      window.addEventListener('storage', storage);
      return () => { window.removeEventListener(key, callback); window.removeEventListener('storage', storage); };
    },
  };
}
