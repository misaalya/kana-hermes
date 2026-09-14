import { readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../cli/package.json", import.meta.url), "utf8"),
);

// Fail closed so a release cannot accidentally target an old or unrelated
// registry name after a local manifest edit.
if (manifest.name !== "kana-alya") {
  process.stderr.write(
    [
      `Refusing to publish npm package \`${manifest.name}\`.`,
      "This repository is allowed to publish only as `kana-alya`.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

if (!manifest.license || manifest.license === "UNLICENSED") {
  process.stderr.write(
    "Refusing to publish until the project owner chooses and records a license.\n",
  );
  process.exit(1);
}

if (
  String(manifest.version).includes("-") &&
  manifest.publishConfig?.tag === "latest"
) {
  process.stderr.write(
    "Refusing to publish a prerelease version directly under the latest dist-tag.\n",
  );
  process.exit(1);
}

const app = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
if (!app.private || app.version !== manifest.version) {
  throw new Error("The source app must stay private and its version must match cli/package.json.");
}

// Publish exactly what is committed: a dirty tree could ship unreviewed
// launcher, service, or asset changes that no commit records.
try {
  const { execFileSync } = await import("node:child_process");
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  }).trim();
  if (dirty) {
    process.stderr.write(`Refusing to publish from a dirty working tree:\n${dirty}\n`);
    process.exit(1);
  }
} catch (error) {
  if (error?.code === "ENOENT") {
    process.stderr.write("Refusing to publish: git is required to verify the working tree.\n");
    process.exit(1);
  }
  throw error;
}
