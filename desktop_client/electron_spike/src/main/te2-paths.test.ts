import assert from "node:assert/strict";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ensureRuntimeHome, resolveTe2Paths } from "./te2-paths";

test("explicit roots are final while XDG values are bases", () => {
  const paths = resolveTe2Paths(
    {
      HOME: "/home/test",
      TE2_CACHE_HOME: "/custom/cache",
      XDG_DATA_HOME: "/xdg/data",
      XDG_CONFIG_HOME: "/xdg/config",
      XDG_RUNTIME_DIR: "/run/user/1000",
    },
    { home: "/home/test", platformTemp: "/tmp", uid: 1000 },
  );
  assert.equal(paths.cacheHome, "/custom/cache");
  assert.equal(paths.dataHome, "/xdg/data/te2");
  assert.equal(paths.configHome, "/xdg/config/te2");
  assert.equal(paths.runtimeHome, "/run/user/1000/te2");
});

test("Termux without XDG uses HOME and PREFIX fallbacks", () => {
  const paths = resolveTe2Paths(
    {
      HOME: "/data/data/com.termux/files/home",
      PREFIX: "/data/data/com.termux/files/usr",
    },
    { home: "/data/data/com.termux/files/home", platformTemp: "/ignored", uid: 10234 },
  );
  assert.equal(paths.cacheHome, "/data/data/com.termux/files/home/.cache/te2");
  assert.equal(paths.dataHome, "/data/data/com.termux/files/home/.local/share/te2");
  assert.equal(paths.runtimeHome, "/data/data/com.termux/files/usr/tmp/te2-10234");
});

test("complete explicit roots do not consult lower-priority fallbacks", () => {
  const paths = resolveTe2Paths(
    {
      HOME: "relative-home",
      TE2_CACHE_HOME: "/explicit/cache",
      TE2_DATA_HOME: "/explicit/data",
      TE2_CONFIG_HOME: "/explicit/config",
      TE2_RUNTIME_HOME: "/explicit/runtime",
    },
    { home: "relative-home", platformTemp: "relative-temp", uid: 1000 },
  );
  assert.deepEqual(paths, {
    cacheHome: "/explicit/cache",
    dataHome: "/explicit/data",
    configHome: "/explicit/config",
    runtimeHome: "/explicit/runtime",
  });
});

test("relative overrides are rejected", () => {
  assert.throws(
    () => resolveTe2Paths(
      { HOME: "/home/test", TE2_CACHE_HOME: "relative" },
      { home: "/home/test", platformTemp: "/tmp", uid: 1000 },
    ),
    /TE2_CACHE_HOME must be an absolute path/,
  );
});

test("runtime roots are created with private permissions", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "te2-electron-runtime-"));
  const runtimeHome = join(scratch, "runtime");
  try {
    assert.equal(await ensureRuntimeHome(runtimeHome), runtimeHome);
    assert.equal((await lstat(runtimeHome)).mode & 0o777, 0o700);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
