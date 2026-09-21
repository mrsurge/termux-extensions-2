import { randomUUID } from "node:crypto";

export const runtimeDebugEnabled = /^(1|true|yes|on)$/i.test(
  String(process.env.TE2_RUNTIME_DEBUG ?? "").trim(),
);

// Retain a small metadata-only timeline from process startup, without log spam.
export class CompletionTrace {
  private events: Record<string, unknown>[] = [];
  private sequence = 0;
  constructor(public enabled = runtimeDebugEnabled) {}
  record(phase: string, fields: Record<string, unknown> = {}): number {
    if (!this.enabled) return 0;
    const sequence = ++this.sequence;
    const metadata: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields).slice(0, 16)) {
      if (typeof value === "string") metadata[key] = value.slice(0, 256);
      else if (typeof value === "boolean" || typeof value === "number" || value === null) metadata[key] = value;
    }
    this.events.push({ ...metadata, phase, sequence, unixMs: Date.now(), monoMs: performance.now() });
    if (this.events.length > 256) this.events.shift();
    return sequence;
  }
  snapshot(): Record<string, unknown> {
    return { enabled: this.enabled, sequence: this.sequence, events: this.events.map(event => ({ ...event })) };
  }
  clear(): void { this.events.length = 0; }
}

export const completionTrace = new CompletionTrace();

export function projectDebugResult(value: unknown): Record<string, unknown> {
  let budget = 2048;
  let truncated = false;
  const seen = new Set<object>();
  // Never invoke getters/toJSON just to display an inspection result. Trusted
  // evaluation itself is unrestricted; this is a result bound, not a sandbox.
  const visit = (item: unknown, depth: number): unknown => {
    if (--budget < 0 || depth > 12) { truncated = true; return "<limit>"; }
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") return Number.isFinite(item) ? item : String(item);
    if (typeof item === "string") {
      if (item.length > 4096) truncated = true;
      return item.slice(0, 4096);
    }
    if (typeof item !== "object") { truncated = true; return `<${typeof item}>`; }
    if (seen.has(item)) { truncated = true; return "<cycle/shared>"; }
    seen.add(item);
    const output: Record<string, unknown> | unknown[] = Array.isArray(item) ? [] : Object.create(null) as Record<string, unknown>;
    for (const key in item) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
      if (--budget < 0) { truncated = true; break; }
      if (key.length > 1024) { truncated = true; continue; }
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      const projected = descriptor && "value" in descriptor
        ? visit(descriptor.value as unknown, depth + 1)
        : (truncated = true, "<accessor>");
      if (Array.isArray(output)) output.push(projected);
      else output[key] = projected;
    }
    return output;
  };
  const result = { value: visit(value, 0), truncated };
  return Buffer.byteLength(JSON.stringify(result)) <= 64 * 1024
    ? result : { value: null, truncated: true, reason: "result byte limit" };
}

type Evaluator = (wb: unknown, state: unknown, trace: CompletionTrace, probe: Record<string, unknown>) => Promise<unknown>;
type EvaluatorConstructor = new (...args: string[]) => Evaluator;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as EvaluatorConstructor;

export class WbaRuntimeDebug {
  readonly instanceId = randomUUID();
  private busy = false;
  private readonly probe: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  constructor(private readonly enabled = runtimeDebugEnabled) {}

  async dispatch(method: string, params: Record<string, unknown>, wb: unknown, state: unknown): Promise<Record<string, unknown>> {
    if (!this.enabled) throw new Error("runtimeDebug.disabled");
    if (method === "runtime.debug.status") return {
      enabled: true, instanceId: this.instanceId, pid: process.pid,
      runtime: process.versions.bun ? "bun" : "node", busy: this.busy,
    };
    if (method !== "runtime.debug.eval") throw new Error("runtimeDebug.methodNotFound");
    if (params.instanceId !== this.instanceId) throw new Error("runtimeDebug.staleInstance");
    const code = params.code;
    if (typeof code !== "string" || !code.trim() || Buffer.byteLength(code) > 32 * 1024) throw new Error("runtimeDebug.invalidCode");
    if (this.busy) throw new Error("runtimeDebug.busy");
    this.busy = true;
    try {
      // Same live event loop on Node and Bun. Async work is allowed, but caller
      // timeout cannot undo mutations or preempt synchronous JavaScript.
      let evaluate: Evaluator;
      try { evaluate = new AsyncFunction("wb", "state", "trace", "probe", `"use strict"; return (${code}\n);`); }
      catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        evaluate = new AsyncFunction("wb", "state", "trace", "probe", `"use strict"; let result;\n${code}\n;return result;`);
      }
      return projectDebugResult(await evaluate(wb, state, completionTrace, this.probe));
    } catch (error) {
      throw new Error(error instanceof Error ? error.message.slice(0, 1024) : "runtimeDebug.failed: non-Error thrown");
    } finally { this.busy = false; }
  }
}
