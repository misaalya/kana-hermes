import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { platform, tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const temporary = await mkdtemp(path.join(tmpdir(), "kana-npm-smoke-"));
const packRoot = path.join(temporary, "pack");
const installRoot = path.join(temporary, "install");
const home = path.join(temporary, "home");

try {
  await mkdir(packRoot, { recursive: true });
  const packed = run("npm", [
    "pack",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    packRoot,
  ], root);
  const packResult = JSON.parse(packed.stdout)[0];
  if (!packResult?.filename || !Array.isArray(packResult.files)) {
    throw new Error("npm pack did not return a file manifest.");
  }

  const paths = new Set(packResult.files.map((entry) => entry.path));
  for (const required of [
    "bin/kana.mjs",
    ".npm-package/runtime/server.js",
    ".npm-package/runtime/.next/BUILD_ID",
    ".npm-package/runtime/assets/voices/kana-default.wav",
    ".npm-package/runtime/public/backgrounds/kana-room.png",
    ".npm-package/runtime/services/qwen3-tts/pyproject.toml",
  ]) {
    if (!paths.has(required)) throw new Error(`npm package is missing ${required}`);
  }
  const forbidden = [...paths].find((entry) =>
    /(^|\/)\.env(?:\.|$)/.test(entry) ||
    /(^|\/)(?:\.git|\.omo|\.codegraph|data|test-results|auth-reference)(?:\/|$)/.test(entry)
  );
  if (forbidden) {
    throw new Error(`npm package contains forbidden local content: ${forbidden}`);
  }

  const archive = path.join(packRoot, packResult.filename);
  run("npm", [
    "install",
    "--global",
    "--ignore-scripts",
    "--prefix",
    installRoot,
    archive,
  ], root);

  const executable = platform() === "win32"
    ? path.join(installRoot, "kana.cmd")
    : path.join(installRoot, "bin", "kana");
  const aliasExecutable = platform() === "win32"
    ? path.join(installRoot, "kana-ui.cmd")
    : path.join(installRoot, "bin", "kana-ui");
  await access(executable);
  await access(aliasExecutable);
  const environment = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
  };

  const help = run(executable, ["--help"], root, environment);
  if (!help.stdout.includes("Start Kana and open the browser")) {
    throw new Error("installed Kana launcher did not render its help output.");
  }
  const aliasHelp = run(aliasExecutable, ["--help"], root, environment);
  if (!aliasHelp.stdout.includes("Start Kana and open the browser")) {
    throw new Error("installed kana-ui command alias did not render its help output.");
  }
  const doctor = run(executable, ["doctor"], root, environment);
  if (doctor.stdout.includes("first-run setup")) {
    throw new Error("kana doctor unexpectedly launched interactive setup.");
  }

  const port = await availablePort();
  const child = spawn(executable, ["--no-open", "--port", String(port)], {
    cwd: root,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  try {
    await waitFor(() => output.includes(`Kana is ready at http://127.0.0.1:${port}`), 30_000);
    if (output.includes("Kana first-run setup")) {
      throw new Error("the installed launcher blocked first start with terminal setup.");
    }
    const status = await fetch(`http://127.0.0.1:${port}/api/auth/status`);
    if (!status.ok) throw new Error(`installed Kana health returned ${status.status}.`);
    const setup = await fetch(`http://127.0.0.1:${port}/api/kana/setup`);
    const setupState = await setup.json();
    if (!setup.ok || setupState.onboardingCompleted !== false) {
      throw new Error("the npm launcher did not preserve the in-app onboarding flow.");
    }
    const foreignOrigin = await fetch(`http://127.0.0.1:${port}/api/kana/sessions`, {
      headers: { Origin: "https://untrusted.example" },
    });
    if (foreignOrigin.status !== 403) {
      throw new Error("no-auth local API accepted a non-loopback Origin.");
    }
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }

  process.stdout.write(
    `npm package smoke test passed (${packResult.size} bytes packed, ${packResult.unpackedSize} bytes unpacked).\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr || result.stdout}`,
    );
  }
  return result;
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out after ${timeoutMs / 1000} seconds`);
}
