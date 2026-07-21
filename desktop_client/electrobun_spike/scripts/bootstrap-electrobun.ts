import { cp, mkdir, readFile, rm, statfs } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ELECTROBUN_FORK_REPOSITORY = "https://github.com/mrsurge/electrobun.git";

const projectRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(projectRoot, "..", "..");
const sourceRoot = join(repositoryRoot, "worktrees", "electrobun-te2");
const packageRoot = join(sourceRoot, "package");
const installRoot = join(projectRoot, "node_modules", "electrobun");
const cacheHome = process.env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache");
const cacheRoot = join(cacheHome, "te2", "electrobun");
const platformDist = `dist-linux-${process.arch === "arm64" ? "arm64" : "x64"}`;
const MINIMUM_BUILD_FREE_BYTES = 3 * 1024 * 1024 * 1024;

async function run(command: string[], cwd = projectRoot): Promise<void> {
  const child = Bun.spawn(command, {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${command.join(" ")} failed with exit code ${code}`);
}

async function output(command: string[], cwd = projectRoot): Promise<Buffer> {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    throw new Error(`${command.join(" ")} failed with exit code ${code}: ${stderr.trim()}`);
  }
  return Buffer.from(stdout);
}

async function succeeds(command: string[], cwd = projectRoot): Promise<boolean> {
  const child = Bun.spawn(command, { cwd, stdout: "ignore", stderr: "ignore" });
  return (await child.exited) === 0;
}

function normalizeRepositoryUrl(value: string): string {
  return value.trim().replace(/\.git$/, "").replace(/^git@github\.com:/, "https://github.com/");
}

async function sourceFingerprint(): Promise<{ commit: string; fingerprint: string }> {
  const commit = (await output(["git", "rev-parse", "HEAD"], sourceRoot)).toString().trim();
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(commit);
  hasher.update(await output(["git", "diff", "--binary", "--no-ext-diff", "HEAD", "--"], sourceRoot));

  const untracked = (
    await output(["git", "ls-files", "--others", "--exclude-standard", "-z"], sourceRoot)
  ).toString().split("\0").filter(Boolean).sort();
  for (const relativePath of untracked) {
    hasher.update(`\0${relativePath}\0`);
    hasher.update(await readFile(join(sourceRoot, relativePath)));
  }
  return { commit, fingerprint: hasher.digest("hex") };
}

if (process.platform !== "linux") {
  console.log("[electrobun-bootstrap] TE2 native changes currently target Linux; using the npm package.");
  process.exit(0);
}

if (
  !(await succeeds([
    "pkg-config",
    "--exists",
    "webkit2gtk-4.1",
    "gtk+-3.0",
    "ayatana-appindicator3-0.1",
  ]))
) {
  throw new Error(
    "Electrobun native build dependencies are missing. Install them with: " +
      "sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev " +
      "libayatana-appindicator3-dev librsvg2-dev",
  );
}

if (!(await succeeds(["git", "rev-parse", "--show-toplevel"], sourceRoot))) {
  throw new Error(
    "The Electrobun source submodule is unavailable. Run: " +
      "git submodule update --init --recursive worktrees/electrobun-te2",
  );
}
const origin = (await output(["git", "remote", "get-url", "origin"], sourceRoot)).toString();
if (normalizeRepositoryUrl(origin) !== normalizeRepositoryUrl(ELECTROBUN_FORK_REPOSITORY)) {
  throw new Error(
    `Electrobun submodule origin is ${origin.trim()}; expected ${ELECTROBUN_FORK_REPOSITORY}`,
  );
}

const source = await sourceFingerprint();
const buildMarker = join(cacheRoot, `submodule-build-${process.platform}-${process.arch}.json`);
let buildReady = false;
try {
  const marker = await Bun.file(buildMarker).json() as { fingerprint?: string };
  buildReady = marker.fingerprint === source.fingerprint &&
    await Bun.file(join(packageRoot, platformDist, "libNativeWrapper_cef.so")).exists() &&
    await Bun.file(join(packageRoot, "dist", "api", "bun", "webGPU.ts")).exists();
} catch {}

if (!buildReady) {
  const filesystem = await statfs(sourceRoot);
  const availableBytes = filesystem.bavail * filesystem.bsize;
  if (availableBytes < MINIMUM_BUILD_FREE_BYTES) {
    throw new Error(
      `Electrobun build requires at least 3 GB free; only ${(
        availableBytes / (1024 * 1024 * 1024)
      ).toFixed(1)} GB is available`,
    );
  }
  await run(["bun", "install", "--frozen-lockfile"], packageRoot);
  await run(["bun", "run", "build:release"], packageRoot);
  await mkdir(cacheRoot, { recursive: true });
  await Bun.write(
    buildMarker,
    `${JSON.stringify({ commit: source.commit, fingerprint: source.fingerprint }, null, 2)}\n`,
  );
}

const installedMarker = join(installRoot, ".te2-fork.json");
let installedReady = false;
try {
  const marker = await Bun.file(installedMarker).json() as { fingerprint?: string };
  installedReady = marker.fingerprint === source.fingerprint &&
    await Bun.file(join(installRoot, platformDist, "libNativeWrapper_cef.so")).exists() &&
    await Bun.file(join(installRoot, "dist", "api", "bun", "webGPU.ts")).exists();
} catch {}

if (!installedReady) {
  for (const directory of ["dist", platformDist]) {
    const sourceDirectory = join(packageRoot, directory);
    const destination = join(installRoot, directory);
    await rm(destination, { recursive: true, force: true });
    await cp(sourceDirectory, destination, { recursive: true });
  }
  await Bun.write(
    installedMarker,
    `${JSON.stringify({
      upstreamVersion: "1.18.1",
      commit: source.commit,
      fingerprint: source.fingerprint,
    }, null, 2)}\n`,
  );
}

console.log(
  `[electrobun-bootstrap] ${installedReady ? "reused" : "installed"} TE2 Electrobun ` +
    `${source.commit.slice(0, 12)} (${source.fingerprint.slice(0, 12)})`,
);
