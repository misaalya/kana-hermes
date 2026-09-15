import { spawnSync } from "node:child_process";

const tasks = [
  ["npm", ["run", "lint"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["test"]],
  ["npm", ["run", "test:dogfood-harness"]],
  ["npm", ["run", "test:dogfood-journal"]],
  ["npm", ["run", "test:hermes:active-check"]],
  ["npm", ["run", "test:e2e"]],
];

tasks.push(["npm", ["run", "package:local"]]);
tasks.push(["npm", ["run", "test:pwa:built"]]);

for (const [command, args] of tasks) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
