import type { NextConfig } from "next";
import { MAX_REQUEST_BODY_BYTES } from "./lib/limits";

const isDevelopment = process.env.NODE_ENV === "development";
const distDir = process.env.KANA_NEXT_DIST_DIR?.trim() || ".next";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://cubism.live2d.com${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: https: http://127.0.0.1:* http://localhost:*",
  "font-src 'self' data:",
  // The browser talks to Hermes only through the same-origin Kana relay
  // (/api/hermes/*); direct loopback WebSocket holes are no longer needed.
  "connect-src 'self' blob: https: http://127.0.0.1:* http://localhost:*",
  "media-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  distDir,
  output: "standalone",
  // Extra hosts allowed to reach `next dev` (e.g. a LAN or VPS address) come
  // from the environment, never from source control.
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    ...(process.env.KANA_DEV_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ],
  // Hide the Next.js dev route indicator so it never covers UI text or
  // screenshots during development. Errors are still surfaced normally.
  devIndicators: false,
  turbopack: {
    root: process.cwd(),
  },
  serverExternalPackages: ["pixi.js"],
  experimental: {
    // Next buffers at most this much of a body for the proxy and silently
    // truncates the rest, so it must cover every route limit (lib/limits.ts).
    proxyClientMaxBodySize: MAX_REQUEST_BODY_BYTES,
    serverSourceMaps: false,
  },
  // Runtime assets from services/ and assets/ are copied deliberately by the
  // packaging scripts. Keep test/reference/tooling data and local symlinks out
  // of every server trace so a release never follows developer-machine state.
  outputFileTracingExcludes: {
    "/*": [
      // Application source is compiled into .next/server; it is never a
      // runtime file dependency. Keep it out of NFT's secondary trace too.
      "./app/**/*",
      "./components/**/*",
      "./lib/**/*.ts",
      "./lib/**/*.tsx",
      "./.codegraph",
      "./.codegraph/**/*",
      "./.hermes/**/*",
      "./.omo/**/*",
      "./.playwright-mcp/**/*",
      "./acceptance/**/*",
      "./auth-reference/**/*",
      "./data/**/*",
      "./cli/**/*",
      "./.npm-package/**/*",
      "./reference/**/*",
      "./scripts/**/*",
      "./services/**/*",
      "./test-results/**/*",
      "./tests/**/*",
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), microphone=(self)",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
