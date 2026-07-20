import { describe, expect, test } from "bun:test";

import {
  compareAssetVersions,
  mapLocalAssetPath,
  nativeAssetRedirectRules,
} from "./assets";

describe("desktop asset inventory", () => {
  test("compares dotted release versions monotonically", () => {
    expect(compareAssetVersions("0.2.320", "0.2.319")).toBe(1);
    expect(compareAssetVersions("0.2.320", "0.2.320")).toBe(0);
    expect(compareAssetVersions("0.2.9", "0.2.10")).toBe(-1);
  });

  test("maps aliases onto installed bundle paths", () => {
    expect(mapLocalAssetPath("/apps/by-id/file_editor_cm6/template.html")).toBe(
      "/apps/file_editor_cm6/template.html",
    );
    expect(
      mapLocalAssetPath(
        "/api/app/file_editor_cm6/ui/monaco_vscode/lang/workers/json.worker.js",
      ),
    ).toBe("/static/vendor/monaco-editor-core/te2-lang/workers/json.worker.js");
    expect(mapLocalAssetPath("/api/apps/catalog")).toBeNull();
  });

  test("serializes only the allowlisted redirect boundary", () => {
    const rules = nativeAssetRedirectRules("http://127.0.0.1:43210", "/var/lib/te2/assets");
    expect(rules).toContain("base\thttp://127.0.0.1:43210");
    expect(rules).toContain("root\t/var/lib/te2/assets");
    expect(rules).toContain("exact\t/static/vendor/socket.io.min.js");
    expect(rules).toContain("prefix\t/static/fonts/");
    expect(rules).not.toContain("/api/apps/catalog");
  });
});
