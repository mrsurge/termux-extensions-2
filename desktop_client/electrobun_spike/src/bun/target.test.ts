import { describe, expect, test } from "bun:test";

import { frameworkOrigin, projectFrameworkUrl } from "./target";

describe("frameworkOrigin", () => {
  test("uses HTTP for a bare host", () => {
    expect(
      frameworkOrigin({
        frameworkHost: "framework.example",
        frameworkPort: 8089,
        zoomLevel: 1,
      }),
    ).toBe("http://framework.example:8089");
  });

  test("preserves HTTPS and replaces a supplied path and port", () => {
    expect(
      frameworkOrigin({
        frameworkHost: "https://framework.example:9443/ignored",
        frameworkPort: 443,
        zoomLevel: 1,
      }),
    ).toBe("https://framework.example");
  });

  test("rejects embedded credentials", () => {
    expect(() =>
      frameworkOrigin({
        frameworkHost: "http://user:secret@framework.example",
        frameworkPort: 8089,
        zoomLevel: 1,
      }),
    ).toThrow("must not include credentials");
  });
});

describe("projectFrameworkUrl", () => {
  test("projects a framework URL onto the ephemeral browser origin", () => {
    expect(
      projectFrameworkUrl(
        "/app/file_editor_cm6?gv_native=1#editor",
        "http://100.101.102.103:8089",
        "http://127.0.0.1:43127",
      ).href,
    ).toBe("http://127.0.0.1:43127/app/file_editor_cm6?gv_native=1#editor");
  });

  test("leaves a different absolute origin untouched", () => {
    expect(
      projectFrameworkUrl(
        "https://elsewhere.example/app/demo",
        "http://100.101.102.103:8089",
        "http://127.0.0.1:43127",
      ).href,
    ).toBe("https://elsewhere.example/app/demo");
  });
});
