import { randomInt, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { te2ConfigHome } from "./te2-paths";

// Separate from editable endpoint settings: Save must never rotate this origin.
export async function readPreferredRelayPort(
  environment = process.env,
  createHardLink: typeof link = link,
): Promise<number> {
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
  const candidate = join(root, `.desktop-framework-relay.${randomUUID()}.json`);
  let keepCandidate = false;
  try {
    await writeFile(candidate, `${JSON.stringify({ version: 1, preferredPort: port })}\n`, { flag: "wx", mode: 0o600 });
    // Publish a complete file without replacing another startup's winner.
    try {
      await createHardLink(candidate, path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EACCES" && code !== "EPERM" && code !== "EOPNOTSUPP") throw error;
      // Android app-data policy can deny hard links. A relative symlink also
      // publishes the completed JSON atomically and fails if another caller won.
      await symlink(basename(candidate), path);
      keepCandidate = true;
    }
    return port;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return decode(await readFile(path, "utf8"));
  } finally {
    if (!keepCandidate) await rm(candidate, { force: true });
  }
}
