import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ELECTROBUN_REPOSITORY = "https://github.com/blackboardsh/electrobun.git";
const ELECTROBUN_COMMIT = "4eba723c85b97559e1d9e13439d9a92ede0832e8";

const projectRoot = resolve(import.meta.dir, "..");
const patchPath = join(projectRoot, "patches", "electrobun-1.18.1-te2-linux.patch");
const cacheHome = process.env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache");
const cacheRoot = join(cacheHome, "te2", "electrobun");
const sourceOverride = process.env.TE2_ELECTROBUN_SOURCE?.trim();
const sourceRoot = sourceOverride
  ? resolve(sourceOverride)
  : join(cacheRoot, `source-${ELECTROBUN_COMMIT.slice(0, 12)}`);
const packageRoot = join(sourceRoot, "package");
const installRoot = join(projectRoot, "node_modules", "electrobun");
const platformDist = `dist-linux-${process.arch === "arm64" ? "arm64" : "x64"}`;

async function run(command: string[], cwd = projectRoot): Promise<void> {
  const child = Bun.spawn(command, { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${command.join(" ")} failed with exit code ${code}`);
}

async function succeeds(command: string[], cwd = projectRoot): Promise<boolean> {
  const child = Bun.spawn(command, { cwd, stdout: "ignore", stderr: "ignore" });
  return (await child.exited) === 0;
}

async function digest(path: string): Promise<string> {
  const bytes = await readFile(path);
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

function digestText(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

if (process.platform !== "linux") {
  console.log("[electrobun-bootstrap] TE2 native patches currently target Linux; using the pinned npm package.");
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

const patchHash = await digest(patchPath);
const sourceMarker = join(sourceRoot, ".te2-source.json");
let sourceReady = false;
if (sourceOverride) {
  const head = (await Bun.$`git -C ${sourceRoot} rev-parse HEAD`.text()).trim();
  if (head !== ELECTROBUN_COMMIT) {
    throw new Error(`TE2_ELECTROBUN_SOURCE is at ${head}; expected ${ELECTROBUN_COMMIT}`);
  }
  if (!(await succeeds(["git", "apply", "--check", "--reverse", patchPath], sourceRoot))) {
    throw new Error("TE2_ELECTROBUN_SOURCE does not contain the current TE2 Linux patch");
  }
  sourceReady = true;
} else {
  try {
    const marker = await Bun.file(sourceMarker).json() as { commit?: string; patchHash?: string };
    sourceReady = marker.commit === ELECTROBUN_COMMIT && marker.patchHash === patchHash;
  } catch {}
}

if (!sourceReady) {
  await rm(sourceRoot, { recursive: true, force: true });
  await mkdir(dirname(sourceRoot), { recursive: true });
  await run(["git", "clone", "--filter=blob:none", "--no-checkout", ELECTROBUN_REPOSITORY, sourceRoot]);
  await run(["git", "checkout", "--detach", ELECTROBUN_COMMIT], sourceRoot);
  await run(["git", "apply", patchPath], sourceRoot);
  await Bun.write(sourceMarker, `${JSON.stringify({ commit: ELECTROBUN_COMMIT, patchHash }, null, 2)}\n`);
}

const buildMarker = sourceOverride
  ? join(cacheRoot, `override-build-${digestText(sourceRoot).slice(0, 16)}.json`)
  : join(sourceRoot, ".te2-build.json");
let buildReady = false;
try {
  const marker = await Bun.file(buildMarker).json() as { patchHash?: string };
  buildReady = marker.patchHash === patchHash &&
    await Bun.file(join(packageRoot, platformDist, "libNativeWrapper_cef.so")).exists() &&
    await Bun.file(join(packageRoot, "dist", "api", "bun", "webGPU.ts")).exists();
} catch {}

if (!buildReady) {
  await run(["bun", "install", "--frozen-lockfile"], packageRoot);
  await run(["bun", "run", "build:release"], packageRoot);
  await mkdir(dirname(buildMarker), { recursive: true });
  await Bun.write(buildMarker, `${JSON.stringify({ patchHash }, null, 2)}\n`);
}

const installedMarker = join(installRoot, ".te2-fork.json");
let installedReady = false;
try {
  const marker = await Bun.file(installedMarker).json() as { commit?: string; patchHash?: string };
  installedReady = marker.commit === ELECTROBUN_COMMIT && marker.patchHash === patchHash &&
    await Bun.file(join(installRoot, platformDist, "libNativeWrapper_cef.so")).exists() &&
    await Bun.file(join(installRoot, "dist", "api", "bun", "webGPU.ts")).exists();
} catch {}

if (!installedReady) {
  for (const directory of ["dist", platformDist]) {
    const source = join(packageRoot, directory);
    const destination = join(installRoot, directory);
    await rm(destination, { recursive: true, force: true });
    await cp(source, destination, { recursive: true });
  }

  await Bun.write(
    installedMarker,
    `${JSON.stringify({ upstreamVersion: "1.18.1", commit: ELECTROBUN_COMMIT, patchHash }, null, 2)}\n`,
  );
}
console.log(
  `[electrobun-bootstrap] ${installedReady ? "reused" : "installed"} TE2 Electrobun ` +
    `${ELECTROBUN_COMMIT.slice(0, 12)} (${patchHash.slice(0, 12)})`,
);
