import { chmod, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { packager } from "@electron/packager";

const root = dirname(fileURLToPath(import.meta.url));
const outputPaths = await packager({
  dir: root,
  name: "TE2Desktop",
  executableName: "TE2Desktop-bin",
  platform: "linux",
  arch: "x64",
  out: join(root, "build"),
  overwrite: true,
  prune: true,
  ignore: [/^\/build(?:\/|$)/, /^\/src(?:\/|$)/],
});

for (const outputPath of outputPaths) {
  const launcher = join(outputPath, "TE2Desktop");
  await writeFile(
    launcher,
    '#!/bin/sh\nHERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$HERE/TE2Desktop-bin" --no-sandbox "$@"\n',
    "utf8",
  );
  await chmod(launcher, 0o755);
  console.log(`Wrote launchable app to: ${outputPath}`);
}
