# a11y-mcp-bench

Does an accessibility MCP server help a coding agent fix WCAG defects in an Angular app, and at what cost?

This repository will hold a benchmark that answers that question, and one of the MCP servers it measures. An MCP (Model Context Protocol) server gives a coding agent extra tools to call. WCAG (Web Content Accessibility Guidelines) is the standard that defines an accessibility defect.

[Versión en castellano](README.es.md)

## Status

Early. There is no server or benchmark to run yet: the repository holds the tooling, continuous integration (CI) and the project rules.

## What it will measure

A coding agent receives an Angular app with one accessibility defect planted on purpose (a seeded defect) and is asked to fix it. Each task runs under conditions that differ in one thing: which accessibility MCP server the agent has, if any. The first study plans three: no server, the server of this project and an existing third-party server.

- **Outcome:** a task is solved when the test for its defect, which the agent cannot see, passes, the regression tests still pass and the app still builds. Tests decide, not a language model.
- **Cost:** tokens, turns and time for each run.
- **Method:** the tasks, the grading and the analysis are frozen and published before the first study run (a preregistration), and the report comes out whatever the result is. [ADR 0002](docs/adr/0002-methodology.md) (an architecture decision record) explains why.

## Roadmap

| Step           | Content                                                                                                         | Issue                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Foundations    | Tooling, CI, rules and the first decisions                                                                      | [#3](https://github.com/pablodiazjorge/a11y-mcp-bench/issues/3) |
| Server, part 1 | Skeleton, URL policy (which pages the server may open) and page audit                                           | [#4](https://github.com/pablodiazjorge/a11y-mcp-bench/issues/4) |
| Server, part 2 | Keyboard and focus checks; release v0.1.0                                                                       | [#5](https://github.com/pablodiazjorge/a11y-mcp-bench/issues/5) |
| Reference app  | An accessible shop in Angular                                                                                   | [#6](https://github.com/pablodiazjorge/a11y-mcp-bench/issues/6) |
| Defects        | Statistics, power simulation (how many tasks the study needs to detect an effect) and seeded defects            | [#7](https://github.com/pablodiazjorge/a11y-mcp-bench/issues/7) |
| Harness        | The harness (the program that runs the agent on each task and records the result) and a small trial run (pilot) | [#8](https://github.com/pablodiazjorge/a11y-mcp-bench/issues/8) |
| Study 1        | Preregistration, runs, report; release v1.0.0                                                                   | [#9](https://github.com/pablodiazjorge/a11y-mcp-bench/issues/9) |

The parts and how they depend on each other are in [docs/architecture.md](docs/architecture.md).

## What it is not

- **Not a complete WCAG auditor.** Automatic checks find only part of the accessibility problems of a page.
- **Only Angular.** The reference app and the defects are Angular code.
- **Only Claude Code until v1.0.0.** Other agents may come later.
- **Only local pages.** The server audits pages served from the same machine.

[ADR 0001](docs/adr/0001-scope-and-non-goals.md) gives the reasons and explains why the project has a server of its own when others exist.

## Prior work

Checked on 2026-11-12.

**MCP servers that audit accessibility already exist.** Most run axe-core, a library of automatic accessibility checks. The last row is the Angular CLI's own server, which has none:

| Server                                                                                                          | What it offers                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Deque axe MCP Server](https://docs.deque.com/devtools-server/4.0.0/en/axe-mcp-server)                          | `analyze` runs axe in a real browser. Its fix guidance and its guided keyboard tests are paid features                                                                                                    |
| [mcp-accessibility-scanner](https://github.com/JustasMonkev/mcp-accessibility-scanner)                          | axe-core with Playwright. Its `audit_keyboard` tool tabs through the page and reports focus visibility, possible focus traps, and heuristics for WCAG 2.4.11 (focus not obscured) and 2.5.8 (target size) |
| [a11y-mcp](https://github.com/priyankark/a11y-mcp), [a11y-mcp-server](https://github.com/ronantakizawa/a11ymcp) | axe-core with Puppeteer                                                                                                                                                                                   |
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)                                    | `lighthouse_audit`, with an accessibility category                                                                                                                                                        |
| [Angular CLI MCP server](https://angular.dev/ai/mcp)                                                            | Nine documented tools, none about accessibility                                                                                                                                                           |

**One vendor has already published this comparison.** [AccessLint](https://dev.to/cameron-accesslint/accessibility-tooling-for-agentic-coding-loops-5b1h) published the results of an agent with and without its own MCP server on 25 HTML test cases. The agent fixed 99.5% of the violations with the server and 93.5% without it. With 93.5% fixed without help, there is little room left to show an improvement.

**Research on language models and accessibility:**

- [LLM Based Web Accessibility Repair](https://arxiv.org/abs/2605.27716) (Oyelayo et al., 2026): fewer than 26% of the cases were fully resolved, and iterating raised the cost without improving the result. The authors recommend combining the model with rule-based validation.
- [A11YRepair](https://arxiv.org/abs/2606.21926) (Huang et al., 2026): a repair method evaluated on A11YBench, 60 real web projects.
- [A11y-Bench](https://repositum.tuwien.at/handle/20.500.12708/224566) (Tschoner, 2025): 51 real accessibility fixes from open-source repositories; with three open-weight models (models anyone can download), only 1 was fully resolved.
- [a11y-llm-eval](https://github.com/microsoft/a11y-llm-eval) (Microsoft): measures how accessible the HTML that models generate is.

**What this project will add:** the same with-and-without comparison, with the method fixed and published before the runs, on the repository of an Angular app instead of HTML test cases, and with defects chosen, after a pilot, so that the agent alone does not already fix nearly all of them. As with AccessLint, the author also writes one of the servers he measures, so the method is designed to limit how far a reader has to trust him: see [ADR 0002](docs/adr/0002-methodology.md).

## Development

You need Node 26 (or Node 24.15 or a later 24.x) and npm 11.

```bash
npm ci
npm run ci
```

The rules for a change are in [AGENTS.md](AGENTS.md), and the way to propose one is in [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## How this is built

The author decides the scope and the architecture, and writes down each decision that is hard to undo as an ADR in [docs/adr/](docs/adr/). Coding agents (Claude Code) write most of the code and the documents, under the rules in [AGENTS.md](AGENTS.md).

Every change that an agent writes passes the local gate (`npm run ci`) and CI, and another agent that did not write it reviews it. The author reads each diff, makes the commit and merges the pull request.

## Limitations

- No result exists yet, so nothing here says whether a server helps.
- A benchmark with one app, one agent and seeded defects says little about other frameworks, other agents or the defects that real projects have.
- The personal data check relies on patterns that can miss a case, and the lockfile age check does not catch a `file:` dependency on a folder. `AGENTS.md` and the pull requests that added each check describe their known gaps.

## License

Code, tests, task definitions and configuration are under the [MIT License](LICENSE). Documents and published benchmark results are under [CC BY 4.0](LICENSE-CC-BY-4.0).
