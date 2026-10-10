import { randomInt, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { te2ConfigHome } from "./te2-paths";

// Separate from editable endpoint settings: Save must never rotate this origin.
export async function readPreferredRelayPort(environment = process.env): Promise<number> {
  const root = te2ConfigHome(environment);
  const path = join(root, "desktop-framework-relay.json");
  function decode(raw: string): number {
    const value = JSON.parse(raw) as { version?: unknown; preferredPort?: unknown };
    if (value?.version !== 1 || !Number.isInteger(value.preferredPort)
        || Number(value.preferredPort) < 1024 || Number(value.preferredPort) > 65535) {
      throw new Error("Invalid desktop framework relay configuration");
    }
    return Number(value.preferredPort);
  }
  try { return decode(await readFile(path, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await mkdir(root, { recursive: true, mode: 0o700 });
  const port = randomInt(49152, 65536);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify({ version: 1, preferredPort: port })}\n`, { flag: "wx", mode: 0o600 });
    // Publish a complete file without replacing another startup's winner.
    await link(temporary, path);
    return port;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return decode(await readFile(path, "utf8"));
  } finally { await rm(temporary, { force: true }); }
}
