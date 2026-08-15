import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  brotliCompress,
  constants as zlibConstants,
  gzip,
} from "node:zlib";

export interface WebviewResourceBody {
  body: Uint8Array;
  contentType: string;
  etag: string;
  lastModified: string;
  cacheControl?: string;
}

export function preferredContentEncoding(
  value: string | undefined,
): "br" | "gzip" | null {
  if (!value) return null;
  const quality = new Map<string, number>();
  for (const entry of value.split(",")) {
    const [namePart, ...parameters] = entry.trim().toLowerCase().split(";");
    if (!namePart) continue;
    let q = 1;
    for (const parameter of parameters) {
      const match = /^q\s*=\s*(0(?:\.\d+)?|1(?:\.0+)?)$/.exec(
        parameter.trim(),
      );
      if (match) q = Number(match[1]);
    }
    quality.set(namePart, q);
  }
  const wildcard = quality.get("*") ?? 0;
  const brotliQuality = quality.get("br") ?? wildcard;
  const gzipQuality = quality.get("gzip") ?? wildcard;
  if (brotliQuality <= 0 && gzipQuality <= 0) return null;
  return brotliQuality >= gzipQuality ? "br" : "gzip";
}

function compressibleWebviewContent(contentType: string): boolean {
  return (
    contentType.startsWith("text/") ||
    contentType.startsWith("application/javascript") ||
    contentType.startsWith("application/json") ||
    contentType.startsWith("image/svg+xml")
  );
}

function gzipAsync(payload: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    gzip(payload, { level: 6 }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function brotliAsync(payload: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    brotliCompress(
      payload,
      {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
        },
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      },
    );
  });
}

export async function sendWebviewResourceResponse(
  req: IncomingMessage,
  res: ServerResponse,
  resource: WebviewResourceBody,
): Promise<void> {
  const commonHeaders: Record<string, string> = {
    "cache-control":
      resource.cacheControl ?? "private, max-age=0, must-revalidate",
    etag: resource.etag,
    "last-modified": resource.lastModified,
    vary: "accept-encoding",
    "access-control-allow-origin": "*",
    "cross-origin-resource-policy": "cross-origin",
    "x-content-type-options": "nosniff",
  };
  if (req.headers["if-none-match"] === resource.etag) {
    res.writeHead(304, commonHeaders);
    res.end();
    return;
  }
  const original = Buffer.from(resource.body);
  const encoding =
    original.byteLength >= 1024 &&
    compressibleWebviewContent(resource.contentType)
      ? preferredContentEncoding(req.headers["accept-encoding"])
      : null;
  const payload =
    encoding === "br"
      ? await brotliAsync(original)
      : encoding === "gzip"
        ? await gzipAsync(original)
        : original;
  res.writeHead(200, {
    ...commonHeaders,
    "content-type": resource.contentType,
    "content-length": payload.byteLength,
    ...(encoding ? { "content-encoding": encoding } : {}),
  });
  res.end(payload);
}
