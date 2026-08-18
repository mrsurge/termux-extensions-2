import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";

import type {
  LocalFrameworkConfigView,
  LocalFrameworkOwnership,
  LocalFrameworkPhase,
  LocalFrameworkState,
} from "../shared/contracts";
import { localFrameworkChildEnvironment } from "./local-framework-config";

const CONTROL_PROTOCOL_VERSION = 1;
const CONTROL_MAX_BUFFER_BYTES = 64 * 1024;
const DEFAULT_READINESS_ATTEMPTS = 120;
const DEFAULT_READINESS_DELAY_MS = 250;
const DEFAULT_CONTROL_HELLO_TIMEOUT_MS = 5_000;
const DEFAULT_STOP_TIMEOUT_MS = 8_000;

export type LocalFrameworkProbe =
  | { kind: "free" }
  | { kind: "te2"; instanceId: string; version: string }
  | { kind: "occupied"; error: string };

type LocalFrameworkControllerOptions = {
  getLaunchConfig: () => LocalFrameworkConfigView;
  environment?: NodeJS.ProcessEnv;
  getSelectedOrigin: () => string;
  selectLocal: (port: number) => Promise<void>;
  publish: (state: LocalFrameworkState) => void;
  spawnFramework?: typeof spawn;
  probeFramework?: (origin: string) => Promise<LocalFrameworkProbe>;
  wait?: (milliseconds: number) => Promise<void>;
  log?: (stream: "stdout" | "stderr", text: string) => void;
  readinessAttempts?: number;
  readinessDelayMs?: number;
  controlHelloTimeoutMs?: number;
  stopTimeoutMs?: number;
};

type MutableState = {
  phase: LocalFrameworkPhase;
  ownership: LocalFrameworkOwnership;
  processId: number | null;
  error: string | null;
};

type ResolvedControllerOptions = {
  getLaunchConfig: () => LocalFrameworkConfigView;
  environment: NodeJS.ProcessEnv;
  getSelectedOrigin: () => string;
  selectLocal: (port: number) => Promise<void>;
  publish: (state: LocalFrameworkState) => void;
  spawnFramework: typeof spawn;
  probeFramework: (origin: string) => Promise<LocalFrameworkProbe>;
  wait: (milliseconds: number) => Promise<void>;
  log: (stream: "stdout" | "stderr", text: string) => void;
  readinessAttempts: number;
  readinessDelayMs: number;
  controlHelloTimeoutMs: number;
  stopTimeoutMs: number;
};

function nestedErrorCode(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== "object") return "";
    const record = current as Record<string, unknown>;
    if (typeof record.code === "string" && record.code) return record.code;
    current = record.cause;
  }
  return "";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : String(error || fallback);
}

function localOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export async function probeLocalFramework(
  origin: string,
  timeoutMs = 1_000,
  fetchImpl: typeof fetch = fetch,
): Promise<LocalFrameworkProbe> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${origin}/api/health`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return { kind: "occupied", error: `Local port returned HTTP ${response.status}` };
    }
    const payload = await response.json() as Record<string, unknown>;
    const expectedPort = Number(new URL(origin).port);
    if (
      payload.status !== "ok" ||
      payload.app !== "te2" ||
      Number(payload.port) !== expectedPort ||
      typeof payload.instanceId !== "string"
    ) {
      return { kind: "occupied", error: "Local port is not a TE2 framework" };
    }
    return {
      kind: "te2",
      instanceId: payload.instanceId,
      version: String(payload.version || ""),
    };
  } catch (error) {
    if (nestedErrorCode(error) === "ECONNREFUSED") return { kind: "free" };
    return {
      kind: "occupied",
      error: errorMessage(error, "Local framework probe failed"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function defaultLog(stream: "stdout" | "stderr", text: string): void {
  const target = stream === "stdout" ? process.stdout : process.stderr;
  target.write(`[te2-local:${stream}] ${text}`);
}

function signalOwnedProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid && process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // Fall through to the exact child when the process group is already gone.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The child may have exited between the state check and signal.
  }
}

function childIsRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

export class LocalFrameworkController {
  readonly #options: ResolvedControllerOptions;
  #state: MutableState;
  #child: ChildProcess | null = null;
  #exitPromise: Promise<void> | null = null;
  #refreshOperation: Promise<LocalFrameworkState> | null = null;
  #startOperation: Promise<LocalFrameworkState> | null = null;
  #stopOperation: Promise<LocalFrameworkState> | null = null;
  #requestSequence = 0;

  constructor(options: LocalFrameworkControllerOptions) {
    this.#options = {
      ...options,
      environment: options.environment || process.env,
      spawnFramework: options.spawnFramework || spawn,
      probeFramework: options.probeFramework || probeLocalFramework,
      wait: options.wait || defaultWait,
      log: options.log || defaultLog,
      readinessAttempts: options.readinessAttempts || DEFAULT_READINESS_ATTEMPTS,
      readinessDelayMs: options.readinessDelayMs || DEFAULT_READINESS_DELAY_MS,
      controlHelloTimeoutMs:
        options.controlHelloTimeoutMs || DEFAULT_CONTROL_HELLO_TIMEOUT_MS,
      stopTimeoutMs: options.stopTimeoutMs || DEFAULT_STOP_TIMEOUT_MS,
    };
    const config = options.getLaunchConfig();
    this.#state = {
      phase: config.commandDetected && !config.error ? "idle" : "unavailable",
      ownership: "none",
      processId: null,
      error: config.error,
    };
  }

  snapshot(): LocalFrameworkState {
    const config = this.#options.getLaunchConfig();
    const origin = localOrigin(config.port);
    return {
      supported: true,
      ...this.#state,
      localOrigin: origin,
      selected: this.#options.getSelectedOrigin() === origin,
      command: config.resolvedCommand,
      commandSource: config.commandSource,
      commandDetected: config.commandDetected,
      venv: config.venv,
      venvPath: config.venvPath,
      broadcast: [...config.broadcast],
    };
  }

  publishCurrent(): LocalFrameworkState {
    return this.#publish();
  }

  ownsRunningProcess(): boolean {
    return Boolean(
      this.#child &&
      childIsRunning(this.#child) &&
      this.#state.ownership === "electron",
    );
  }

  refresh(): Promise<LocalFrameworkState> {
    if (this.#child && childIsRunning(this.#child)) {
      return Promise.resolve(this.#publish());
    }
    if (this.#refreshOperation) return this.#refreshOperation;
    this.#refreshOperation = this.#refresh().finally(() => {
      this.#refreshOperation = null;
    });
    return this.#refreshOperation;
  }

  async #refresh(): Promise<LocalFrameworkState> {
    this.#setState({ phase: "probing", ownership: "none", processId: null, error: null });
    const config = this.#options.getLaunchConfig();
    const result = await this.#options.probeFramework(
      localOrigin(config.port),
    );
    if (this.#child && childIsRunning(this.#child)) return this.#publish();
    if (result.kind === "te2") {
      this.#setState({ phase: "running", ownership: "external", error: null });
    } else if (result.kind === "free") {
      this.#setState({
        phase: config.commandDetected && !config.error ? "idle" : "unavailable",
        ownership: "none",
        error: config.error,
      });
    } else {
      this.#setState({ phase: "failed", ownership: "none", error: result.error });
    }
    return this.snapshot();
  }

  start(): Promise<LocalFrameworkState> {
    if (this.#startOperation) return this.#startOperation;
    this.#startOperation = this.#start().finally(() => {
      this.#startOperation = null;
    });
    return this.#startOperation;
  }

  stop(): Promise<LocalFrameworkState> {
    if (this.#stopOperation) return this.#stopOperation;
    this.#stopOperation = this.#stop().finally(() => {
      this.#stopOperation = null;
    });
    return this.#stopOperation;
  }

  async useLocal(): Promise<LocalFrameworkState> {
    let state = this.snapshot();
    if (state.phase !== "running") state = await this.refresh();
    if (state.phase !== "running") throw new Error("No TE2 framework is running locally");
    await this.#options.selectLocal(this.#options.getLaunchConfig().port);
    return this.#publish();
  }

  shutdownForElectronExit(): void {
    const child = this.#child;
    if (!child || !childIsRunning(child)) return;
    this.#writeShutdown(child);
    child.stdin?.end();
  }

  async #start(): Promise<LocalFrameworkState> {
    const detected = await this.refresh();
    if (detected.phase === "running") return this.useLocal();
    if (detected.phase === "failed") throw new Error(detected.error || "Local port is unavailable");
    const config = this.#options.getLaunchConfig();
    const executable = config.commandDetected ? config.resolvedCommand : "";
    if (!executable || config.error) {
      throw new Error(config.error || "No local TE2 executable is configured");
    }

    const port = config.port;
    this.#setState({ phase: "starting", ownership: "electron", error: null });
    const child = this.#options.spawnFramework(
      executable,
      [
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--stdio-control",
        ...(config.broadcast.length > 0
          ? ["--broadcast", ...config.broadcast]
          : []),
      ],
      {
        detached: process.platform !== "win32",
        env: localFrameworkChildEnvironment(config, this.#options.environment),
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      },
    );
    this.#child = child;
    this.#state.processId = child.pid || null;
    this.#publish();
    this.#forwardLogs(child);
    const hello = this.#readControlHello(child);
    this.#exitPromise = new Promise((resolve) => {
      child.once("close", (code, signal) => {
        const wasStopping = this.#state.phase === "stopping";
        if (this.#child === child) this.#child = null;
        this.#state.processId = null;
        if (wasStopping) {
          this.#setState({ phase: "exited", ownership: "none", error: null });
        } else if (this.#state.phase === "starting") {
          this.#setState({
            phase: "failed",
            ownership: "none",
            error: `Local TE2 exited before readiness (${code ?? signal ?? "unknown"})`,
          });
        } else {
          this.#setState({
            phase: code === 0 ? "exited" : "failed",
            ownership: "none",
            error: code === 0 ? null : `Local TE2 exited with status ${code ?? signal ?? "unknown"}`,
          });
        }
        resolve();
      });
    });
    child.once("error", (error) => {
      this.#setState({
        phase: "failed",
        ownership: "none",
        error: errorMessage(error, "Failed to start local TE2"),
      });
    });

    try {
      await Promise.all([
        this.#withTimeout(hello, this.#options.controlHelloTimeoutMs),
        this.#waitForReadiness(port),
      ]);
      if (this.#child !== child || !childIsRunning(child)) {
        throw new Error("Local TE2 exited before readiness");
      }
      this.#setState({ phase: "running", ownership: "electron", error: null });
      await this.#options.selectLocal(port);
      return this.#publish();
    } catch (error) {
      await this.#stopOwnedChild(child);
      this.#setState({
        phase: "failed",
        ownership: "none",
        processId: null,
        error: errorMessage(error, "Local TE2 startup failed"),
      });
      throw error;
    }
  }

  async #stop(): Promise<LocalFrameworkState> {
    const child = this.#child;
    if (!child || !childIsRunning(child)) {
      if (this.#state.ownership === "external") {
        throw new Error("The local TE2 framework is externally owned");
      }
      return this.#publish();
    }
    this.#setState({ phase: "stopping", ownership: "electron", error: null });
    await this.#stopOwnedChild(child);
    return this.snapshot();
  }

  async #stopOwnedChild(child: ChildProcess): Promise<void> {
    if (!childIsRunning(child)) return;
    const exit = this.#exitPromise;
    if (!exit) throw new Error("Local TE2 process exit tracking is unavailable");
    this.#writeShutdown(child);
    try {
      await this.#withTimeout(exit, this.#options.stopTimeoutMs);
      return;
    } catch {
      signalOwnedProcess(child, "SIGTERM");
    }
    try {
      await this.#withTimeout(exit, 5_000);
    } catch {
      signalOwnedProcess(child, "SIGKILL");
      await this.#withTimeout(exit, 2_000);
    }
  }

  #writeShutdown(child: ChildProcess): void {
    if (!child.stdin || child.stdin.destroyed || !child.stdin.writable) return;
    const request = {
      version: CONTROL_PROTOCOL_VERSION,
      id: `electron-${++this.#requestSequence}`,
      method: "shutdown",
    };
    child.stdin.write(`${JSON.stringify(request)}\n`);
  }

  async #waitForReadiness(port: number): Promise<void> {
    const origin = localOrigin(port);
    for (let attempt = 0; attempt < this.#options.readinessAttempts; attempt += 1) {
      if (!this.#child || !childIsRunning(this.#child)) {
        throw new Error("Local TE2 exited before readiness");
      }
      const result = await this.#options.probeFramework(origin);
      if (result.kind === "te2") return;
      if (result.kind === "occupied") throw new Error(result.error);
      await this.#options.wait(this.#options.readinessDelayMs);
    }
    throw new Error(`Local TE2 did not become ready at ${origin}`);
  }

  #readControlHello(child: ChildProcess): Promise<void> {
    const stream = child.stdio[3] as Readable | null;
    if (!stream) return Promise.reject(new Error("Local TE2 control FD is unavailable"));
    return new Promise((resolve, reject) => {
      let buffer = "";
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        stream.off("data", onData);
        if (error) reject(error);
        else resolve();
      };
      const onData = (chunk: string) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > CONTROL_MAX_BUFFER_BYTES) {
          finish(new Error("Local TE2 control frame is too large"));
          return;
        }
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          try {
            const frame = JSON.parse(line) as Record<string, unknown>;
            if (
              frame.version === CONTROL_PROTOCOL_VERSION &&
              frame.type === "hello" &&
              Array.isArray(frame.capabilities) &&
              frame.capabilities.includes("shutdown")
            ) {
              finish();
              return;
            }
          } catch {
            // Ignore ordinary malformed frames until the bounded hello deadline.
          }
          newline = buffer.indexOf("\n");
        }
      };
      stream.setEncoding("utf8");
      stream.on("data", onData);
      stream.once("end", () => finish(new Error("Local TE2 control FD closed before hello")));
      stream.once("error", (error) => finish(error));
    });
  }

  #forwardLogs(child: ChildProcess): void {
    child.stdout?.on("data", (chunk: Buffer | string) => {
      this.#options.log("stdout", String(chunk));
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      this.#options.log("stderr", String(chunk));
    });
  }

  async #withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
    let timeout: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("Local TE2 operation timed out")), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  #setState(update: Partial<MutableState>): void {
    this.#state = { ...this.#state, ...update };
    this.#publish();
  }

  #publish(): LocalFrameworkState {
    const snapshot = this.snapshot();
    this.#options.publish(snapshot);
    return snapshot;
  }
}
