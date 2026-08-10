import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const appRoot = path.resolve(import.meta.dirname, "..");

async function loadBridgeUtils() {
  const result = await build({
    entryPoints: [path.join(appRoot, "monaco_editor/editor_bridge_utils.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
  });
  const url = `data:text/javascript;base64,${Buffer.from(
    result.outputFiles[0].text,
  ).toString("base64")}#${Date.now()}`;
  return import(url);
}

async function loadLanguageUtils() {
  const result = await build({
    entryPoints: [path.join(appRoot, "monaco_editor/editor_language_utils.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
  });
  const url = `data:text/javascript;base64,${Buffer.from(
    result.outputFiles[0].text,
  ).toString("base64")}#${Date.now()}`;
  return import(url);
}

test("plain string hover content retains its provider position", async () => {
  const { toMonacoHoverContents } = await loadBridgeUtils();
  assert.deepEqual(toMonacoHoverContents(["plain text"]), [
    { value: "plain text" },
  ]);
});

test("Markdown hover content preserves supported metadata", async () => {
  const { toMonacoHoverContents } = await loadBridgeUtils();
  assert.deepEqual(
    toMonacoHoverContents([
      {
        value: "[$(link) open](command:te2.open)",
        isTrusted: { enabledCommands: ["te2.open"] },
        supportThemeIcons: true,
        supportHtml: false,
        supportAlertSyntax: true,
        baseUri: {
          scheme: "file",
          authority: "",
          path: "/workspace/",
          query: "",
          fragment: "",
          ignored: true,
        },
        uris: {
          "command:te2.open": {
            scheme: "command",
            authority: "",
            path: "te2.open",
            query: "",
            fragment: "",
          },
          malformed: "not-a-uri",
        },
      },
    ]),
    [
      {
        value: "[$(link) open](command:te2.open)",
        isTrusted: { enabledCommands: ["te2.open"] },
        supportThemeIcons: true,
        supportHtml: false,
        supportAlertSyntax: true,
        baseUri: {
          scheme: "file",
          authority: "",
          path: "/workspace/",
          query: "",
          fragment: "",
        },
        uris: {
          "command:te2.open": {
            scheme: "command",
            authority: "",
            path: "te2.open",
            query: "",
            fragment: "",
          },
        },
      },
    ],
  );
});

test("language/value hover content becomes a fenced code block", async () => {
  const { toMonacoHoverContents } = await loadBridgeUtils();
  assert.deepEqual(
    toMonacoHoverContents([{ language: "javascript", value: "const answer = 42;" }]),
    [{ value: "```javascript\nconst answer = 42;\n```\n" }],
  );
});

test("mixed provider hover content retains its original order", async () => {
  const { projectMonacoHoverContents, toMonacoHoverContents } =
    await loadBridgeUtils();
  assert.deepEqual(
    toMonacoHoverContents([
      "first",
      { language: "css", value: ".item { color: red; }" },
      { value: "third", supportHtml: true },
    ]),
    [
      { value: "first" },
      { value: "```css\n.item { color: red; }\n```\n" },
      { value: "third", supportHtml: true },
    ],
  );
  assert.deepEqual(
    projectMonacoHoverContents([
      { value: "\n```typescript\nconst first = 1;\n```\n" },
      { language: "CSS", value: ".item {}" },
      { value: "~~~typescript\nconst duplicate = 2;\n~~~" },
    ]).codeLanguages,
    ["typescript", "CSS"],
  );
});

test("malformed hover content is dropped without leaking invalid metadata", async () => {
  const { toMonacoHoverContents } = await loadBridgeUtils();
  assert.deepEqual(
    toMonacoHoverContents([
      null,
      42,
      {},
      { value: 7 },
      { language: 7, value: "not markdown" },
      { language: "html", value: 7 },
      {
        value: "valid markdown",
        isTrusted: { enabledCommands: ["valid", 7] },
        supportThemeIcons: "yes",
        supportHtml: 1,
        supportAlertSyntax: null,
        baseUri: "file:///workspace/",
        uris: [],
      },
    ]),
    [{ value: "valid markdown" }],
  );
  assert.deepEqual(toMonacoHoverContents({ value: "not an array" }), []);
});

test("fenced language aliases resolve through Monaco contributions", async () => {
  const { resolveMonacoLanguageId } = await loadLanguageUtils();
  const languages = [
    { id: "javascript", aliases: ["JavaScript", "js"] },
    { id: "cpp", aliases: ["C++", "cpp"] },
  ];
  assert.equal(resolveMonacoLanguageId("JS", languages), "javascript");
  assert.equal(resolveMonacoLanguageId("c++", languages), "cpp");
  assert.equal(resolveMonacoLanguageId("custom-language", languages), "custom-language");
});
