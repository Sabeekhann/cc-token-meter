# Releasing Claude Code Token Meter

Releases are maintainer-controlled. Pull requests never publish packages, and
the publish workflow has no long-lived registry token.

## Before the first npm release

The npm package must exist before its settings can trust a GitHub Actions
publisher. For version `1.0.0`:

1. Sign in to npm locally with an account that owns the package name.
2. Run `npm run ci` and inspect `npm pack --dry-run`.
3. Publish once from the trusted local machine with npm's required interactive
   authentication:

   ```bash
   npm publish --access public
   ```

4. Open the package settings on npm and add this trusted publisher:

   ```text
   Provider: GitHub Actions
   Organization or user: Sabeekhann
   Repository: cc-token-meter
   Workflow filename: publish.yml
   Allowed action: npm publish
   ```

Do not create or store an `NPM_TOKEN` in this repository.

## Normal release

1. Update `package.json` and `package-lock.json` to the same version.
2. Move relevant entries from `Unreleased` into a versioned section in
   `CHANGELOG.md` using `## [x.y.z]`.
3. Run:

   ```bash
   npm ci
   npm run ci
   npm pack --dry-run
   node .github/scripts/verify-release.mjs vx.y.z
   ```

4. Merge the release change through the protected `main` branch.
5. Create a non-prerelease GitHub Release with tag `vx.y.z` from that exact
   commit.
6. Confirm both publish jobs pass:
   - **Publish / npm** publishes `cc-token-meter@x.y.z` with provenance linked
     to this repository.
   - **Publish / GitHub Packages** publishes
     `@sabeekhann/cc-token-meter@x.y.z` with the short-lived repository token.
7. Confirm both registry pages show the exact release version. Smoke-test the
   public npm package from a clean temporary directory:

   ```bash
   npx cc-token-meter@x.y.z --version
   npx cc-token-meter@x.y.z --help
   ```

The workflow rejects a tag that differs from `package.json`, a missing
changelog section, private/restricted npm publishing, the wrong repository, or
an incomplete package file list. The GitHub Packages job changes only its
temporary checkout metadata to the scoped package name; committed npm metadata
remains unchanged.

## Failed or incorrect release

Never reuse or move a published version tag. Fix the problem, increment the
version, document the correction, and publish a new release. If a version is
unsafe, deprecate that version on npm with a clear replacement message and
publish a corrected version. Package unpublishing should be a last resort and
must follow npm policy.
