import assert from "node:assert/strict";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import test from "node:test";

import {
  preferredContentEncoding,
  sendWebviewResourceResponse,
} from "../workbench_protocol_proxy/node_workbench_adapter/dist/server/webview-resource-response.mjs";

function responseCapture() {
  let status = null;
  let headers = null;
  let body = Buffer.alloc(0);
  return {
    response: {
      writeHead(code, values) {
        status = code;
        headers = values;
      },
      end(value) {
        body = value ? Buffer.from(value) : Buffer.alloc(0);
      },
    },
    result() {
      return { status, headers, body };
    },
  };
}

test("extension resource encoding honors quality values", () => {
  assert.equal(preferredContentEncoding("gzip, br"), "br");
  assert.equal(preferredContentEncoding("br;q=0.2, gzip;q=0.8"), "gzip");
  assert.equal(preferredContentEncoding("br;q=0, gzip;q=0"), null);
  assert.equal(preferredContentEncoding(undefined), null);
});

test("large extension assets use Brotli while preserving validators", async () => {
  const source = Buffer.from("const extensionView = true;\n".repeat(512));
  const capture = responseCapture();
  await sendWebviewResourceResponse(
    { headers: { "accept-encoding": "gzip, br" } },
    capture.response,
    {
      body: source,
      contentType: "application/javascript; charset=utf-8",
      etag: 'W/"resource-1"',
      lastModified: "Fri, 14 Aug 2026 12:00:00 GMT",
      cacheControl: "private, max-age=31536000, immutable",
    },
  );
  const response = capture.result();
  assert.equal(response.status, 200);
  assert.equal(response.headers["content-encoding"], "br");
  assert.equal(response.headers.etag, 'W/"resource-1"');
  assert.equal(
    response.headers["cache-control"],
    "private, max-age=31536000, immutable",
  );
  assert.equal(response.headers.vary, "accept-encoding");
  assert.deepEqual(brotliDecompressSync(response.body), source);
});

test("extension assets support gzip and exact weak-etag revalidation", async () => {
  const source = Buffer.from("body { color: white; }\n".repeat(512));
  const compressed = responseCapture();
  await sendWebviewResourceResponse(
    { headers: { "accept-encoding": "gzip" } },
    compressed.response,
    {
      body: source,
      contentType: "text/css; charset=utf-8",
      etag: 'W/"resource-2"',
      lastModified: "Fri, 14 Aug 2026 12:00:00 GMT",
    },
  );
  const gzipResponse = compressed.result();
  assert.equal(gzipResponse.headers["content-encoding"], "gzip");
  assert.deepEqual(gunzipSync(gzipResponse.body), source);

  const revalidated = responseCapture();
  await sendWebviewResourceResponse(
    { headers: { "if-none-match": 'W/"resource-2"' } },
    revalidated.response,
    {
      body: source,
      contentType: "text/css; charset=utf-8",
      etag: 'W/"resource-2"',
      lastModified: "Fri, 14 Aug 2026 12:00:00 GMT",
    },
  );
  const notModified = revalidated.result();
  assert.equal(notModified.status, 304);
  assert.equal(notModified.body.byteLength, 0);
  assert.equal(notModified.headers.etag, 'W/"resource-2"');
});
