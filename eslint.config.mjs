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
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated npm-package payload from scripts/prepare-npm-package.mjs.
    ".npm-package/**",
    // Local Python runtimes contain generated third-party frontend bundles.
    "**/.venv/**",
    // Read-only AIRI reference checkout used for pattern study; it has its
    // own toolchain and must never be linted or type-checked from here.
    "reference/**",
    // Read-only 9Router reference checkout used for the auth pattern study.
    "auth-reference/**",
  ]),
]);

export default eslintConfig;
