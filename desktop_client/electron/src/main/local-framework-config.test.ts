import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  LOCAL_FRAMEWORK_EXECUTABLE_ENV,
  defaultLocalFrameworkConfig,
  localFrameworkChildEnvironment,
  localFrameworkConfigPath,
  normalizeLocalFrameworkConfig,
  readLocalFrameworkConfig,
  resolveLocalFrameworkConfig,
  writeLocalFrameworkConfig,
} from "./local-framework-config";

async function scratchDirectory(): Promise<string> {
  const root = process.env.TEMPDIR || process.env.TMPDIR || tmpdir();
  return mkdtemp(join(root, "te2-local-config-"));
}

async function executable(path: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "#!/bin/sh\n", "utf8");
  await chmod(path, 0o700);
}

test("an absent config uses unsaved PATH detection and loopback defaults", async () => {
  const scratch = await scratchDirectory();
  try {
    const bin = join(scratch, "bin");
    const command = join(bin, "te2");
    await executable(command);
    const environment = {
      HOME: scratch,
      PATH: bin,
      XDG_CONFIG_HOME: join(scratch, "config"),
    };
    const config = await readLocalFrameworkConfig(environment);
    assert.equal(config.persisted, false);
    assert.equal(config.command, command);
    assert.equal(config.commandSource, "detected");
    assert.equal(config.commandDetected, true);
    assert.equal(config.venv, false);
    assert.equal(config.port, 8089);
    assert.deepEqual(config.broadcast, []);
    assert.deepEqual(config.env, {});
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("the exact executable override wins and must be absolute and runnable", async () => {
  const defaults = defaultLocalFrameworkConfig();
  assert.match(
    (await resolveLocalFrameworkConfig(defaults, {
      environment: { [LOCAL_FRAMEWORK_EXECUTABLE_ENV]: "bin/te2" },
    })).error || "",
    /absolute path/,
  );

  const scratch = await scratchDirectory();
  try {
    const command = join(scratch, "te2");
    await executable(command);
    const resolved = await resolveLocalFrameworkConfig(defaults, {
      environment: { [LOCAL_FRAMEWORK_EXECUTABLE_ENV]: command },
    });
    assert.equal(resolved.command, command);
    assert.equal(resolved.commandSource, "override");
    assert.equal(resolved.commandDetected, true);
    await assert.rejects(
      () => writeLocalFrameworkConfig({
        command: join(scratch, "missing-te2"),
        port: 8089,
      }, {
        HOME: scratch,
        XDG_CONFIG_HOME: join(scratch, "config"),
        [LOCAL_FRAMEWORK_EXECUTABLE_ENV]: command,
      }),
      /not runnable/,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("config writes are validated, atomic, private, and round-trip exactly", async () => {
  const scratch = await scratchDirectory();
  try {
    const command = join(scratch, "install", "bin", "te2");
    const venv = join(scratch, "install", "venv");
    await executable(command);
    await executable(join(venv, "bin", "python"));
    const environment = {
      HOME: scratch,
      PATH: "/usr/bin",
      XDG_CONFIG_HOME: join(scratch, "config"),
    };
    const written = await writeLocalFrameworkConfig({
      command,
      venvPath: venv,
      broadcast: ["tailscale0", "100.64.0.0/10", "tailscale0"],
      port: 8091,
      env: { TE2_SAMPLE: "value", EMPTY: "" },
    }, environment);
    assert.equal(written.persisted, true);
    assert.equal(written.venv, true);
    assert.deepEqual(written.broadcast, ["tailscale0", "100.64.0.0/10"]);

    const path = localFrameworkConfigPath(environment);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const disk = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(disk, {
      version: 1,
      command,
      venvPath: venv,
      broadcast: ["tailscale0", "100.64.0.0/10"],
      port: 8091,
      env: { TE2_SAMPLE: "value", EMPTY: "" },
    });
    const read = await readLocalFrameworkConfig(environment);
    assert.equal(read.commandSource, "configured");
    assert.equal(read.commandDetected, true);
    assert.equal(read.venv, true);
    assert.equal(read.error, null);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("broadcast and environment validation reject ambiguous launch state", () => {
  assert.throws(
    () => normalizeLocalFrameworkConfig({ broadcast: ["all", "tailscale0"] }),
    /cannot be combined/,
  );
  assert.throws(
    () => normalizeLocalFrameworkConfig({ broadcast: "tailscale0" }),
    /must be an array/,
  );
  assert.throws(
    () => normalizeLocalFrameworkConfig({ env: { "BAD-KEY": "value" } }),
    /Invalid environment variable name/,
  );
  assert.throws(
    () => normalizeLocalFrameworkConfig({ env: { GOOD: 3 } }),
    /string value/,
  );
  assert.throws(
    () => normalizeLocalFrameworkConfig({ version: 2 }),
    /Unsupported local framework configuration version/,
  );
});

test("a malformed persisted config is reported without silently persisting defaults", async () => {
  const scratch = await scratchDirectory();
  try {
    const environment = {
      HOME: scratch,
      PATH: "",
      XDG_CONFIG_HOME: join(scratch, "config"),
    };
    const path = localFrameworkConfigPath(environment);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "{not json", "utf8");
    const config = await readLocalFrameworkConfig(environment);
    assert.equal(config.persisted, true);
    assert.equal(config.commandDetected, false);
    assert.match(config.error || "", /configuration is invalid/);
    assert.equal(await readFile(path, "utf8"), "{not json");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("venv activation overlays user environment after the Electron environment", () => {
  const config = {
    ...defaultLocalFrameworkConfig(),
    command: "/opt/te2/bin/te2",
    venvPath: "/opt/te2/venv",
    env: { PATH: "/configured/bin", SAMPLE: "configured" },
    persisted: true,
    path: "/config/desktop-local-framework.json",
    resolvedCommand: "/opt/te2/bin/te2",
    commandSource: "configured" as const,
    commandDetected: true,
    venv: true,
    error: null,
  };
  assert.deepEqual(
    localFrameworkChildEnvironment(config, {
      PATH: "/electron/bin",
      SAMPLE: "electron",
      HOME: "/home/test",
      PYTHONHOME: "/wrong/python",
    }),
    {
      PATH: "/opt/te2/venv/bin:/configured/bin",
      SAMPLE: "configured",
      HOME: "/home/test",
      VIRTUAL_ENV: "/opt/te2/venv",
    },
  );
});
