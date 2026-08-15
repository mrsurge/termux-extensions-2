import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  desktopClientIdentityPath,
  readDesktopClientIdentity,
  resetDesktopClientIdentity,
} from "./client-identity-store";

function temporaryRoot(): string {
  return process.env.TEMPDIR || process.env.TMPDIR || tmpdir();
}

test("Electron client identity persists in the canonical TE2 config root and resets explicitly", async () => {
  const scratch = await mkdtemp(
    join(temporaryRoot(), "te2-electron-client-identity-"),
  );
  const environment = {
    ...process.env,
    TE2_CONFIG_HOME: scratch,
    XDG_CONFIG_HOME: "",
  };
  try {
    const first = await readDesktopClientIdentity(environment);
    const second = await readDesktopClientIdentity(environment);
    assert.match(first.clientInstanceId, /^client_[a-z0-9]{32}$/);
    assert.deepEqual(second, first);
    assert.equal(
      desktopClientIdentityPath(environment),
      join(scratch, "desktop-client-identity.json"),
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(desktopClientIdentityPath(environment), "utf8"),
      ),
      first,
    );

    const reset = await resetDesktopClientIdentity(environment);
    assert.notEqual(reset.clientInstanceId, first.clientInstanceId);
    assert.deepEqual(await readDesktopClientIdentity(environment), reset);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
