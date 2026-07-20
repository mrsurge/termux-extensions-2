import { describe, expect, test } from "bun:test";

import { frameworkOrigin } from "./target";

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
