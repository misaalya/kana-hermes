import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { access, cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { cleanStandalone } from "./clean-standalone.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = path.join(root, "cli");
const appManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const cliManifest = JSON.parse(await readFile(path.join(cli, "package.json"), "utf8"));
if (appManifest.version !== cliManifest.version) throw new Error("App and CLI versions must match before packaging.");
if (process.argv.includes("--build")) execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
const output = path.join(cli, ".npm-package");
const runtime = path.join(output, "runtime");
const standalone = path.join(root, ".next", "standalone");
await access(path.join(standalone, "server.js"));
await rm(output, { recursive: true, force: true });
await mkdir(runtime, { recursive: true });

// Ship Next's traced standalone runtime rather than a full build plus a second
// dependency installation. This keeps the global package smaller and avoids
// pulling build-only packages onto the user's machine.
await cp(standalone, runtime, {
  recursive: true,
  force: true,
});
await cleanStandalone(runtime);
// Next's standalone directory is incremental and can retain previously traced
// local state. Scrub the copied runtime defensively instead of trusting the
// cleanliness of a maintainer's .next directory.
for (const localDirectory of [
  ".codegraph",
  ".git",
  ".hermes",
  ".omo",
  ".playwright-mcp",
  "acceptance",
  "auth-reference",
  "data",
  "cli",
  ".npm-package",
  "reference",
  "scripts",
  "test-results",
  "tests",
]) {
  await rm(path.join(runtime, localDirectory), { recursive: true, force: true });
}
for (const entry of await readdir(runtime)) {
  if (entry === ".env" || entry.startsWith(".env.")) {
    await rm(path.join(runtime, entry), { recursive: true, force: true });
  }
}
await mkdir(path.join(runtime, ".next"), { recursive: true });
await cp(path.join(root, ".next", "static"), path.join(runtime, ".next", "static"), {
  recursive: true,
  force: true,
});
await cp(path.join(root, "public"), path.join(runtime, "public"), {
  recursive: true,
  force: true,
});
await cp(
  path.join(root, "services", "qwen3-tts"),
  path.join(runtime, "services", "qwen3-tts"),
  {
    recursive: true,
    filter: (source) => {
      const parts = source.split(path.sep);
      return !parts.includes(".venv") && !parts.includes("__pycache__");
    },
  },
);
// Shipped default voice reference (registered into the library at runtime).
await cp(path.join(root, "assets", "voices"), path.join(runtime, "assets", "voices"), {
  recursive: true,
  force: true,
});
process.stdout.write(`Prepared npm runtime at ${runtime}\n`);

// One launcher/config source; generated distribution copies are never edited.
for (const name of ["bin", "config", "docs", "README.md", "CHANGELOG.md", "PLAN.md", "LICENSE"]) {
  await rm(path.join(cli, name), { recursive: true, force: true });
  await cp(path.join(root, name), path.join(cli, name), { recursive: true });
}
