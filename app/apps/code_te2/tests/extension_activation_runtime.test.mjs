import assert from "node:assert/strict";
import test from "node:test";

import {
  activationEventsForExtension,
  IMPLICIT_ACTIVATION_EXTENSION_POINTS,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/activation-events.mjs";
import { ExtensionActivationRuntime } from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/activation-runtime.mjs";
import { mergeInstalledExtensionManifests } from "../workbench_protocol_proxy/node_workbench_adapter/dist/client/management.mjs";
import {
  buildLanguageCatalog,
  buildExtensionsSnapshot,
  sanitizeExtensionForInit,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/catalog.mjs";
import { ExtensionLanguageResolver } from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/language-resolver.mjs";

const ALL_IMPLICIT_CONTRIBUTIONS = {
  authentication: [{ id: "auth" }],
  chatContext: [{ id: "context" }],
  chatOutputRenderers: [{ viewType: "chat-output" }],
  chatParticipants: [{ id: "participant" }],
  chatSessions: [{ type: "session" }],
  commands: [{ command: "sample.run" }],
  customEditors: [{ viewType: "sample.editor" }],
  debugVisualizers: [{ id: "visualizer" }],
  languageModelChatProviders: [{ vendor: "vendor" }],
  languageModelTools: [{ name: "tool" }],
  languages: [
    {
      id: "synthetic-language",
      configuration: "./language-configuration.json",
      extensions: [".synthetic"],
    },
  ],
  mcpServerDefinitionProviders: [{ id: "mcp" }],
  notebookRenderer: [{ id: "renderer" }],
  notebooks: [{ type: "notebook" }],
  taskDefinitions: [{ type: "task" }],
  terminal: { profiles: [{ id: "profile" }] },
  terminalQuickFixes: [{ id: "quick-fix" }],
  views: { explorer: [{ id: "sample.view" }] },
  walkthroughs: [{ id: "walkthrough" }],
};

const EXPECTED_IMPLICIT_EVENTS = [
  "onAuthenticationRequest:auth",
  "onChatContextProvider:context",
  "onChatOutputRenderer:chat-output",
  "onChatParticipant:participant",
  "onChatSession:session",
  "onCommand:sample.run",
  "onCustomEditor:sample.editor",
  "onDebugVisualizer:visualizer",
  "onLanguageModelChatProvider:vendor",
  "onLanguageModelTool:tool",
  "onLanguage:synthetic-language",
  "onMcpCollection:mcp",
  "onRenderer:renderer",
  "onNotebookSerializer:notebook",
  "onTaskType:task",
  "onTerminalProfile:profile",
  "onTerminalQuickFixRequest:quick-fix",
  "onView:sample.view",
  "onWalkthrough:walkthrough",
];

test("enriches admitted user extensions from canonical disk manifests", () => {
  const managementExtension = {
    identifier: { value: "openai.chatgpt" },
    isBuiltin: false,
    targetPlatform: "linux-x64",
    extensionLocation: {
      scheme: "vscode-remote",
      authority: "localhost",
      path: "/extensions/openai.chatgpt",
    },
    activationEvents: ["onView:chatgpt.sidebarView"],
    contributes: {
      views: {
        chatgpt: [{ id: "chatgpt.sidebarView", type: "webview" }],
      },
    },
  };
  const diskExtension = {
    identifier: { value: "openai.chatgpt" },
    isBuiltin: false,
    targetPlatform: "universal",
    extensionLocation: {
      scheme: "vscode-remote",
      authority: "localhost",
      path: "/extensions/openai.chatgpt",
    },
    activationEvents: ["onStartupFinished", "onUri:openai.chatgpt"],
    contributes: {
      commands: [{
        command: "chatgpt.addToThread",
        title: "Add to Codex Thread",
        category: "Codex",
      }],
      menus: {
        "editor/context": [{
          command: "chatgpt.addToThread",
          group: "codex",
          when: "resourceScheme == file",
        }],
      },
      views: {
        chatgpt: [{ id: "chatgpt.sidebarView", type: "webview" }],
      },
    },
  };
  const diskOnlyExtension = {
    identifier: { value: "sample.not-admitted" },
    isBuiltin: false,
    contributes: { commands: [{ command: "sample.run", title: "Run" }] },
  };

  const merged = mergeInstalledExtensionManifests(
    [managementExtension],
    [diskExtension, diskOnlyExtension],
    (extension) => extension?.identifier?.value ?? null,
  );

  assert.deepEqual(merged.enrichedIds, ["openai.chatgpt"]);
  assert.equal(merged.extensions.length, 1, "disk-only extensions are not admitted");
  assert.equal(merged.extensions[0].targetPlatform, "linux-x64");
  assert.equal(
    merged.extensions[0].extensionLocation,
    managementExtension.extensionLocation,
    "management scan retains runtime location authority",
  );
  assert.deepEqual(merged.extensions[0].activationEvents, diskExtension.activationEvents);
  assert.deepEqual(merged.extensions[0].contributes, diskExtension.contributes);
});

test("generates every implicit activation family registered by Code OSS", () => {
  assert.deepEqual(
    IMPLICIT_ACTIVATION_EXTENSION_POINTS,
    Object.keys(ALL_IMPLICIT_CONTRIBUTIONS).sort(),
  );
  const events = activationEventsForExtension({
    id: "Sample.Extension",
    main: "./out/main.js",
    activationEvents: ["onUri", "workspaceContains:sample.file"],
    contributes: ALL_IMPLICIT_CONTRIBUTIONS,
  });

  assert.equal(events[0], "onUri:sample.extension");
  assert.equal(events[1], "workspaceContains:sample.file");
  for (const expected of EXPECTED_IMPLICIT_EVENTS) {
    assert.ok(events.includes(expected), `missing ${expected}`);
  }
  assert.equal(new Set(events).size, events.length);
});

test("does not assign activation events to declarative-only extensions", () => {
  assert.deepEqual(
    activationEventsForExtension({
      id: "sample.theme",
      activationEvents: ["*"],
      contributes: { themes: [{ id: "theme" }] },
    }),
    [],
  );
});

test("sanitized extension snapshots carry the generated lowercase event map", () => {
  const extension = sanitizeExtensionForInit(
    {
      id: "Sample.Extension",
      publisher: "Sample",
      name: "Extension",
      version: "1.0.0",
      main: "./out/main.js",
      contributes: ALL_IMPLICIT_CONTRIBUTIONS,
      extensionLocation: {
        scheme: "file",
        path: "/extensions/sample",
      },
      isBuiltin: false,
    },
    null,
  );
  assert.ok(extension);
  assert.ok(extension.activationEvents.includes("onLanguage:synthetic-language"));

  const snapshot = buildExtensionsSnapshot([extension], {
    env: {},
    excludeIds: [],
    log() {},
  });
  assert.deepEqual(
    snapshot.activationEvents["sample.extension"],
    extension.activationEvents,
  );
});

test("resolves extension-contributed languages without hard-coded suffixes", () => {
  const resolver = new ExtensionLanguageResolver();
  resolver.setExtensions([
    {
      contributes: {
        languages: [
          {
            id: "aurora",
            extensions: [".aurora"],
            filenames: ["Aurorafile"],
            filenamePatterns: ["**/*.aurora-template"],
            firstLine: "^#!.*\\baurora\\b",
          },
        ],
      },
    },
  ]);

  assert.equal(resolver.resolve("/workspace/main.aurora"), "aurora");
  assert.equal(resolver.resolve("/workspace/Aurorafile"), "aurora");
  assert.equal(
    resolver.resolve("/workspace/templates/main.aurora-template"),
    "aurora",
  );
  assert.equal(
    resolver.resolve("/workspace/script", "#!/usr/bin/env aurora\n"),
    "aurora",
  );
  assert.equal(resolver.resolve("/workspace/main.unknown"), null);
});

test("partial user language declarations preserve and merge builtin language configuration", async () => {
  const builtin = languageExtension({
    id: "vscode.python",
    isBuiltin: true,
    root: "/builtin/python",
    language: {
      id: "python",
      aliases: ["Python", "py"],
      extensions: [".py", ".rpy"],
      configuration: "./language-configuration.json",
    },
  });
  const user = languageExtension({
    id: "detachhead.basedpyright",
    isBuiltin: false,
    root: "/user/basedpyright",
    language: {
      id: "python",
      aliases: ["Python"],
      extensions: [".py", ".pyi"],
    },
  });
  const configurationRaw = JSON.stringify({
    brackets: [["(", ")"]],
    autoClosingPairs: [{ open: "(", close: ")" }],
  });
  const runtime = languageCatalogRuntime(
    new Map([["/builtin/python/language-configuration.json", configurationRaw]]),
  );

  for (const extensions of [[builtin, user], [user, builtin]]) {
    const catalog = await buildLanguageCatalog(runtime, extensions);
    const python = catalog.languages.find((language) => language.id === "python");
    assert.ok(python);
    assert.equal(python.configuration, "./language-configuration.json");
    assert.equal(python.configuration_raw, configurationRaw);
    assert.deepEqual(python.aliases, ["Python", "py"]);
    assert.deepEqual(python.extensions, [".py", ".pyi", ".rpy"]);
    assert.equal(python.extension, "detachhead.basedpyright");
    assert.equal(python.source, "user");
  }
});

test("a readable user language configuration overrides the builtin configuration", async () => {
  const builtin = languageExtension({
    id: "vscode.sample",
    isBuiltin: true,
    root: "/builtin/sample",
    language: {
      id: "sample",
      configuration: "./builtin.json",
    },
  });
  const user = languageExtension({
    id: "sample.user",
    isBuiltin: false,
    root: "/user/sample",
    language: {
      id: "sample",
      configuration: "./user.json",
    },
  });
  const runtime = languageCatalogRuntime(
    new Map([
      ["/builtin/sample/builtin.json", '{"comments":{"lineComment":"#"}}'],
      ["/user/sample/user.json", '{"comments":{"lineComment":"//"}}'],
    ]),
  );

  const catalog = await buildLanguageCatalog(runtime, [user, builtin]);
  const sample = catalog.languages.find((language) => language.id === "sample");
  assert.ok(sample);
  assert.equal(sample.configuration, "./user.json");
  assert.equal(sample.configuration_raw, '{"comments":{"lineComment":"//"}}');
});

test("deduplicates event activation and resets it with the extension-host session", async () => {
  const requests = [];
  let nextReq = 1;
  const runtime = new ExtensionActivationRuntime({
    extensionServiceRpcId: 7,
    sendAwaitingReply(rpcId, method, args) {
      requests.push({ rpcId, method, args });
      return { req: nextReq++, promise: Promise.resolve({ ok: true }) };
    },
    hasExtension(extensionId) {
      return extensionId === "sample.extension";
    },
    onEvent() {},
    log() {},
  });

  const first = runtime.activateByEvent("onLanguage:aurora");
  const second = runtime.activateByEvent("onLanguage:aurora");
  assert.equal(first, second);
  await first;
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    rpcId: 7,
    method: "$activateByEvent",
    args: ["onLanguage:aurora", 0],
  });

  runtime.reset("reconnect");
  await runtime.activateByEvent("onLanguage:aurora");
  assert.equal(requests.length, 2);

  await runtime.activateExtension("Sample.Extension");
  assert.equal(requests[2].method, "$activate");
  assert.equal(requests[2].args[0]._lower, "sample.extension");
  assert.equal(
    requests[2].args[1].activationEvent,
    "onTe2Explicit:sample.extension",
  );
  await assert.rejects(
    runtime.activateExtension("missing.extension"),
    /Unknown extension/,
  );
});

test("failed activation events remain retryable", async () => {
  let attempts = 0;
  const runtime = new ExtensionActivationRuntime({
    extensionServiceRpcId: 7,
    sendAwaitingReply() {
      attempts += 1;
      return {
        req: attempts,
        promise:
          attempts === 1
            ? Promise.reject(new Error("activation failed"))
            : Promise.resolve({ ok: true }),
      };
    },
    hasExtension() {
      return true;
    },
    onEvent() {},
    log() {},
  });

  await assert.rejects(
    runtime.activateByEvent("onCommand:sample.run"),
    /activation failed/,
  );
  await runtime.activateByEvent("onCommand:sample.run");
  assert.equal(attempts, 2);
});

function languageExtension({ id, isBuiltin, root, language }) {
  return {
    id,
    isBuiltin,
    extensionLocation: { path: root },
    contributes: { languages: [language] },
  };
}

function languageCatalogRuntime(files) {
  return {
    env: {},
    async readTextFile(path) {
      if (!files.has(path)) throw new Error(`missing fixture: ${path}`);
      return files.get(path);
    },
    joinPath(...parts) {
      return parts
        .map((part, index) => index === 0 ? String(part).replace(/\/$/, "") : String(part).replace(/^\//, ""))
        .join("/")
        .replace(/\/\.\//g, "/");
    },
    sha1Short() {
      return "fixture";
    },
    randomUuid() {
      return "fixture-uuid";
    },
    logMetrics() {},
    log() {},
  };
}
