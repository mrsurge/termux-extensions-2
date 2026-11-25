// Apply to the Android consumer's staged Electron package before packing app.asar.
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2];
if (!root) throw new Error("Pass the staged Android Electron app directory");
const manifest = join(root, "package.json");
const app = JSON.parse(await readFile(manifest, "utf8"));
await copyFile(new URL("./native.css", import.meta.url), join(root, "te2-native.css"));
app.electromux = { ...app.electromux, stylesheet: "te2-native.css" };
await writeFile(manifest, JSON.stringify(app, null, 2) + "\n");
