import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { DESKTOP_SETTINGS_VERSION, type DesktopShellSettings } from "../shared/contracts";
import {
  MAX_FRAMEWORK_BOOKMARKS,
  deleteFrameworkBookmark,
  desktopSettingsPath,
  frameworkBookmarkViews,
  frameworkOrigin,
  projectFrameworkUrl,
  readDesktopSettings,
  upsertFrameworkBookmark,
  validateFrameworkEndpoint,
  writeDesktopSettings,
} from "./target";

function settings(
  overrides: Partial<DesktopShellSettings> = {},
): DesktopShellSettings {
  return {
    version: DESKTOP_SETTINGS_VERSION,
    frameworkHost: "127.0.0.1",
    frameworkPort: 8089,
    frameworkBookmarks: [],
    zoomLevel: 1,
    ...overrides,
  };
}

async function withScratch(
  operation: (environment: NodeJS.ProcessEnv) => Promise<void>,
): Promise<void> {
  const scratchRoot = process.env.TEMPDIR || process.env.TMPDIR || tmpdir();
  const scratch = await mkdtemp(join(scratchRoot, "te2-desktop-target-"));
  try {
    await operation({ ...process.env, TE2_CONFIG_HOME: scratch });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

test("desktop settings honor the explicit TE2 config root", () => {
  assert.equal(
    desktopSettingsPath({ HOME: "/home/test", TE2_CONFIG_HOME: "/custom/te2-config" }),
    "/custom/te2-config/desktop-shell.json",
  );
});

test("framework endpoint validation accepts hostnames, IPv4, bracketed IPv6, and HTTPS", () => {
  assert.equal(
    frameworkOrigin({ frameworkHost: "framework.example", frameworkPort: 8089 }),
    "http://framework.example:8089",
  );
  assert.equal(
    frameworkOrigin({ frameworkHost: "192.0.2.7", frameworkPort: 8090 }),
    "http://192.0.2.7:8090",
  );
  assert.equal(
    frameworkOrigin({ frameworkHost: "[2001:db8::7]", frameworkPort: 8091 }),
    "http://[2001:db8::7]:8091",
  );
  assert.equal(
    frameworkOrigin({
      frameworkHost: "https://framework.example:9443/path",
      frameworkPort: 443,
    }),
    "https://framework.example",
  );
});

test("framework endpoint validation rejects credentials and invalid ports", () => {
  assert.throws(
    () => frameworkOrigin({
      frameworkHost: "http://user:secret@framework.example",
      frameworkPort: 8089,
    }),
    /credentials/,
  );
  assert.throws(
    () => validateFrameworkEndpoint({
      frameworkHost: "framework.example",
      frameworkPort: 0,
    }),
    /between 1 and 65535/,
  );
  assert.throws(
    () => validateFrameworkEndpoint({
      frameworkHost: "2001:db8::7",
      frameworkPort: 8089,
    }),
  );
});

test("desktop settings recover valid bookmarks from malformed stored data", async () => {
  await withScratch(async (environment) => {
    const path = desktopSettingsPath(environment);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify({
      frameworkHost: "framework.example",
      frameworkPort: 9000,
      zoomLevel: 1.2,
      frameworkBookmarks: [
        { name: " Home ", frameworkHost: "home.example", frameworkPort: 8089 },
        { name: "home", frameworkHost: "duplicate.example", frameworkPort: 8089 },
        { name: "Broken", frameworkHost: "broken.example", frameworkPort: 0 },
        null,
        { name: "IPv6", frameworkHost: "[2001:db8::8]", frameworkPort: 9443 },
      ],
    }, null, 2)}\n`, "utf8");

    const loaded = await readDesktopSettings(environment);
    assert.equal(loaded.version, DESKTOP_SETTINGS_VERSION);
    assert.equal(loaded.frameworkHost, "framework.example");
    assert.equal(loaded.frameworkPort, 9000);
    assert.deepEqual(loaded.frameworkBookmarks, [
      { name: "Home", frameworkHost: "home.example", frameworkPort: 8089 },
      { name: "IPv6", frameworkHost: "[2001:db8::8]", frameworkPort: 9443 },
    ]);
  });
});

test("desktop settings writes the versioned bookmark record atomically", async () => {
  await withScratch(async (environment) => {
    const written = await writeDesktopSettings(settings({
      frameworkHost: "https://framework.example",
      frameworkPort: 443,
      frameworkBookmarks: [
        { name: "Remote", frameworkHost: "100.64.0.10", frameworkPort: 8089 },
      ],
    }), environment);
    const raw = JSON.parse(await readFile(desktopSettingsPath(environment), "utf8"));
    const siblings = await readdir(dirname(desktopSettingsPath(environment)));

    assert.deepEqual(raw, written);
    assert.equal(raw.version, DESKTOP_SETTINGS_VERSION);
    assert.deepEqual(raw.frameworkBookmarks, written.frameworkBookmarks);
    assert.deepEqual(
      siblings.filter((name) => name.endsWith(".tmp")),
      [],
    );
  });
});

test("bookmark upsert and delete use case-insensitive name identity", () => {
  const initial = [
    { name: "Home", frameworkHost: "home.example", frameworkPort: 8089 },
    { name: "Work", frameworkHost: "work.example", frameworkPort: 8089 },
  ];
  const updated = upsertFrameworkBookmark(initial, {
    name: " home ",
    frameworkHost: "https://new-home.example",
    frameworkPort: 443,
  });

  assert.deepEqual(updated, [
    { name: "home", frameworkHost: "https://new-home.example", frameworkPort: 443 },
    { name: "Work", frameworkHost: "work.example", frameworkPort: 8089 },
  ]);
  assert.deepEqual(deleteFrameworkBookmark(updated, "WORK"), [updated[0]]);
  assert.equal(frameworkBookmarkViews(updated)[0]?.frameworkBaseUrl, "https://new-home.example");
});

test("bookmark validation enforces names and capacity", () => {
  assert.throws(
    () => upsertFrameworkBookmark([], {
      name: " ",
      frameworkHost: "framework.example",
      frameworkPort: 8089,
    }),
    /cannot be empty/,
  );
  assert.throws(
    () => upsertFrameworkBookmark([], {
      name: "x".repeat(65),
      frameworkHost: "framework.example",
      frameworkPort: 8089,
    }),
    /cannot exceed 64/,
  );

  const full = Array.from({ length: MAX_FRAMEWORK_BOOKMARKS }, (_, index) => ({
    name: `Server ${index}`,
    frameworkHost: `server-${index}.example`,
    frameworkPort: 8089,
  }));
  assert.throws(
    () => upsertFrameworkBookmark(full, {
      name: "One too many",
      frameworkHost: "overflow.example",
      frameworkPort: 8089,
    }),
    /Only 16/,
  );
  assert.equal(
    upsertFrameworkBookmark(full, {
      name: "SERVER 0",
      frameworkHost: "updated.example",
      frameworkPort: 8090,
    }).length,
    MAX_FRAMEWORK_BOOKMARKS,
  );
});

test("projectFrameworkUrl preserves the path on the browser relay", () => {
  assert.equal(
    projectFrameworkUrl(
      "/app/code_te2?gv_native=1#editor",
      "http://100.101.102.103:8089",
      "http://127.0.0.1:43127",
    ).href,
    "http://127.0.0.1:43127/app/code_te2?gv_native=1#editor",
  );
});
