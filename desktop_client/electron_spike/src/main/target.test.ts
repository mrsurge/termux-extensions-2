import assert from "node:assert/strict";
import { test } from "node:test";

import { frameworkOrigin, projectFrameworkUrl } from "./target";

test("frameworkOrigin normalizes HTTP and HTTPS hosts", () => {
  assert.equal(
    frameworkOrigin({ frameworkHost: "framework.example", frameworkPort: 8089, zoomLevel: 1 }),
    "http://framework.example:8089",
  );
  assert.equal(
    frameworkOrigin({ frameworkHost: "https://framework.example:9443/path", frameworkPort: 443, zoomLevel: 1 }),
    "https://framework.example",
  );
});

test("frameworkOrigin rejects credentials", () => {
  assert.throws(
    () => frameworkOrigin({
      frameworkHost: "http://user:secret@framework.example",
      frameworkPort: 8089,
      zoomLevel: 1,
    }),
    /credentials/,
  );
});

test("projectFrameworkUrl preserves the path on the browser relay", () => {
  assert.equal(
    projectFrameworkUrl(
      "/app/file_editor_cm6?gv_native=1#editor",
      "http://100.101.102.103:8089",
      "http://127.0.0.1:43127",
    ).href,
    "http://127.0.0.1:43127/app/file_editor_cm6?gv_native=1#editor",
  );
});
