import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Playwright uses an isolated Next.js dist directory so it never locks or
    // reuses a developer's running application build.
    ".next-e2e/**",
    // An optional isolated dist directory for local debugging servers, for the
    // same reason.
    ".next-debug/**",
    // The README screenshot capture runs its own server, for the same reason.
    ".next-readme/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated npm-package payload from scripts/prepare-npm-package.mjs.
    ".npm-package/**",
    "cli/**",
    // Local Python runtimes contain generated third-party frontend bundles.
    "**/.venv/**",
    // Read-only AIRI reference checkout used for pattern study; it has its
    // own toolchain and must never be linted or type-checked from here.
    "reference/**",
    // Read-only 9Router reference checkout used for the auth pattern study.
    "auth-reference/**",
    // Gitignored study checkouts of other projects (see .gitignore).
    ".study/**",
    // The gitignored local security assessment's cloned tooling (see
    // .gitignore). It is not Kana code and has never been linted from here.
    "security-audit/**",
  ]),
]);

export default eslintConfig;
