import assert from "node:assert/strict";
import test from "node:test";

import {
  activationEventsForExtension,
  IMPLICIT_ACTIVATION_EXTENSION_POINTS,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/activation-events.mjs";
import { ExtensionActivationRuntime } from "../workbench_protocol_proxy/node_workbench_adapter/dist/extensions/activation-runtime.mjs";
import {
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
