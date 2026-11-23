import assert from "node:assert/strict";
import { lstat, mkdtemp, readdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
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

test("hard-link denial publishes one complete private config across concurrent first starts", async () => {
  const root = await mkdtemp(join(tmpdir(), "te2-relay-denied-"));
  const environment = { TE2_CONFIG_HOME: root };
  const path = join(root, "desktop-framework-relay.json");
  const denied = async () => { throw Object.assign(new Error("hard link denied"), { code: "EACCES" }); };
  try {
    const ports = await Promise.all(Array.from({length: 16}, () => readPreferredRelayPort(environment, denied)));
    assert.ok(ports.every(port => port === ports[0]));
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {version: 1, preferredPort: ports[0]});
    const target = await readlink(path);
    assert.match(target, /^\.desktop-framework-relay\.[a-f0-9-]+\.json$/);
    assert.equal((await lstat(join(root, target))).mode & 0o777, 0o600);
    assert.deepEqual((await readdir(root)).sort(), [target, "desktop-framework-relay.json"]);
    assert.equal(await readPreferredRelayPort(environment), ports[0]);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test("existing configuration is reused and malformed data is preserved", async () => {
  const root = await mkdtemp(join(tmpdir(), "te2-relay-existing-"));
  const environment = { TE2_CONFIG_HOME: root };
  const path = join(root, "desktop-framework-relay.json");
  try {
    await writeFile(path, JSON.stringify({version: 1, preferredPort: 61692}));
    assert.equal(await readPreferredRelayPort(environment), 61692);
    assert.ok((await lstat(path)).isFile());
    await writeFile(path, "{}");
    await assert.rejects(readPreferredRelayPort(environment), /Invalid desktop framework relay configuration/);
    assert.equal(await readFile(path, "utf8"), "{}");
  } finally { await rm(root, {recursive: true, force: true}); }
});
