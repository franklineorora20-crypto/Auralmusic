import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const outDir = path.resolve("dist-server");
fs.mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: ["server.ts"],
  outfile: path.join(outDir, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: false,
});

console.log("Built dist-server/server.mjs");
