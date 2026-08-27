import { readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

// `kana` and `kana-ui` currently belong to unrelated projects on npm. Fail
// closed so a release cannot accidentally target someone else's package. The
// owner may explicitly acknowledge a completed transfer/reclamation at the
// moment of publishing without weakening normal release checks.
const occupiedNames = new Set(["kana", "kana-ui"]);
if (
  occupiedNames.has(manifest.name) &&
  process.env.KANA_NPM_OWNERSHIP_CONFIRMED !== "1"
) {
  process.stderr.write(
    [
      `Refusing to publish npm package \`${manifest.name}\`.`,
      "That registry name is owned by an unrelated project.",
      "Acquire/confirm ownership first, then publish with",
      "KANA_NPM_OWNERSHIP_CONFIRMED=1, or choose a scope you control.",
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
