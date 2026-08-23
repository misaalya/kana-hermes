import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";
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
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "localhost", "95.111.198.170"],
  // Hide the Next.js dev route indicator so it never covers UI text or
  // screenshots during development. Errors are still surfaced normally.
  devIndicators: false,
  turbopack: {
    root: process.cwd(),
  },
  // Exclude non-application directories from the compilation scope so the
  // module graph stays smaller and file-watcher memory is lower.
serverExternalPackages: ["pixi.js"],
  experimental: {
    serverSourceMaps: false,
  },
  outputFileTracingExcludes: isDevelopment
    ? {
        "/": ["./services/**", "./acceptance/**", "./scripts/**/*.mjs"],
      }
    : undefined,
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
            value: "camera=(), geolocation=(), microphone=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
