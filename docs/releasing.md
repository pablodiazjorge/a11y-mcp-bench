# Releasing the server

How the author publishes a release of the server, the npm package `wcag-evidence-mcp`. Only the author publishes ([`AGENTS.md`](../AGENTS.md)).

The first release, v0.1.0, goes by staged publishing from the author's machine: npm holds the package until a maintainer approves it with two-factor authentication (2FA). Later releases are to come from GitHub Actions with trusted publishing, where npm trusts the workflow instead of a token and records the package's provenance: a public, signed record of the repository and workflow that built it. That workflow is not written yet.

## Before you start

- The pull request of the release is merged. It sets `version` in `packages/wcag-evidence-mcp/package.json`, adds the release's section to [`CHANGELOG.md`](../CHANGELOG.md), updates the status line of both READMEs, and points the links of the package's README to the tag `v<version>`.
- npm 11.15.0 or later, for `npm stage` (`npm --version`).
- An npm account with 2FA. Before the first release, no account owns the name: `npm view wcag-evidence-mcp` answers 404.

## Steps

Run them from a clean clone of `main`, at the commit to release. `<folder>` is an empty folder outside the clone.

1. **Install and run the gate,** as CI does:

   ```bash
   npm ci                       # install what the lockfile pins
   npm run browser:install      # the Chromium that the tests drive
   npm run ci                   # the local gate
   npm run check:lockfile-age   # no version younger than 7 days
   ```

2. **Build and check the package.** `.npmrc` sets `ignore-scripts=true`, so `npm pack` and `npm publish` build nothing themselves:

   ```bash
   npm run release:check
   ```

   It builds `dist/`, then checks that the package holds the built server, its README, its license and `package.json` and nothing else, and that the binary starts from a copy of those files. It runs the smoke test on the build, and prints the file list of `npm pack --dry-run`, which you read.

3. **Pack the checked build, and install the tarball** in `<folder>`. From the root of the clone, without building or changing `dist/` after step 2:

   ```bash
   npx vitest run packages/wcag-evidence-mcp/test/package.test.ts   # fails if dist/ is older than src/, or ships other files
   npm pack --workspace wcag-evidence-mcp --pack-destination <folder>   # the tarball that steps 4 and 5 stage
   ```

   Then, in `<folder>`, which fetches the dependencies from the registry:

   ```bash
   npm init -y                                                      # a package.json, so that npm installs into this folder
   npm install --ignore-scripts ./wcag-evidence-mcp-<version>.tgz   # this folder has no .npmrc, so turn install scripts off here too
   node node_modules/wcag-evidence-mcp/dist/bin.js install-browser  # the Chromium of this version
   npx -y @modelcontextprotocol/inspector@2.16.0 --cli node node_modules/wcag-evidence-mcp/dist/bin.js --method tools/list   # lists audit_route and explain_criterion
   ```

4. **Stage the package:** the tarball of step 3, which was checked and installed, so that npm uploads what was tested. `npm stage publish` takes a tarball, as `npm publish` does: its dry run did, with npm 11.20.0. From the root of the clone:

   ```bash
   npm login                                                            # as the account that will own the package
   npm stage publish --dry-run <folder>/wcag-evidence-mcp-<version>.tgz   # shows what would be staged, and uploads nothing
   npm stage publish <folder>/wcag-evidence-mcp-<version>.tgz             # uploads it to npm's staging area
   ```

   For a new package, npm shows a public placeholder, `0.0.0-stage`, until the approval ([npm's documentation on staged publishing](https://docs.npmjs.com/staged-publishing)).

5. **Review and approve** the staged package:

   ```bash
   npm stage list wcag-evidence-mcp   # gives the stage id
   npm stage download <stage-id>      # to compare its files with the list of step 2
   npm stage approve <stage-id>       # asks for the 2FA code and publishes
   npm stage reject <stage-id>        # removes the staged package instead
   ```

   The commands of steps 4 and 5 are read in npm's documentation and help; v0.1.0 is their first use in this project.

6. **Check the release:** `npm view wcag-evidence-mcp version` gives the new version. Repeat the second block of step 3, in a new empty folder, with `npm install --ignore-scripts wcag-evidence-mcp@<version>` in place of the tarball.

7. **Tag the commit** `v<version>` and make its GitHub release, which the changelog's section links to. The links of the package's README lead to that tag.

## If something goes wrong

- **Staging fails:** stop and ask the author. Do not fall back to publishing with a token.
- **A published version is wrong:** deprecate it with `npm deprecate wcag-evidence-mcp@<version> "<reason>"`, and publish a fixed version. npm allows an unpublish only within its limits ([npm's unpublish policy](https://docs.npmjs.com/policies/unpublish)).

## Later

- **Trusted publishing.** It is set up in the package's settings on npmjs.com, after the first release: the repository, the workflow file and, optionally, an environment. Provenance needs the `repository` field of the package to match the repository that publishes, which it does.
- **The MCP registry.** Its entry, a `server.json`, is planned for v1.0. The registry checks that `mcpName` in the package, `io.github.pablodiazjorge/wcag-evidence-mcp`, matches the name of that entry. The registry is in preview.
