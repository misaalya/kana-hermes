// Temporary diagnostic (no deps): raw WebSocket handshake + first frame from
// the managed hermes serve, using the exact client the bridge uses (undici).
const fs = require("node:fs");

const env = fs.readFileSync("/proc/41027/environ", "utf8");
const token = env
  .split("\0")
  .find((e) => e.startsWith("HERMES_DASHBOARD_SESSION_TOKEN="))
  .slice("HERMES_DASHBOARD_SESSION_TOKEN=".length);

const origin = process.argv[2] || "http://127.0.0.1:9119";

(async () => {
  const { WebSocket } = await import("undici");
  const ws = new WebSocket(`ws://127.0.0.1:9119/api/ws?token=${token}`, {
    headers: { origin },
  });
  ws.addEventListener("open", () => console.log("OPEN"));
  ws.addEventListener("message", (event) => {
    const text = typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8");
    console.log("MSG:", text.slice(0, 200));
    process.exit(0);
  });
  ws.addEventListener("error", (event) => {
    console.log("ERROR:", event.error?.message ?? event.message ?? "unknown");
    process.exit(1);
  });
  ws.addEventListener("close", (event) => {
    console.log("CLOSE code=", event.code, "reason=", event.reason);
    process.exit(3);
  });
  setTimeout(() => {
    console.log("TIMEOUT-no-msg");
    process.exit(2);
  }, 6000);
})().catch((error) => {
  console.log("FATAL:", error.message);
  process.exit(4);
});
