# Changelog

Notable changes to this project, one section per release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), except that a release section has no date: its title links to the GitHub release, which records it. A release section also lists its known limits. Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

Nothing yet.

## [0.1.0](https://github.com/pablodiazjorge/a11y-mcp-bench/releases/tag/v0.1.0)

The first release of the server, published to npm as `wcag-evidence-mcp`. It is early: the tools and their output may change before 1.0.

### Added

- **The package** `wcag-evidence-mcp`, a binary that serves MCP over stdio, for Node 26, or Node 24.15 or a later 24.x. A client starts it with `npx -y wcag-evidence-mcp@0.1.0` ([its README](packages/wcag-evidence-mcp/README.md)).
- **`audit_route`** audits one page served on this machine against twelve WCAG 2.2 criteria, at levels A and AA, and returns one finding per element that fails a rule: its criteria, what was measured and where the element is, with its selector, its place on the page and, on an Angular page, the component that declares it. The output says the page's HTTP status, how many requests the URL policy refused, whether the page settled, and which criteria the call could not check fully ([the reference of the tools](docs/tools.md)).
- **How the twelve are checked** ([the scope page](docs/wcag-2.2-scope.md)):
  - axe-core decides 1.1.1, 1.3.1, 1.3.5, 1.4.3, 2.4.4 and 4.1.2, and reports candidates for 2.5.8 with its rule `target-size`;
  - a walk with the keyboard checks the other five: 2.4.7 Focus Visible by comparing pixels, 2.4.11 Focus Not Obscured (Minimum) by points and layers over the focused element, and heuristics for 2.1.1, 2.1.2 and 2.4.3; three axe-core rules also check part of 2.1.1. The walk presses only Tab, Shift+Tab and, inside a cycle, Escape ([ADR 0007](docs/adr/0007-keyboard-checks.md)).
- **Text from the page** reaches the output only labeled, capped and cleaned, so that the agent reads it as data ([ADR 0006](docs/adr/0006-untrusted-page-text.md)).
- **`explain_criterion`,** and the resources `criterion://<number>`, explain any of the twelve: what it requires, how the server checks it and what is left for a person.
- **The URL policy:** the server opens only `http://localhost` or `http://127.0.0.1` with an explicit port, and Chromium resolves no other host ([ADR 0005](docs/adr/0005-url-policy.md)). A page may read from any local port, but write only to its own ([ADR 0009](docs/adr/0009-local-port-writes.md)).
- **Chromium's sandbox,** on by default; `WCAG_EVIDENCE_MCP_NO_SANDBOX=1` turns it off where the system does not allow it ([ADR 0008](docs/adr/0008-chromium-sandbox.md)).
- **`npx -y wcag-evidence-mcp@0.1.0 install-browser`** downloads the Chrome Headless Shell that this version drives, and removes no other browser; `--with-deps` adds its system libraries on Linux, with administrator rights.

### Known limits

- What each criterion leaves for a person is in [the scope page](docs/wcag-2.2-scope.md); what the server does not defend against is in [the threat model](THREAT_MODEL.md).
- The facts behind the checks were observed on Windows; CI runs the tests on Ubuntu and Windows. macOS was not tested.
- It does not see what opens on a click, such as a dialog behind a button, since it never activates anything ([ADR 0007](docs/adr/0007-keyboard-checks.md)).
- Elements inside a frame are not audited.
- **On Ubuntu 23.10 and later,** Chromium's sandbox needs unprivileged user namespaces, which the system restricts; the audit fails until they are allowed or the user turns the sandbox off ([ADR 0008](docs/adr/0008-chromium-sandbox.md)).
- **No provenance:** v0.1.0 was published from the author's machine, so nothing on npm ties the package to a commit of this repository ([the threat model](THREAT_MODEL.md)).
- **The keyboard criteria take seconds** more per call, and on a page with more than about 850 elements that Tab reaches they go to `notChecked` ([the architecture](docs/architecture.md#the-keyboard-walk)).
