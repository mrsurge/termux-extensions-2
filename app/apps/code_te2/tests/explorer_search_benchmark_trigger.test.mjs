import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const appRoot = path.resolve(import.meta.dirname, "..");

async function importSearchController() {
  const result = await build({
    entryPoints: [path.join(appRoot, "src/explorer/search/controller.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0].text;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  return import(url);
}

function createSearchState() {
  let query = "";
  let results = null;
  let loading = false;
  let error = null;
  let timer = null;
  let identity = {
    correlationId: "stale-correlation",
    searchId: null,
    jobId: null,
    root: "/workspace",
    projectGeneration: 4,
  };
  const statuses = [];
  const sends = [];
  const renders = [];

  return {
    deps: {
      toast: () => {},
      renderSearchOverlay: () => renders.push({ query, loading, error }),
      focusSearchInput: () => {},
      hasBus: () => true,
      sendBus: (method, payload) => sends.push({ method, payload }),
      requestBus: async () => ({}),
      getProjectPath: () => "/workspace",
      getSearchOverlayVisible: () => true,
      setSearchOverlayVisible: () => {},
      getSearchMode: () => "content",
      setSearchModeValue: () => {},
      getSearchQuery: () => query,
      setSearchQuery: (next) => {
        query = next;
      },
      getSearchResults: () => results,
      setSearchResults: (next) => {
        results = next;
      },
      getSearchLoading: () => loading,
      setSearchLoading: (next) => {
        loading = next;
      },
      getSearchError: () => error,
      setSearchError: (next) => {
        error = next;
      },
      getSearchDebounceTimer: () => timer,
      setSearchDebounceTimer: (next) => {
        timer = next;
      },
      setLastKnownProjectPath: () => {},
      getContentSearchOptions: () => ({
        isRegex: false,
        isCaseSensitive: true,
        isWholeWords: false,
        includePattern: "src/**",
        excludePattern: "dist/**",
        useIgnoreFiles: true,
      }),
      getSearchIdentity: () => identity,
      setSearchIdentity: (next) => {
        identity = next;
      },
      setSearchStatus: (next) => statuses.push(next),
      setGlobalMoreLoading: () => {},
      setFileMoreLoading: () => {},
    },
    get query() {
      return query;
    },
    get identity() {
      return identity;
    },
    statuses,
    sends,
    renders,
  };
}

test("prepared benchmark searches use the normal input scheduler", async () => {
  const { createExplorerSearchController } = await importSearchController();
  const state = createSearchState();
  const controller = createExplorerSearchController(state.deps);
  const payload = {
    mode: "content",
    query: "benchmark needle",
    root: "/workspace",
    correlationId: "benchmark-suite:case-1:fullStack",
    isRegex: false,
    isCaseSensitive: true,
    isWholeWords: false,
    includePattern: "src/**",
    excludePattern: "dist/**",
    useIgnoreFiles: true,
    searchThreads: 3,
  };

  controller.scheduleSearch(payload.query, payload);

  assert.equal(state.query, payload.query);
  assert.deepEqual(state.identity, {
    correlationId: payload.correlationId,
    searchId: null,
    jobId: null,
    root: payload.root,
    projectGeneration: null,
  });
  assert.deepEqual(state.statuses.at(-1), {
    status: "running",
    message: "Waiting to search",
  });
  assert.equal(
    state.sends.some(({ method }) => method === "explorer.search.run"),
    false,
  );

  await new Promise((resolve) => setTimeout(resolve, 650));

  const runMessages = state.sends.filter(
    ({ method }) => method === "explorer.search.run",
  );
  assert.equal(runMessages.length, 1);
  assert.deepEqual(runMessages[0].payload, payload);
  assert.deepEqual(state.statuses.at(-1), {
    status: "running",
    message: "Searching",
  });
  assert.ok(state.renders.length >= 2);
});

test("the benchmark overlay enters through the input scheduler", async () => {
  const source = await readFile(
    path.join(appRoot, "src/explorer/search/overlay-controller.ts"),
    "utf8",
  );
  const benchmarkCaseBody = source.match(
    /async function runActualSearchBenchmarkCase[\s\S]*?\n  }\n\n  function handleReviewEntriesUpdated/,
  )?.[0];

  assert.ok(benchmarkCaseBody, "benchmark case handler must remain present");
  assert.match(
    benchmarkCaseBody,
    /searchController\.scheduleSearch\(case_\.query, payload\)/,
  );
  assert.doesNotMatch(benchmarkCaseBody, /searchController\.performSearch/);
});
