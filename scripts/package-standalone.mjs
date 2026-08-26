import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

await access(path.join(standalone, "server.js"));
await mkdir(path.join(standalone, ".next"), { recursive: true });
await mkdir(path.join(standalone, "tools"), { recursive: true });
await mkdir(path.join(standalone, "docs"), { recursive: true });
await mkdir(path.join(standalone, "dogfood"), { recursive: true });
await cp(
  path.join(root, ".next", "static"),
  path.join(standalone, ".next", "static"),
  { recursive: true, force: true },
);

try {
  await access(path.join(root, "public"));
  await cp(path.join(root, "public"), path.join(standalone, "public"), {
    recursive: true,
    force: true,
  });
} catch {
  // Kana currently serves metadata assets through the App Router.
}

await cp(
  path.join(root, "services", "qwen3-tts"),
  path.join(standalone, "services", "qwen3-tts"),
  {
    recursive: true,
    force: true,
    filter: (source) => {
      const parts = source.split(path.sep);
      return !parts.includes("__pycache__") && !parts.includes(".venv");
    },
  },
);
// Shipped default voice reference (registered into the library at runtime).
await cp(path.join(root, "assets", "voices"), path.join(standalone, "assets", "voices"), {
  recursive: true,
  force: true,
});
await cp(
  path.join(root, "README.md"),
  path.join(standalone, "README.md"),
  { force: true },
);
for (const tool of ["qwen3-tts-acceptance.mjs", "dogfood-check.mjs"]) {
  await cp(path.join(root, "scripts", tool), path.join(standalone, "tools", tool), {
    force: true,
  });
}
await cp(path.join(root, "docs"), path.join(standalone, "docs"), {
  recursive: true,
  force: true,
});
for (const document of ["PLAN.md", "CHANGELOG.md"]) {
  await cp(path.join(root, document), path.join(standalone, document), {
    force: true,
  });
}
await cp(
  path.join(root, "dogfood", "journal.json"),
  path.join(standalone, "dogfood", "journal.json"),
  { force: true },
);

process.stdout.write(
  [
    "Kana standalone package is ready:",
    `  ${standalone}`,
    "Run from that directory with:",
    "  HOSTNAME=127.0.0.1 PORT=3000 node server.js",
  ].join("\n") + "\n",
);
