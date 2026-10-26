import { isUnknownArray } from '../src/rpc/value-types.ts';
import { sha256 } from '@noble/hashes/sha2.js';

interface MonacoModelLike {
  getValue?(): string;
}

export function matchesExpectedMirrorContent(expected: unknown, model: unknown): boolean {
  if (expected === undefined) return true;
  if (typeof expected !== 'string' || !/^[a-f\d]{64}$/.test(expected)
      || !model || typeof (model as MonacoModelLike).getValue !== 'function') return false;
  const bytes = new TextEncoder().encode((model as MonacoModelLike).getValue!());
  const digest = Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  return digest === expected;
}

export function shouldDropMirrorForSha(
  payloadSha: unknown,
  lastContentSha256: string | null | undefined,
  model: unknown,
  payloadContent: unknown,
): boolean {
  if (payloadSha && lastContentSha256 && String(payloadSha) === String(lastContentSha256)) return true;
  const typedModel = model != null && typeof model === 'object' && !isUnknownArray(model)
    ? model as MonacoModelLike
    : null;
  if (typedModel && typeof typedModel.getValue === 'function' && typedModel.getValue() === payloadContent) return true;
  return false;
}
