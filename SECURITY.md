# Security policy

## Reporting a vulnerability

Report it in private, through [GitHub's private vulnerability reporting](https://github.com/pablodiazjorge/a11y-mcp-bench/security/advisories/new). Do not open a public issue for it.

Include what you found, how to reproduce it and what an attacker could do with it. The project has one maintainer, so expect an answer within 30 days.

## Supported versions

Only the `main` branch is supported until the first release. After that, the latest release is.

## Scope

- The code in this repository: the scripts, the CI workflows and, when they arrive, the MCP server and the benchmark harness.
- A way to make the repository checks or the lockfile age check pass when they should fail counts as a vulnerability, unless it is a known gap listed in `AGENTS.md` or in the pull request that added the check.

Out of scope: vulnerabilities in a dependency that this project does not make worse. Report those to the dependency.
