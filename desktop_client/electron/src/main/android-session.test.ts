import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AndroidSession, supportsAndroidSession, type SessionApi } from "./android-session";

test("keep-alive follows the app session, notification Stop retires only its own session", async t => {
  const directory = await mkdtemp(join(tmpdir(), "te2-session-"));
  t.after(() => rm(directory, {recursive:true,force:true}));
  const events: string[] = [];
  const callbacks: Array<(reason: string) => void> = [];
  const api: SessionApi = {
    async startAndroidSession(options, callback) {
      callbacks.push(callback);
      events.push("start:" + options.keepCpuAwake);
      return String(callbacks.length);
    },
    stopAndroidSession(id) { events.push("stop:" + id); return true; },
    setAndroidSessionCpuAwake(id, awake) { events.push(id + ":awake:" + awake); return true; },
  };
  const session = new AndroidSession(api, directory, message => events.push(message));
  assert.equal(supportsAndroidSession("linux", api), false);
  assert.equal(supportsAndroidSession("android", api), true);
  await session.load();
  await session.configure(true, false);
  assert.deepEqual(events, []);
  await session.appOpened(true);
  await session.configure(true, true);
  callbacks[0]("stop");
  await session.appOpened(true);
  assert.deepEqual(session.state(), {enabled:true, keepCpuAwake:true, active:false});
  await session.appOpened(false);
  await session.appOpened(true);
  callbacks[0]("stop");
  await session.appOpened(true);
  assert.equal(session.state().active,true);
  await session.appOpened(false);
  assert.deepEqual(events, ["start:false","1:awake:true","Android session stopped","start:true","stop:2"]);
  const restarted = new AndroidSession(api, directory, () => {});
  await restarted.load();
  assert.deepEqual(restarted.state(),session.state());
  await assert.rejects(restarted.configure("true", false),TypeError);
});

test("leaving while foreground promotion is pending releases the resulting token", async t => {
  const directory = await mkdtemp(join(tmpdir(), "te2-session-"));
  t.after(() => rm(directory, {recursive:true,force:true}));
  let promote!: (id: string) => void;
  const pending = new Promise<string>(resolve => { promote = resolve; });
  const stopped: string[] = [];
  const session = new AndroidSession({
    startAndroidSession: () => pending,
    stopAndroidSession: id => { stopped.push(id); return true; },
    setAndroidSessionCpuAwake: () => true,
  }, directory, () => {});
  await session.configure(true, false);
  const start = session.appOpened(true);
  const end = session.appOpened(false);
  promote("pending");
  await Promise.all([start,end]);
  assert.deepEqual(stopped, ["pending"]);
  assert.equal(session.state().active,false);
});
