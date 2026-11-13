# 0001. Scope and non-goals

- **Status:** Accepted
- **Decided:** 2026-11-12

## Context

The first idea was an MCP (Model Context Protocol) server, which gives a coding agent extra tools to call, that audits a page with axe-core (an open-source library of automatic accessibility checks) and checks keyboard focus, plus a benchmark that measures whether that server helps a coding agent. A review of existing work changed that idea (sources in the [README](../../README.md#prior-work)):

- **Scanning with axe-core through MCP already exists.** At least four servers do it, one of them from Deque (`axe-mcp-server`).
- **The Angular CLI's MCP server does not fill the gap.** None of its nine documented tools is about accessibility.
- **Keyboard and focus are partly covered too.** `mcp-accessibility-scanner` has a tool that tabs through the page and reports focus visibility, possible focus traps, and heuristics for two WCAG (Web Content Accessibility Guidelines) criteria: obscured focus (2.4.11) and target size (2.5.8).
- **The only published measurement found comes from a vendor.** AccessLint published a comparison of an agent with and without its own server on 25 HTML test cases: the agent fixed 99.5% of the violations with the server and 93.5% (188 of 201) without it. With 93.5% fixed without help, there is little room to show an improvement.
- **Academic studies find more left undone, with other models and stricter measures.** Studies of language models that repair accessibility defects find that most cases are not fully resolved, and one recommends combining the model with rule-based checks. None of the studies found compares an agent with and without an MCP server on an app's repository.

What is missing is not another general server but a measurement that a reader can trust.

## Options considered

1. **A general accessibility server, with a benchmark of its own.** The original idea. Most of its tools would repeat what others already ship, and a benchmark built around its author's own server convinces few readers.
2. **A benchmark of third-party servers only.** The most independent option, and the cheapest: a pinned version keeps a third-party server stable during the runs. But it can only say whether the servers that exist help. It cannot change one thing in a server's output and measure what that change does.
3. **Add the checks to an existing open-source server, or fork it.** A contribution has real users from the first day, but the study would depend on another project's decisions and calendar. A fork, or a proxy that edits the output, avoids that. But it starts from tools and an output designed for another purpose: `mcp-accessibility-scanner` also exposes general browser tools, and isolating one part of its evidence would mean rewriting most of it.
4. **An independent benchmark, plus a small server of its own as the instrument of the study, with a third-party server as one more condition** (a setup the agent is tested under, such as "no server" or "this server").

## Decision

Option 4. It keeps a server of its own, but the value of the project no longer rests on its checks being new or on it winning.

**The benchmark is the contribution.** It measures whether an accessibility MCP server helps a coding agent fix WCAG defects in the repository of an Angular app, and at what cost. The method is in ADR 0002.

**The server is the instrument of the study.** It is called `wcag-evidence-mcp` and lives in `packages/wcag-evidence-mcp`. The names `a11y-mcp` and `a11y-mcp-server` already belong to other servers on npm.

- It audits a page with axe-core and maps each finding to its WCAG criterion.
- It checks keyboard focus and target size, starting with three WCAG 2.2 criteria: 2.4.7 Focus Visible, 2.4.11 Focus Not Obscured (Minimum) and 2.5.8 Target Size (Minimum). The full list of criteria is a later decision.
- These checks are not new: `mcp-accessibility-scanner` already checks focus visibility and has heuristics for 2.4.11 and 2.5.8. The server exists because the project controls it. Its output is designed as evidence an agent can act on (what was measured, where, and which written definition of a failure applies), and a later study can change one part of that output and measure whether that part is what helps.
- The first study measures the server as a whole and does not use that control. The output keeps its parts (the measurement, its location and the definition that applies) separate, so that a later study can leave one out and keep the rest the same.

**A third-party server is a condition of the first study.** The first study plans three conditions: no server, this server and an existing third-party server, on the same tasks. With a published server that already checks focus visibility, obscured focus and target size, it is the first comparison a reader will ask for. The preregistration of each study (its plan, published before the first run) names its conditions. If the cost that the pilot measures does not allow three, the preregistration says which one is left out and why.

**Non-goals:**

- **Not a complete WCAG auditor.** Automatic checks find only some of a page's problems. The project lists the criteria the server checks and says that the rest need manual testing.
- **Only Angular.** The reference app and the defects are Angular code. One framework keeps the tasks comparable, and it is the one the author knows best.
- **Only Claude Code until v1.0.0.** One agent, one fixed version. Adding agents multiplies the runs and the cost, and it is a different question.
- **Only local pages.** The server audits pages served from the same machine. A server that opens any URL an agent passes it can be pointed at internal services, a risk this project does not need. Whether a user can allow other hosts is part of the URL policy, a later decision.

## Consequences

- The value of the project does not depend on the server being better than the others. A result that says "it does not help" or "another server helps more" is publishable, and ADR 0002 commits to publishing it.
- Three conditions mean half as many runs again as two. With a fixed budget, that means fewer repetitions of each task.
- A difference between this server and the third-party one says which helps more, not why: the two differ in their tools and in their output.
- The author writes both the benchmark and one of the servers it measures. The method limits that conflict of interest: the plan is fixed before the runs, tests do the grading and every result is published. It does not remove it: the same author also picks the defects, writes the tests that grade them and chooses the third-party server, its version and its settings.
- The server stays small on purpose. A tool that suggests fixes waits until a study gives a reason to add it.
- The results will say little about other frameworks and other agents, and the reports must say so.
