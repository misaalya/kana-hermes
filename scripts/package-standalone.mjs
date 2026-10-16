import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { cleanStandalone } from "./clean-standalone.mjs";
import { copyRuntimeAssets } from "./runtime-assets.mjs";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

await access(path.join(standalone, "server.js"));
await cleanStandalone(standalone);
await mkdir(path.join(standalone, "tools"), { recursive: true });
await mkdir(path.join(standalone, "docs"), { recursive: true });
await copyRuntimeAssets(root, standalone, { launcher: true });
await cp(
  path.join(root, "README.md"),
  path.join(standalone, "README.md"),
  { force: true },
);
for (const tool of ["dogfood-check.mjs"]) {
  await cp(path.join(root, "scripts", tool), path.join(standalone, "tools", tool), {
    force: true,
  });
}
await cp(path.join(root, "docs"), path.join(standalone, "docs"), {
  recursive: true,
  force: true,
});
for (const document of ["CHANGELOG.md"]) {
  await cp(path.join(root, document), path.join(standalone, document), {
    force: true,
  });
}
// The dogfood journal is this machine's local evidence: seed the package with
// it when this checkout has one, and package without a journal when it does
// not.
const journal = path.join(root, "dogfood", "journal.json");
if (await exists(journal)) {
  await mkdir(path.join(standalone, "dogfood"), { recursive: true });
  await cp(journal, path.join(standalone, "dogfood", "journal.json"), {
    force: true,
  });
}

process.stdout.write(
  [
    "Kana standalone package is ready:",
    `  ${standalone}`,
    "Set the access password once, then start it:",
    "  node bin/kana.mjs password",
    "  node bin/kana.mjs serve --port 3000",
  ].join("\n") + "\n",
);
