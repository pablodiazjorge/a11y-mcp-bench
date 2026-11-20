# 0004. Server architecture, MCP SDK and output contract

- **Status:** Accepted
- **Decided:** 2026-11-20

## Context

The server is the instrument of the study ([ADR 0001](0001-scope-and-non-goals.md)). It will audit a local page with axe-core and with checks of its own, and return findings that a coding agent can act on. Before its first audit tool, three things need a decision: which SDK it is built on, how its code is split, and what an audit tool returns.

The SDK, the split into ports and adapters and the output contract were chosen on 2026-11-14. What the core may import and the shape of the transport port were settled on 2026-11-20, the date above.

The facts below were checked on 2026-11-14, unless another date is given.

- **Two SDK lines.** `@modelcontextprotocol/server` 2.4.0 is the stable line and implements the protocol revision 2026-07-28. `@modelcontextprotocol/sdk` 1.32.2 is in maintenance: it is not planned to get that revision, and its fixes are guaranteed for at least six months from 2026-07-27, that is, until about the end of January 2027.
- **Two protocol eras.** A client of the earlier era opens each connection with `initialize` and agrees on a revision, the latest being 2025-11-25. The 2026-07-28 revision drops `initialize`: each request carries the revision and the client's details. `serveStdio` in the 2.4.0 SDK serves both eras by default.
- **Clients, observed.** Claude Code 2.1.302 connects to a server built on the 2.4.0 SDK over 2026-07-28 and lists its tools. With the 1.32.2 SDK, it tries 2026-07-28, fails and falls back to 2025-11-25. MCP Inspector 2.14.0 lists and calls the tools of a 2.4.0 server in both of its modes, for the earlier era and for 2026-07-28.
- **The SDK may build a server and throw it away.** It creates each server instance through a factory (a function the server gives it). Observed on 2026-11-20: when a client sends `server/discover` and then opens with `initialize`, the SDK calls the factory a second time for the same connection and drops the first instance.
- **Claude Code limits tool output.** It warns when a tool's output passes 10,000 tokens. Above 25,000 tokens or 50,000 characters, it saves the output to a file and gives the model the path.
- **Two copies of a result.** The MCP specification asks a tool that returns structured content (a JSON object that matches the tool's output schema) to return the same JSON as text too. Observed on 2026-11-20, in one run of Claude Code 2.1.329 with one model: the model received the structured content only.
- **The size of an axe-core result, observed** on a test page with 12 cards: 181,499 bytes for 58 elements with a violation. Cut down to rule, impact, selector, a 120-character HTML fragment and summary, an element took 514 bytes on average. That shape is close to the finding decided below, not the same.
- **axe-core selectors are not stable.** They use the rarest traits of the page, which can include the attribute that Angular adds for component styles. Inferred: they can also include an `id` that the Angular CDK (Angular's library of building blocks for components, such as dialogs) numbers in creation order.

## Options considered

**MCP SDK**

1. **The 2.4.0 SDK, serving both protocol eras.** This is the SDK's default. It works with current Claude Code and with clients of the earlier era. Its license is Apache-2.0, and it needs Node 20 or later and `zod` 4.2 or later.
2. **The 2.4.0 SDK, serving the 2026-07-28 era only.** Less to handle, but a client of the earlier era cannot connect, and neither can MCP Inspector in its mode for that era.
3. **The 1.32.2 SDK.** MIT and Node 18, and it works with current Claude Code too. It stays out of the 2026-07-28 revision, and its guaranteed fixes end before the first study is planned to run.

**How the server's code is split**

1. **Ports and adapters.** The core defines interfaces (the ports), and Playwright, axe-core and the SDK connect to them through replaceable pieces (the adapters). The core knows none of the three. In tests, each port is replaced by a double, a stand-in with no browser and no network. More files.
2. **Modules without interfaces.** Less code for three tools. But the core's tests need a browser, and a later study that changes the output touches the same code that talks to axe-core.

**What an audit tool returns**

1. **One finding per element, with fixed fields and a cap on size.** One call returns all that fits, in a fixed order, and says how much was left out.
2. **A summary first, and the details on request.** Each answer is small, but the agent needs more calls and more turns, which are a cost that the study measures.

## Decision

**SDK and protocol.** Option 1: `@modelcontextprotocol/server` 2.4.0, serving both protocol eras. The lockfile pins it with `@modelcontextprotocol/core` 2.4.0 and `zod` 4.6.7. Option 2 gives the study nothing and shuts out clients of the earlier era. Option 3 would leave the server on an SDK whose fixes end before the first study.

**Transport.** The server speaks MCP over stdio: the agent's MCP client starts it as a child process and talks to it over its stdin and stdout. It is also how a user runs the server, which [ADR 0003](0003-monorepo-layout.md) requires for the agent. stdio opens no network port, so only the process that started the server can reach it. stdout carries protocol messages only, and the server writes its log to stderr.

**Package.** `packages/wcag-evidence-mcp` ships a binary only: it declares `bin`, and no `exports` or `main`. So no code can import the server by its package name, and the server does not have to keep the SDK's types stable for other code. Whether the package also blocks imports of its subpaths is decided before it is published.

**Layout: ports and adapters.** Option 1. The source in `packages/wcag-evidence-mcp/src/` has three parts:

| Path               | Part        | What it holds                                                                        |
| ------------------ | ----------- | ------------------------------------------------------------------------------------ |
| `core/`            | The core    | Criteria, findings and the assembly of the output, and the ports as TypeScript types |
| `adapters/<name>/` | One adapter | The code that connects one port to a library, to the SDK or to the operating system  |
| `bin.ts`           | The binary  | Creates the adapters and wires them together: the one file that knows them all       |

Three ports were decided: the browser, the rule engine and the transport. The skeleton of the server added two small ones, the log and the identity. This table shows what exists and what is still to be built:

| Port        | Adapter                                                                                      | State                                                   |
| ----------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Transport   | `adapters/mcp`: the SDK over stdio, which registers the tools and calls the core             | Exists                                                  |
| Log         | `adapters/log-stream`: one line per message on stderr. The port is `core/log.ts`             | Exists                                                  |
| Identity    | `adapters/package-json`: reads the server's name and version. The port is `core/identity.ts` | Exists                                                  |
| Browser     | Playwright, which opens the page                                                             | Decided; to be built together with the URL policy       |
| Rule engine | axe-core, which runs its rules on the open page                                              | Decided, built with the first audit tool, `audit_route` |

The transport port is the set of functions that the core exports, today `describeServer`. It is the port through which requests come in, and the MCP adapter calls those functions. It has no TypeScript interface of its own.

Because the SDK may build an instance and throw it away, the factory only builds an instance and registers the tools. Whatever has state is created once, outside the factory, and passed in. The log and the identity are passed in that way today. The browser will be too.

**Boundaries inside the server.** dependency-cruiser checks these rules as part of `npm run ci`, next to those of ADR 0003:

1. The core imports only other files of the core and the `zod` package: no Node built-in, no other package and no other file of the server.
2. An adapter imports no other adapter.
3. In the server's folder, only the adapters themselves and `src/bin.ts` import an adapter.
4. Nothing imports `src/bin.ts` or its build, `dist/bin.js`. Importing it would start a server on the stdin and stdout of the code that imports it.

Rules 1 to 3 apply to the published code. A test (a `*.test.*` file, or a file in the server's top-level `test/` folder) may import any adapter. Rule 4 applies everywhere, tests included. An import of types alone counts in every rule.

Rule 1 also counts a built-in loaded with `process.getBuiltinModule`. It does not see a global such as `process` or `fetch`: it limits what the core imports, not everything the core can reach. `zod` is allowed because the SDK describes the input and output of each tool with `zod` schemas, so the core can define the output that it assembles in that form.

**Output contract.** Option 1, for every audit tool:

- **Finding:** one per element that fails a check, with fixed fields: an identifier, the criteria, the rule, the measurement and the location. The location is the CSS selector, the element's rectangle and the tag of the Angular component that declares the element. Rules that pass or do not apply are not returned.
- **Definitions:** a finding names its criteria by number. The name of each criterion, one sentence on what it requires and a link to its resource come once per criterion, in a separate table of the same output. The output does not depend on the client reading resources, and no finding repeats a definition.
- **Separate parts:** the measurement, the location and the definition stay in separate fields, so that a later study can leave one out ([ADR 0001](0001-scope-and-non-goals.md)).
- **Cap:** what the model receives stays under Claude Code's warning of 10,000 tokens. The starting cap is 20,000 characters of serialized JSON. Inferred from the measured 514 bytes per element and three to four characters per token, that is about 40 findings and 5,000 to 7,000 tokens. The number is fixed when `audit_route` is built, with what is observed then.
- **Copies:** each tool has an output schema and returns structured content, with the same JSON as text, as the specification asks. The cap counts one copy, and everything the model has to read goes in the structured content, because that is the copy Claude Code gave the model (see Context). If the Claude Code version that the harness pins gives the model both copies, the cap is halved.
- **What does not fit:** the output says that it was cut and counts, per rule, the findings left out. The tool accepts a filter by criterion to ask for them. There is no pagination.
- **Order:** by criterion, then by rule, then by document order (the order of the elements in the HTML).
- **Identifier:** a hash of the route (the page's path in the app), the rule and the axe-core selector without the parts that change on their own, which are Angular's style attributes and numbered `id`s. The hash is a short function written in TypeScript: synchronous, deterministic, and not cryptographic, because it only names a finding. If two elements still give the same hash, their index in document order is added. The identifier names a finding within an audit, and across audits while the selector does not change. It does not promise to follow a finding through a fix. The identifier of the findings of the server's own checks (keyboard and focus) is decided with those checks.

Which criteria the tools check, which URLs the server opens and how it treats the text that it takes from a page are recorded in their own documents.

## Consequences

- The server works with current Claude Code and with clients of the earlier protocol era. Dropping that era later is one option of `serveStdio` (`legacy: 'reject'`).
- The SDK is under Apache-2.0. The server's own code stays under MIT.
- The core can be tested with doubles, without a browser or a network, and a later study can change the output without touching the adapters for axe-core and Playwright. The price is more files than three tools need.
- The core cannot use `node:crypto`, so the identifier's hash is code of the project's own, with tests of its own.
- To exit with code 1 when the connection closes before the client ends stdin, the server wraps the SDK's stdio transport (`adapters/mcp/serve.ts`). The wrapper forwards only the members that the 2.4.0 SDK uses, so an SDK upgrade must check it.
- The cap is a starting value from one test page and one observation of Claude Code. A different client, version or model can receive the output differently.
- On the measured test page, with 58 elements with a violation, the cap would already cut the output, so an agent may need more calls, filtered by criterion.
- The identifier cannot tell whether a fix removed a finding. Grading does not rely on it: tests decide ([ADR 0002](0002-methodology.md)).
