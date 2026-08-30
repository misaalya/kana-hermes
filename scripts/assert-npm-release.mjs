import { readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
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
