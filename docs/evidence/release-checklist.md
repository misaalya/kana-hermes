# Release checklist

The order Kana is released in, the scripts that enforce each step, and the rules around building outside the home directory, publishing through Trusted Publishing, and the manual owner-2FA fallback.

**Read when:** you are preparing, building, publishing, or documenting a Kana release.
**Truth in code:** `scripts/assert-npm-release.mjs`, `scripts/prepare-npm-package.mjs`, `scripts/npm-package-smoke.mjs`, `cli/package.json`, `package.json`

## Checklist order

1. Confirm the npm Trusted Publisher entry names repository `misaalya/kana-hermes`, workflow `publish.yml`, and environment `kana`, and that the project license is recorded. A normal release needs no local npm login. `scripts/assert-npm-release.mjs` refuses every other package name, refuses a missing or `UNLICENSED` license, refuses a prerelease published directly under `latest`, requires the root `package.json` to stay private with a version equal to `cli/package.json`, and refuses a dirty git tree.
2. Confirm no open credential leak, data loss, duplicate prompt, or wrong-session issue.
3. Bump the version in both `package.json` files and keep them equal; update the changelog, migration notes, supported Hermes version, and known limitations. `scripts/prepare-npm-package.mjs` throws when the two versions differ.
4. Run `npm audit --omit=dev` and review, rather than blindly auto-fix, every production finding.
5. Run `npm run test:package:npm`. It runs `npm run package:npm` (build, prepare `cli/`, `npm pack --dry-run`) and then `scripts/npm-package-smoke.mjs`, which packs the real tarball, installs it into a temporary prefix, boots it against a fake `hermes` script, and checks the password, data-root, and cross-origin rules. The root app is private; package and publish `cli/` only.
6. Verify the Live2D notices and third-party licenses, and never package user avatar assets. If the renderer or sample integration changed, run `npm run test:live2d:official` (needs network).
7. Run `npm run quality` from a clean checkout with enough disk, at a terminal as well as with its output piped (`docs/agent/quality-gates.md`).
8. Run the Hermes live audit and the isolated restart audit without sending an LLM prompt, and record any incomplete active-turn restart case as a supported-environment limitation. See `docs/agent/quality-gates.md` and `docs/evidence/hermes-restart.md`.
9. If the pinned voice engine or model changed, update `shared/irodori-release.mjs` with the release sizes and SHA-256, install it on target hardware, and keep one intelligibility check.
10. Start `.next/standalone/server.js` from outside the source checkout and run desktop and mobile smoke tests.
11. Create a checksum for the package archive and record the exact Node, Kana, Hermes, and voice-engine versions.
12. Run `npm run dogfood:check` and publish its result with the release evidence. A non-passing field-validation report limits future compatibility claims and must never be presented as passing. See `docs/evidence/dogfood.md`.
13. Write rollback notes: retain the previous package and the browser backup, and never roll back or patch Hermes as part of a Kana rollback.

Every stable release keeps a final semver version and uses the `latest` dist-tag. Extended compatibility still requires one week of dogfood and no unresolved P0/P1 issue.

## Trusted Publishing (default)

A normal release publishes from `.github/workflows/publish.yml`, not from a
local npm login. Push the release commit to `main`, then publish a GitHub
release whose tag is `v<version>`, for example `v0.8.0`. The workflow checks
out that tag, verifies that `v$version` matches the release tag, runs lint,
typecheck, the unit tests, `test:package:npm`, and `assert-npm-release`, then
publishes `./cli` with `--provenance` using the workflow's OIDC identity. No
npm token is stored in the repository or the workflow, and no one answers a 2FA
challenge for this path.

The `kana-alya` package keeps one Trusted Publisher entry: repository
`misaalya/kana-hermes`, workflow `publish.yml`, and environment `kana`. The
workflow keeps `permissions: id-token: write` and `environment: kana`. If the
version is already published, the workflow skips the publish, so a rerun is
safe. After it finishes, verify both `npm view kana-alya@<version> version` and
`npm view kana-alya dist-tags.latest`, then record the workflow URL in the
GitHub release notes.

The GitHub runner builds outside every maintainer home, so this path also
satisfies the local build rule below. Use the manual flow only when the
workflow is unavailable or when a local package verification is required.

## Build outside the home directory

A release build can never run from this checkout. Next.js records the absolute build folder in its runtime files, so a build under the maintainer's home directory would publish their account name with the package. `scripts/prepare-npm-package.mjs` enforces this: `cli/package.json`'s `prepack` calls it with `--build`, so `npm publish ./cli` and a bare `npm pack ./cli` throw from here, while running it without `--build` only warns. Run the release from a clone outside the home directory whose path names no account:

```bash
git status --porcelain        # must be empty; the guard refuses a dirty tree
release=$(mktemp -d /tmp/kana-release.XXXXXX)
git clone <this checkout> "$release" && cd "$release"
git checkout <tag-or-commit>
npm install
npm run test:package:npm      # build, pack, install, and boot the real tarball
npm run publish:cli           # lint, typecheck, unit tests, guard, publish
```

## Manual publishing fallback (owner 2FA)

Use this only when the Trusted Publishing workflow is unavailable. npm then
uses the owner's interactive 2FA. A page that offers **Use security key** is a
valid WebAuthn/passkey challenge; it does not mean that 2FA was skipped because
npm did not ask for a six-digit TOTP code. TOTP and WebAuthn are alternative
second factors: never guess, request from an untrusted source, or enter an OTP
or passkey response on the owner's behalf.

Publishing needs a live owner session, not merely a credential on disk. With a token that is missing, expired, or belongs to an account that is not a maintainer, the registry refuses the write as `E404 ... Not found - PUT ...` for a package that exists; `npm whoami` answering `E401` is the honest signal, and `npm view <name> maintainers` names the account that may publish. Log in again as that account — `npm logout` then `npm login` — and never read the 404 as a reason to change the package name, the registry, or the manifest.

When `xdg-open` is unavailable, use npm's manual-URL mode instead of pressing Enter at a browser-opening prompt:

```bash
npm publish ./cli --ignore-scripts --auth-type=web --browser=false
```

Open the printed `https://www.npmjs.com/auth/cli/...` URL in a browser already signed in as the package owner and leave the final WebAuthn or TOTP interaction to the owner. Keep the publish process running while authorization completes, and require both the successful `+ kana-alya@<version>` output and registry verification of `version` and `dist-tags.latest` before updating the GitHub release notes. For a normal unattended release, use the Trusted Publishing path above instead of weakening 2FA.