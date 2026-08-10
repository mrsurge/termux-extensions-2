import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { build } from "esbuild";
import { Window } from "happy-dom";

async function loadComponentRuntime() {
  const result = await build({
    entryPoints: [resolve(
      import.meta.dirname,
      "../main_page/frontend/ui/component-runtime/index.ts",
    )],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("component owners clean events, subscriptions, and children exactly once", async () => {
  const { createComponentOwner } = await loadComponentRuntime();
  const window = new Window({ url: "http://127.0.0.1/app/test" });
  const button = window.document.createElement("button");
  const owner = createComponentOwner();
  const child = owner.child();
  let clicks = 0;
  let subscriptionValue = "";
  let unsubscribes = 0;
  let childDisposals = 0;

  owner.listen(button, "click", () => { clicks += 1; });
  const releaseSubscription = owner.subscribe(
    (listener) => {
      listener("ready");
      return () => { unsubscribes += 1; };
    },
    (value) => { subscriptionValue = value; },
  );
  child.onDispose(() => { childDisposals += 1; });

  button.click();
  assert.equal(clicks, 1);
  assert.equal(subscriptionValue, "ready");

  child.dispose();
  assert.equal(childDisposals, 1);
  owner.dispose();
  owner.dispose();
  releaseSubscription();
  button.click();
  assert.equal(clicks, 1);
  assert.equal(unsubscribes, 1);
  assert.equal(childDisposals, 1);
  assert.equal(owner.disposed, true);
  assert.equal(child.disposed, true);
  window.close();
});

test("owned JSX renders in a foreign document and clears object refs", async () => {
  const { createComponentOwner, createRef, jsx, renderWithOwner } =
    await loadComponentRuntime();
  const window = new Window({ url: "http://127.0.0.1/app/test" });
  const owner = createComponentOwner();
  const ref = createRef();
  let clicks = 0;
  const button = renderWithOwner(window.document, owner, () =>
    jsx(
      "button",
      {
        ref,
        className: "component-button",
        onClick: () => { clicks += 1; },
      },
      "Open",
    )
  );
  window.document.body.appendChild(button);

  assert.equal(button.ownerDocument, window.document);
  assert.equal(ref.current, button);
  button.click();
  assert.equal(clicks, 1);

  owner.dispose();
  button.click();
  assert.equal(clicks, 1);
  assert.equal(ref.current, null);
  window.close();
});

test("state controllers apply synchronous projections and stop after disposal", async () => {
  const { createComponentOwner, createComponentStateController } =
    await loadComponentRuntime();
  const parent = createComponentOwner();
  const applied = [];
  const controller = createComponentStateController(
    { count: 0 },
    (state, previous) => {
      applied.push([state.count, previous?.count ?? null]);
    },
    parent,
  );

  controller.setState((state) => ({ count: state.count + 1 }));
  assert.deepEqual(applied, [[0, null], [1, 0]]);
  assert.deepEqual(controller.getState(), { count: 1 });

  parent.dispose();
  controller.setState({ count: 2 });
  assert.deepEqual(controller.getState(), { count: 1 });
  assert.deepEqual(applied, [[0, null], [1, 0]]);

  const lateApplied = [];
  const lateController = createComponentStateController(
    { count: 3 },
    (state) => { lateApplied.push(state.count); },
    parent,
  );
  assert.equal(lateController.owner.disposed, true);
  assert.deepEqual(lateApplied, []);
});
