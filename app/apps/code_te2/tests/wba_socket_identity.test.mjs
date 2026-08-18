import assert from "node:assert/strict";
import test from "node:test";

import {
  editorWbaRequestContextFromQuery,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/server/editor-socket.mjs";

test("WBA accepts the canonical shared Socket.IO client identity query", () => {
  assert.deepEqual(
    editorWbaRequestContextFromQuery({
      client_instance_id: "CLIENT_ABCDEFGHIJKL",
      window_id: "WINDOW_ABCDEFGHIJKLMNOPQRST",
    }),
    {
      clientInstanceId: "client_abcdefghijkl",
      windowId: "window_abcdefghijklmnopqrst",
    },
  );
});

test("WBA rejects missing, malformed, and non-canonical query keys", () => {
  for (const query of [
    {},
    { clientInstanceId: "client_abcdefghijkl" },
    { client_instance_id: "client_short" },
    {
      client_instance_id: "client_abcdefghijkl",
      window_id: "window_short",
    },
  ]) {
    assert.throws(
      () => editorWbaRequestContextFromQuery(query),
      /invalid_client_presentation_identity/,
    );
  }
});
