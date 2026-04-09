import rawDefault, { HtermModuleLike } from 'hterm/public.js';
import * as htermNamespace from 'hterm/public.js';

type MaybeRecord = Record<string, unknown>;

function asHtermModule(value: unknown): HtermModuleLike | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as MaybeRecord;
  return typeof candidate.Terminal === 'function' ? (candidate as unknown as HtermModuleLike) : null;
}

function normalizeHtermModule(): HtermModuleLike {
  const ns = htermNamespace as unknown as MaybeRecord;
  const defaultRecord = (ns.default && typeof ns.default === 'object') ? (ns.default as MaybeRecord) : null;

  const resolved =
    asHtermModule(rawDefault) ??
    asHtermModule(ns.hterm) ??
    asHtermModule(ns.default) ??
    asHtermModule(defaultRecord?.default) ??
    asHtermModule(defaultRecord?.hterm);

  if (!resolved) {
    throw new Error('Unable to resolve hterm Terminal constructor from vendored runtime');
  }

  return resolved;
}

const htermModule = normalizeHtermModule();

export default htermModule;
