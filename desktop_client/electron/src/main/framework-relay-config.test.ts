import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readPreferredRelayPort } from "./framework-relay-config";

test("preferred relay port persists independently of endpoint settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "te2-relay-config-"));
  try {
    const environment = { TE2_CONFIG_HOME: root };
    const port = await readPreferredRelayPort(environment);
    assert.ok(port >= 49152 && port <= 65535);
    assert.equal(await readPreferredRelayPort(environment), port);
    assert.deepEqual(await Promise.all(Array.from({length:4},()=>readPreferredRelayPort(environment))), [port,port,port,port]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
