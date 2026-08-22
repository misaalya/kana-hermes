import { access, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, ".npm-package");
const runtime = path.join(output, "runtime");
await access(path.join(root, ".next", "BUILD_ID"));
await rm(output, { recursive: true, force: true });
await mkdir(runtime, { recursive: true });

await cp(path.join(root, ".next"), path.join(runtime, ".next"), {
  recursive: true,
  filter: (source) => {
    const relative = path.relative(path.join(root, ".next"), source);
    const first = relative.split(path.sep)[0];
    return !["cache", "diagnostics", "standalone", "dev"].includes(first);
  },
});
await cp(path.join(root, "public"), path.join(runtime, "public"), {
  recursive: true,
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
process.stdout.write(`Prepared npm runtime at ${runtime}\n`);
