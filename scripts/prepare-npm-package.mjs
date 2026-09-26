import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { access, cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { cleanStandalone } from "./clean-standalone.mjs";
import { copyRuntimeAssets } from "./runtime-assets.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = path.join(root, "cli");
const appManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const cliManifest = JSON.parse(await readFile(path.join(cli, "package.json"), "utf8"));
if (appManifest.version !== cliManifest.version) throw new Error("App and CLI versions must match before packaging.");
// Next.js records the absolute build folder in server.js and
// required-server-files.json, so a build inside the maintainer's home directory
// would publish their user name with the package.
const username = userInfo().username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
if (root.startsWith(homedir() + path.sep) || new RegExp(`(^|[^A-Za-z0-9])${username}($|[^A-Za-z0-9])`).test(root)) {
  const message = `The build folder ${root} names your user account and would be published with the package.`;
  if (process.argv.includes("--build")) {
    throw new Error(`${message} Publish from a fresh clone outside your home directory (docs/RELEASE_CHECKLIST.md, step 5).`);
  }
  process.stderr.write(`Warning: ${message} Do not publish this build.\n`);
}
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
  // Standalone-only additions from `npm run package:local`.
  "bin",
  "config",
  "shared",
  "tools",
  "docs",
  "dogfood",
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
// The npm package keeps its launcher at the package root, not in the runtime.
await copyRuntimeAssets(root, runtime, { launcher: false });
process.stdout.write(`Prepared npm runtime at ${runtime}\n`);

// One launcher/config source; generated distribution copies are never edited.
for (const name of ["bin", "config", "shared", "docs", "README.md", "CHANGELOG.md", "PLAN.md", "LICENSE"]) {
  await rm(path.join(cli, name), { recursive: true, force: true });
  await cp(path.join(root, name), path.join(cli, name), { recursive: true });
}
