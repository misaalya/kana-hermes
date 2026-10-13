/**
 * Local debugging server for the workspace.
 *
 * A copy of the Playwright dev server with no test runner attached: same
 * isolated data root and password, so a browser session behaves exactly like
 * the acceptance journeys. Hermes is not required to open the shell, and the
 * agent-input dialogs can be driven by emitting Hermes relay events into the
 * page (see the snapshot below for the SSE plumbing).
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PASSWORD = "kana-e2e-access-password";
const PORT = "3100";
const DATA_DIR = "/tmp/opencode/kana-debug-data";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
mkdirSync(DATA_DIR, { recursive: true });

async function seedPassword() {
  await new Promise((resolve, reject) => {
    const child = spawn("node", ["bin/kana.mjs", "password", "--stdin"], {
      cwd: root,
      stdio: ["pipe", "inherit", "inherit"],
      env: { ...process.env, KANA_DATA_DIR: DATA_DIR },
    });
    child.stdin.end(`${PASSWORD}\n`);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`password exit ${code}`)),
    );
  });
}

await seedPassword();

const server = spawn(
  "npm",
  ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", PORT],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      KANA_NEXT_DIST_DIR: ".next-debug",
      KANA_DATA_DIR: DATA_DIR,
    },
  },
);
process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));
console.log(`Kana debug server on http://127.0.0.1:${PORT} (password: ${PASSWORD})`);
console.log(`Data root: ${DATA_DIR}`);