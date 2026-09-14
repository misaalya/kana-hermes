import { readdir, rm } from "node:fs/promises";
import path from "node:path";

// Next's proxy trace can include source files even when route trace excludes
// are configured. Both distribution paths enforce the same runtime boundary.
const runtimeEntries = new Set([
  ".next", "node_modules", "server.js", "package.json", "lib", "bin",
  "config", "shared", "assets", "public", "services", "tools", "docs", "dogfood",
  "README.md", "CHANGELOG.md", "PLAN.md", "LICENSE",
]);

export async function cleanStandalone(directory) {
  for (const entry of await readdir(directory)) {
    if (!runtimeEntries.has(entry)) {
      await rm(path.join(directory, entry), { recursive: true, force: true });
    }
  }
  // Launcher helpers are plain .mjs; TypeScript application modules are
  // compiled into .next/server and must not ship as runtime data.
  async function removeSource(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await removeSource(target);
      else if (/\.tsx?$/.test(entry.name)) await rm(target);
    }
    // Drop directories left empty so no hollow source tree ships.
    if ((await readdir(directory).catch(() => ["keep"])).length === 0) {
      await rm(directory, { recursive: true, force: true });
    }
  }
  await removeSource(path.join(directory, "lib"));
}
