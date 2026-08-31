import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import type { ChildProcess, spawn } from "node:child_process";

import type {
  LocalFrameworkConfigView,
  LocalFrameworkState,
} from "../shared/contracts";
import {
  LocalFrameworkController,
  probeLocalFramework,
  type LocalFrameworkProbe,
} from "./local-framework-controller";

type FakeChild = ChildProcess & {
  emitClose(code: number | null, signal?: NodeJS.Signals | null): void;
  control: PassThrough;
};

function fakeChild(pid = 4242): FakeChild {
  const child = new EventEmitter() as ChildProcess & {
    pid: number;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    stdio: [PassThrough, PassThrough, PassThrough, PassThrough, ...Array<null>];
  };
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const control = new PassThrough();
  Object.assign(child, {
    pid,
    exitCode: null,
    signalCode: null,
    stdin,
    stdout,
    stderr,
    stdio: [stdin, stdout, stderr, control],
  });
  const result = child as unknown as FakeChild;
  child.kill = (signal = "SIGTERM") => {
    child.signalCode = signal as NodeJS.Signals;
    queueMicrotask(() => result.emitClose(null, child.signalCode));
    return true;
  };
  result.control = control;
  result.emitClose = (code, signal = null) => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit("close", code, signal);
  };
  return result;
}

function hello(child: FakeChild): void {
  child.control.write(`${JSON.stringify({
    version: 1,
    type: "hello",
    capabilities: ["shutdown"],
  })}\n`);
}

function controllerOptions(overrides: {
  config?: Partial<LocalFrameworkConfigView>;
  environment?: NodeJS.ProcessEnv;
  probeFramework?: (origin: string) => Promise<LocalFrameworkProbe>;
  spawnFramework?: typeof spawn;
  selectLocal?: (port: number) => Promise<void>;
  getSelectedOrigin?: () => string;
  publish?: (state: LocalFrameworkState) => void;
} = {}) {
  const config: LocalFrameworkConfigView = {
    version: 1,
    command: "/opt/te2/bin/te2",
    venvPath: "",
    broadcast: [],
    port: 8089,
    env: {},
    persisted: true,
    path: "/home/test/.config/te2/desktop-local-framework.json",
    resolvedCommand: "/opt/te2/bin/te2",
    commandSource: "configured",
    commandDetected: true,
    venv: false,
    error: null,
    ...overrides.config,
  };
  return {
    getLaunchConfig: () => config,
    environment: overrides.environment,
    getSelectedOrigin: overrides.getSelectedOrigin || (() => "http://remote.example:8089"),
    selectLocal: overrides.selectLocal || (async () => {}),
    publish: overrides.publish || (() => {}),
    spawnFramework: overrides.spawnFramework,
    probeFramework: overrides.probeFramework,
    wait: async () => {},
    readinessAttempts: 3,
    readinessDelayMs: 1,
    controlHelloTimeoutMs: 100,
    stopTimeoutMs: 100,
  };
}

test("health probing distinguishes TE2, a free port, and another service", async () => {
  const valid = await probeLocalFramework(
    "http://127.0.0.1:8089",
    100,
    async () => new Response(JSON.stringify({
      status: "ok",
      app: "te2",
      version: "0.2.329",
      instanceId: "instance-1",
      port: 8089,
    }), { status: 200, headers: { "content-type": "application/json" } }),
  );
  assert.deepEqual(valid, {
    kind: "te2",
    instanceId: "instance-1",
    version: "0.2.329",
  });

  const occupied = await probeLocalFramework(
    "http://127.0.0.1:8089",
    100,
    async () => new Response(JSON.stringify({ status: "ok", app: "other" })),
  );
  assert.equal(occupied.kind, "occupied");

  const refused = Object.assign(new Error("fetch failed"), {
    cause: Object.assign(new Error("connect refused"), { code: "ECONNREFUSED" }),
  });
  assert.deepEqual(
    await probeLocalFramework("http://127.0.0.1:8089", 100, async () => {
      throw refused;
    }),
    { kind: "free" },
  );
});

test("external TE2 can be selected but not stopped", async () => {
  let selected = "http://remote.example:8089";
  const controller = new LocalFrameworkController(controllerOptions({
    probeFramework: async () => ({
      kind: "te2",
      instanceId: "external",
      version: "0.2.329",
    }),
    getSelectedOrigin: () => selected,
    selectLocal: async (port) => {
      selected = `http://127.0.0.1:${port}`;
    },
  }));

  assert.equal((await controller.refresh()).ownership, "external");
  const used = await controller.useLocal();
  assert.equal(used.selected, true);
  await assert.rejects(() => controller.stop(), /externally owned/);
});

test("concurrent local framework probes are single-flight", async () => {
  let resolveProbe: (value: LocalFrameworkProbe) => void = () => {
    throw new Error("Probe promise was not initialized");
  };
  let probeCount = 0;
  const controller = new LocalFrameworkController(controllerOptions({
    probeFramework: () => {
      probeCount += 1;
      return new Promise((resolve) => {
        resolveProbe = resolve;
      });
    },
  }));
  const first = controller.refresh();
  const second = controller.refresh();
  assert.equal(first, second);
  resolveProbe({ kind: "free" });
  await Promise.all([first, second]);
  assert.equal(probeCount, 1);
});

test("an external TE2 remains usable without a configured spawn executable", async () => {
  const controller = new LocalFrameworkController({
    ...controllerOptions({
      config: {
        command: "",
        resolvedCommand: "",
        commandSource: "none",
        commandDetected: false,
      },
      probeFramework: async () => ({
        kind: "te2",
        instanceId: "external",
        version: "0.2.329",
      }),
    }),
  });
  const state = await controller.refresh();
  assert.equal(state.supported, true);
  assert.equal(state.ownership, "external");
});

test("Electron starts, selects, and gracefully stops its exact TE2 child", async () => {
  const child = fakeChild();
  const spawnCalls: Array<{
    executable: string;
    args: readonly string[];
    environment: NodeJS.ProcessEnv;
  }> = [];
  let probeCount = 0;
  let selected = "http://remote.example:8089";
  let shutdownFrame = "";
  child.stdin!.on("data", (chunk) => {
    shutdownFrame += String(chunk);
    if (shutdownFrame.includes("\n")) queueMicrotask(() => child.emitClose(0));
  });

  const controller = new LocalFrameworkController(controllerOptions({
    config: {
      venvPath: "/opt/te2/venv",
      venv: true,
      broadcast: ["tailscale0", "100.64.0.0/10"],
      env: { TE2_SAMPLE: "configured", PATH: "/custom/bin" },
    },
    environment: { HOME: "/home/test", PATH: "/base/bin" },
    getSelectedOrigin: () => selected,
    selectLocal: async (port) => {
      selected = `http://127.0.0.1:${port}`;
    },
    probeFramework: async () => {
      probeCount += 1;
      return probeCount === 1
        ? { kind: "free" }
        : { kind: "te2", instanceId: "owned", version: "0.2.329" };
    },
    spawnFramework: ((
      executable: string,
      args: readonly string[],
      options: { env?: NodeJS.ProcessEnv },
    ) => {
      spawnCalls.push({ executable, args, environment: options.env || {} });
      queueMicrotask(() => hello(child));
      return child;
    }) as unknown as typeof spawn,
  }));

  const started = await controller.start();
  assert.equal(started.phase, "running");
  assert.equal(started.ownership, "electron");
  assert.equal(started.selected, true);
  assert.deepEqual(spawnCalls, [{
    executable: "/opt/te2/bin/te2",
    args: [
      "--host",
      "127.0.0.1",
      "--port",
      "8089",
      "--stdio-control",
      "--broadcast",
      "tailscale0",
      "100.64.0.0/10",
    ],
    environment: {
      HOME: "/home/test",
      PATH: "/opt/te2/venv/bin:/custom/bin",
      TE2_SAMPLE: "configured",
      VIRTUAL_ENV: "/opt/te2/venv",
    },
  }]);

  const stopped = await controller.stop();
  assert.equal(stopped.phase, "exited");
  assert.equal(stopped.ownership, "none");
  assert.deepEqual(JSON.parse(shutdownFrame), {
    version: 1,
    id: "electron-1",
    method: "shutdown",
  });
});

test("a running child keeps its exact launch configuration while next-start values change", async () => {
  const baseOptions = controllerOptions();
  let config = baseOptions.getLaunchConfig();
  let probeCount = 0;
  const selectedPorts: number[] = [];
  const children = [fakeChild(5001), fakeChild(5002)];
  const spawnCalls: Array<{ executable: string; args: readonly string[] }> = [];
  const controller = new LocalFrameworkController({
    ...baseOptions,
    getLaunchConfig: () => config,
    selectLocal: async (port) => {
      selectedPorts.push(port);
    },
    probeFramework: async () => {
      probeCount += 1;
      return probeCount % 2 === 1
        ? { kind: "free" }
        : { kind: "te2", instanceId: "owned", version: "0.2.342" };
    },
    spawnFramework: ((executable: string, args: readonly string[]) => {
      const child = children.shift();
      if (!child) throw new Error("Unexpected extra local framework spawn");
      spawnCalls.push({ executable, args });
      child.stdin!.on("data", () => queueMicrotask(() => child.emitClose(0)));
      queueMicrotask(() => hello(child));
      return child;
    }) as unknown as typeof spawn,
  });

  await controller.start();
  config = {
    ...config,
    port: 9090,
    command: "/opt/te2-next/bin/te2",
    resolvedCommand: "/opt/te2-next/bin/te2",
    broadcast: ["tailscale0"],
  };

  const running = controller.publishCurrent();
  assert.equal(running.localOrigin, "http://127.0.0.1:8089");
  assert.equal(running.command, "/opt/te2/bin/te2");
  assert.deepEqual(running.broadcast, []);
  await controller.useLocal();
  assert.equal(selectedPorts.at(-1), 8089);

  const stopped = await controller.stop();
  assert.equal(stopped.localOrigin, "http://127.0.0.1:9090");
  assert.equal(stopped.command, "/opt/te2-next/bin/te2");
  assert.deepEqual(stopped.broadcast, ["tailscale0"]);

  const restarted = await controller.start();
  assert.equal(restarted.localOrigin, "http://127.0.0.1:9090");
  assert.equal(restarted.command, "/opt/te2-next/bin/te2");
  assert.deepEqual(spawnCalls.at(-1), {
    executable: "/opt/te2-next/bin/te2",
    args: [
      "--host",
      "127.0.0.1",
      "--port",
      "9090",
      "--stdio-control",
      "--broadcast",
      "tailscale0",
    ],
  });
  await controller.stop();
});

test("occupied non-TE2 ports fail without spawning", async () => {
  let spawned = false;
  const controller = new LocalFrameworkController(controllerOptions({
    probeFramework: async () => ({ kind: "occupied", error: "port belongs to another service" }),
    spawnFramework: (() => {
      spawned = true;
      return fakeChild();
    }) as typeof spawn,
  }));

  await assert.rejects(() => controller.start(), /another service/);
  assert.equal(spawned, false);
  assert.equal(controller.snapshot().phase, "failed");
});

test("a post-spawn readiness collision tears down the owned child", async () => {
  const child = fakeChild();
  let probeCount = 0;
  let shutdown = "";
  child.stdin!.on("data", (chunk) => {
    shutdown += String(chunk);
    queueMicrotask(() => child.emitClose(0));
  });
  const controller = new LocalFrameworkController(controllerOptions({
    probeFramework: async () => {
      probeCount += 1;
      return probeCount === 1
        ? { kind: "free" }
        : { kind: "occupied", error: "local port changed ownership during startup" };
    },
    spawnFramework: (() => {
      queueMicrotask(() => hello(child));
      return child;
    }) as typeof spawn,
  }));

  await assert.rejects(() => controller.start(), /changed ownership/);
  assert.match(shutdown, /"method":"shutdown"/);
  assert.equal(controller.snapshot().phase, "failed");
});

test("an Electron-owned framework can be stopped and relaunched", async () => {
  let probeCount = 0;
  let spawnCount = 0;
  const controller = new LocalFrameworkController(controllerOptions({
    probeFramework: async () => {
      probeCount += 1;
      return probeCount % 2 === 1
        ? { kind: "free" }
        : { kind: "te2", instanceId: `owned-${probeCount}`, version: "0.2.329" };
    },
    spawnFramework: (() => {
      spawnCount += 1;
      const child = fakeChild(4242 + spawnCount);
      child.stdin!.on("data", () => queueMicrotask(() => child.emitClose(0)));
      queueMicrotask(() => hello(child));
      return child;
    }) as typeof spawn,
  }));

  assert.equal((await controller.start()).phase, "running");
  assert.equal((await controller.stop()).phase, "exited");
  assert.equal((await controller.start()).phase, "running");
  assert.equal(spawnCount, 2);
  assert.equal((await controller.stop()).phase, "exited");
});

test("unexpected owned-child exit is published as failure", async () => {
  const child = fakeChild();
  let probeCount = 0;
  const published: LocalFrameworkState[] = [];
  const controller = new LocalFrameworkController(controllerOptions({
    publish: (state) => published.push(state),
    probeFramework: async () => {
      probeCount += 1;
      return probeCount === 1
        ? { kind: "free" }
        : { kind: "te2", instanceId: "owned", version: "0.2.329" };
    },
    spawnFramework: (() => {
      queueMicrotask(() => hello(child));
      return child;
    }) as typeof spawn,
  }));

  await controller.start();
  child.emitClose(9);
  assert.equal(controller.snapshot().phase, "failed");
  assert.match(controller.snapshot().error || "", /status 9/);
  assert.equal(published.at(-1)?.phase, "failed");
});

test("Electron exit sends shutdown and closes the bootstrap stdin owner channel", async () => {
  const child = fakeChild();
  let probeCount = 0;
  let input = "";
  let ended = false;
  child.stdin!.on("data", (chunk) => {
    input += String(chunk);
  });
  child.stdin!.on("end", () => {
    ended = true;
  });
  const controller = new LocalFrameworkController(controllerOptions({
    probeFramework: async () => {
      probeCount += 1;
      return probeCount === 1
        ? { kind: "free" }
        : { kind: "te2", instanceId: "owned", version: "0.2.329" };
    },
    spawnFramework: (() => {
      queueMicrotask(() => hello(child));
      return child;
    }) as typeof spawn,
  }));

  await controller.start();
  controller.shutdownForElectronExit();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(input, /"method":"shutdown"/);
  assert.equal(ended, true);
});
